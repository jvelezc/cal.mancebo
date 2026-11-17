import { decodeJwt } from "jose";
import { z } from "zod";

// Existing Mancebo identity service; this public key grants no administrator access.
export const identityUrl = "https://ffpqxlrfbjyvxsfrnyqm.supabase.co";
export const publishableKey = "sb_publishable_WSKvbqhp2yGmPWJOcNRhiw_Gp18jl62";
const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  email_confirmed_at: z.string().min(1),
  is_anonymous: z.boolean().optional(),
});
const actorSchema = z.object({
  actorId: z.string().uuid(),
  effectiveUserId: z.string().uuid(),
  email: z.string().email(),
  role: z.string(),
  impersonationSessionId: z.string().nullish(),
});

export async function readManceboPrincipal(accessToken: string, request: typeof fetch = fetch) {
  if (!accessToken || accessToken.length > 16384) throw new Error("MANCEBO_SIGN_IN_REQUIRED");
  // Decoding sets a lifetime ceiling only. The identity service verifies the token.
  const claims = decodeJwt(accessToken);
  if (!claims.exp || claims.exp <= Date.now() / 1000 || !claims.session_id)
    throw new Error("MANCEBO_SIGN_IN_REQUIRED");
  const headers = { apikey: publishableKey, Authorization: `Bearer ${accessToken}` };
  const userResponse = await request(`${identityUrl}/auth/v1/user`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!userResponse.ok) throw new Error("MANCEBO_SIGN_IN_REQUIRED");
  const user = userSchema.parse(await userResponse.json());
  if (user.is_anonymous || claims.sub !== user.id) throw new Error("MANCEBO_SIGN_IN_REQUIRED");
  const actorResponse = await request(`${identityUrl}/rest/v1/rpc/get_request_actor_context`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: "{}",
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!actorResponse.ok) throw new Error("MANCEBO_ACCESS_UNAVAILABLE");
  const actor = actorSchema.parse(await actorResponse.json());
  if (
    actor.actorId !== user.id ||
    actor.effectiveUserId !== user.id ||
    actor.impersonationSessionId ||
    actor.email.toLowerCase() !== user.email.toLowerCase()
  )
    throw new Error("MANCEBO_SIGN_IN_REQUIRED");
  return {
    subject: user.id,
    email: user.email.toLowerCase(),
    expiresAt: claims.exp,
    platformAdministrator: ["super_admin", "platform_admin"].includes(actor.role),
  };
}
