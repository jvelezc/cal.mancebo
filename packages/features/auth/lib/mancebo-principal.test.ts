// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { readManceboPrincipal } from "./mancebo-principal";

const subject = "a3f8e672-e26d-4ef3-8af8-c4525b72fd58";
const other = "1509ae0b-f8e4-44f0-abb4-647e19db11ac";
const user = { id: subject, email: "person@example.test", email_confirmed_at: "2026-11-16T00:00:00Z" };
const actor = { actorId: subject, effectiveUserId: subject, email: user.email, role: "authenticated" };
const token = (claims = {}) =>
  [
    "e30",
    Buffer.from(
      JSON.stringify({
        sub: subject,
        session_id: "session",
        exp: Math.floor(Date.now() / 1000) + 60,
        ...claims,
      })
    ).toString("base64url"),
    "signature",
  ].join(".");
const requestFor = (identity: object = user, context: object = actor) =>
  vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(identity))
    .mockResolvedValueOnce(Response.json(context));

describe("Mancebo direct identity verification", () => {
  it("uses the verified identity and authoritative role without trusting editable metadata", async () => {
    const request = requestFor({ ...user, user_metadata: { role: "super_admin" } }, actor);
    const result = await readManceboPrincipal(token(), request);
    expect(result).toMatchObject({ subject, email: user.email, platformAdministrator: false });
    expect(request.mock.calls[1][0]).toBe(
      "https://ffpqxlrfbjyvxsfrnyqm.supabase.co/rest/v1/rpc/get_request_actor_context"
    );
    expect(request.mock.calls[1][1]).toMatchObject({ method: "POST", cache: "no-store", body: "{}" });
  });
  it("rejects expired tokens before contacting a service", async () => {
    const request = requestFor();
    await expect(readManceboPrincipal(token({ exp: 1 }), request)).rejects.toThrow(
      "MANCEBO_SIGN_IN_REQUIRED"
    );
    expect(request).not.toHaveBeenCalled();
  });
  it("does not accept a decoded token without identity-server verification", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));
    await expect(readManceboPrincipal(token(), request)).rejects.toThrow("MANCEBO_SIGN_IN_REQUIRED");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...actor, actorId: other },
    { ...actor, effectiveUserId: other },
    { ...actor, impersonationSessionId: "support-session" },
    { ...actor, email: "other@example.test" },
  ])("rejects a mismatched or impersonated actor %#", async (context) => {
    await expect(readManceboPrincipal(token(), requestFor(user, context))).rejects.toThrow(
      "MANCEBO_SIGN_IN_REQUIRED"
    );
  });
  it("fails closed when authoritative access is unavailable", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(user))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(readManceboPrincipal(token(), request)).rejects.toThrow("MANCEBO_ACCESS_UNAVAILABLE");
  });
  it("requires a confirmed, non-anonymous account and matching token subject", async () => {
    await expect(
      readManceboPrincipal(token(), requestFor({ ...user, email_confirmed_at: "" }))
    ).rejects.toThrow();
    await expect(readManceboPrincipal(token({ sub: other }), requestFor())).rejects.toThrow(
      "MANCEBO_SIGN_IN_REQUIRED"
    );
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...user, is_anonymous: true }));
    await expect(readManceboPrincipal(token(), request)).rejects.toThrow("MANCEBO_SIGN_IN_REQUIRED");
  });
});
