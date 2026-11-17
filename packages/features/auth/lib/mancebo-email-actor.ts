import type { NextApiRequest } from "next";
import { getToken } from "next-auth/jwt";

import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import prisma from "@calcom/prisma";

import { readManceboPrincipal } from "./mancebo-principal";
import { readManceboEditableWorkspaces } from "./mancebo-workspaces";

const signInRequired = () => new ErrorWithCode(ErrorCode.Unauthorized, "Sign in to Mancebo to continue.");

/** Read the human identity from the encrypted native cookie, never from submitted fields. */
export async function readManceboEmailActor(req: NextApiRequest) {
  if (process.env.MANCEBO_AUTH_ENABLED !== "true" && process.env.NEXT_PUBLIC_MANCEBO_AUTH_ENABLED !== "true")
    throw new ErrorWithCode(ErrorCode.Forbidden, "Mancebo appointment settings are not available here.");
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token || typeof token.manceboAccessToken !== "string" || typeof token.manceboSubject !== "string")
    throw signInRequired();
  const accessToken = token.manceboAccessToken;
  const checkedFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, { ...init, redirect: "error" });
    if (response.status >= 500)
      throw new ErrorWithCode(ErrorCode.InternalServerError, "Account permissions could not be checked.", {
        reason: "identity_unavailable",
        retry_safe: true,
      });
    return response;
  };
  let principal: Awaited<ReturnType<typeof readManceboPrincipal>>;
  try {
    principal = await readManceboPrincipal(accessToken, checkedFetch);
  } catch (error) {
    if (error instanceof Error && error.message === "MANCEBO_SIGN_IN_REQUIRED") throw signInRequired();
    throw error;
  }
  if (principal.subject !== token.manceboSubject) throw signInRequired();
  const user = await prisma.user.findUnique({
    where: { manceboUserId: principal.subject },
    select: { id: true, manceboUserId: true, identityProvider: true, locked: true },
  });
  if (
    !user ||
    user.locked ||
    user.identityProvider !== "MANCEBO" ||
    user.manceboUserId !== principal.subject ||
    String(user.id) !== token.sub
  )
    throw signInRequired();
  const workspaces = await readManceboEditableWorkspaces(accessToken, principal, checkedFetch);
  return { nativeUserId: user.id, principal, workspaces };
}
