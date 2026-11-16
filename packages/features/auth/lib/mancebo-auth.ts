import process from "node:process";
import { ProfileRepository } from "@calcom/features/profile/repositories/ProfileRepository";
import prisma from "@calcom/prisma";
import { IdentityProvider, UserPermissionRole } from "@calcom/prisma/enums";
import type { User } from "next-auth";
import type { JWT } from "next-auth/jwt";
import CredentialsProvider from "next-auth/providers/credentials";
import { readManceboPrincipal } from "./mancebo-principal";

export const manceboAuthEnabled = process.env.MANCEBO_AUTH_ENABLED === "true";
const userSelect = {
  id: true,
  uuid: true,
  username: true,
  name: true,
  email: true,
  role: true,
  locked: true,
  locale: true,
  manceboUserId: true,
  identityProvider: true,
} as const;

async function appointmentUser(accessToken: string, provision: boolean) {
  const principal = await readManceboPrincipal(accessToken);
  let user = await prisma.user.findUnique({
    where: { manceboUserId: principal.subject },
    select: userSelect,
  });
  if (!user && provision) {
    // An email match never links an existing native account. Operators explicitly
    // bind verified legacy owners; concurrent first sign-ins converge on the UUID.
    try {
      user = await prisma.user.create({
        data: {
          manceboUserId: principal.subject,
          identityProvider: IdentityProvider.MANCEBO,
          identityProviderId: principal.subject,
          email: principal.email,
          emailVerified: new Date(),
          username: `mancebo-${principal.subject}`,
          name: principal.email.split("@")[0],
          role: UserPermissionRole.USER,
        },
        select: userSelect,
      });
    } catch {
      user = await prisma.user.findUnique({
        where: { manceboUserId: principal.subject },
        select: userSelect,
      });
      if (!user) throw new Error("MANCEBO_PROFILE_LINK_REQUIRED");
    }
  }
  if (
    !user ||
    user.locked ||
    user.identityProvider !== IdentityProvider.MANCEBO ||
    user.manceboUserId !== principal.subject
  )
    throw new Error("MANCEBO_SIGN_IN_REQUIRED");
  // Central admin status never automatically promotes an appointment user.
  const role =
    user.role === UserPermissionRole.ADMIN && !principal.platformAdministrator
      ? UserPermissionRole.USER
      : user.role;
  if (user.email !== principal.email || user.role !== role) {
    await prisma.user.update({ where: { id: user.id }, data: { email: principal.email, role } });
  }
  const profiles = await ProfileRepository.findAllProfilesForUserIncludingMovedUser(user);
  const profile = profiles.find((item) => item.organizationId === null) ?? profiles[0];
  return {
    ...user,
    email: principal.email,
    role,
    profile,
    manceboAccessToken: accessToken,
    manceboSubject: principal.subject,
    manceboExpiresAt: principal.expiresAt,
  } satisfies User;
}

export const authorizeMancebo = (credentials: { accessToken: string } | undefined) =>
  appointmentUser(credentials?.accessToken ?? "", true);

export const ManceboCredentialsProvider = CredentialsProvider({
  id: "mancebo",
  name: "Mancebo.ai",
  credentials: { accessToken: { type: "password" } },
  authorize: authorizeMancebo,
});

export async function manceboSessionToken(token: JWT, user?: User) {
  const accessToken = user?.manceboAccessToken ?? token.manceboAccessToken;
  if (typeof accessToken !== "string") throw new Error("MANCEBO_SIGN_IN_REQUIRED");
  const current = await appointmentUser(accessToken, false);
  if (token.manceboSubject && current.manceboSubject !== token.manceboSubject)
    throw new Error("MANCEBO_SIGN_IN_REQUIRED");
  return {
    sub: String(current.id),
    id: current.id,
    name: current.name,
    email: current.email,
    username: current.username,
    orgAwareUsername: current.username,
    role: current.role,
    locale: current.locale ?? "en",
    profileId: current.profile?.id ?? null,
    upId: current.profile?.upId ?? "",
    belongsToActiveTeam: false,
    manceboAccessToken: accessToken,
    manceboSubject: current.manceboSubject,
    manceboExpiresAt: current.manceboExpiresAt,
  } satisfies JWT;
}
