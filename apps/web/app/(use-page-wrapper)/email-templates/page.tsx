import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { readManceboEmailActor } from "@calcom/features/auth/lib/mancebo-email-actor";
import { ErrorWithCode } from "@calcom/lib/errors";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import AppointmentEmailSettings from "../../../modules/mancebo-email/AppointmentEmailSettings";

export const metadata = { title: "Appointment emails | Mancebo.ai" };
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ workspace?: string }> }) {
  const request = buildLegacyRequest(await headers(), await cookies());
  try {
    const actor = await readManceboEmailActor(request);
    const requested = (await searchParams).workspace;
    return (
      <AppointmentEmailSettings
        metadata={{ canEditPlatform: actor.principal.platformAdministrator, workspaces: actor.workspaces }}
        initialScope={requested}
      />
    );
  } catch (error) {
    if (error instanceof ErrorWithCode && error.code === ErrorCode.Unauthorized) redirect("/auth/login");
    const unavailable = !(error instanceof ErrorWithCode && error.code === ErrorCode.Forbidden);
    if (unavailable)
      console.warn(
        JSON.stringify({
          marker: "MANCEBO_EMAIL_SETTINGS",
          operation: "page",
          outcome: "permissions_unavailable",
        })
      );
    return (
      <AppointmentEmailSettings
        metadata={{ canEditPlatform: false, workspaces: [] }}
        permissionsUnavailable={unavailable}
      />
    );
  }
}
