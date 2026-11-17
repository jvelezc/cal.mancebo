import { randomUUID } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";

import { confirmationTemplateSchema } from "@calcom/emails/lib/manceboConfirmationContent";
import { readManceboEmailSettings, saveManceboEmailSettings } from "@calcom/emails/lib/manceboEmailPolicy";
import { readManceboEmailActor } from "@calcom/features/auth/lib/mancebo-email-actor";
import { authorizeManceboEmailScope } from "@calcom/features/auth/lib/mancebo-workspaces";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";

const scopeSchema = z.string().min(1).max(36);
const updateSchema = z
  .object({
    scope: scopeSchema,
    expectedRevision: z.number().int().min(0).max(2147483646),
    enabled: z.boolean(),
    template: confirmationTemplateSchema,
    eventTypeIds: z.array(z.number().int().positive().max(2147483647)).max(200),
  })
  .strict();
export const config = { api: { bodyParser: { sizeLimit: "64kb" } } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const diagnosticId = randomUUID();
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Request-ID", diagnosticId);
  if (req.method !== "GET" && req.method !== "PUT") {
    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED", diagnosticId });
  }
  let scope: string | undefined;
  try {
    if (req.method === "PUT" && req.headers.origin !== "https://appointments.mancebo.ai")
      throw new ErrorWithCode(ErrorCode.Forbidden, "Open appointment settings in Mancebo before saving.");
    const actor = await readManceboEmailActor(req);
    const metadata = { canEditPlatform: actor.principal.platformAdministrator, workspaces: actor.workspaces };
    if (req.method === "GET") {
      if (req.query.scope === undefined) return res.status(200).json(metadata);
      scope = scopeSchema.parse(req.query.scope);
      const authorized = authorizeManceboEmailScope(scope, actor.principal, actor.workspaces);
      const settings = await readManceboEmailSettings(authorized, actor.nativeUserId);
      return res.status(200).json({ ...metadata, settings });
    }
    const input = updateSchema.parse(req.body);
    scope = input.scope;
    const authorized = authorizeManceboEmailScope(scope, actor.principal, actor.workspaces);
    const result = await saveManceboEmailSettings({
      ...input,
      scope: authorized,
      nativeUserId: actor.nativeUserId,
      manceboSubject: actor.principal.subject,
    });
    console.info(
      JSON.stringify({
        marker: "MANCEBO_EMAIL_SETTINGS",
        operation: "save",
        outcome: "saved",
        diagnostic_id: diagnosticId,
        actor: actor.principal.subject,
        scope,
        revision: result.revision,
      })
    );
    return res.status(200).json(result);
  } catch (error) {
    const known = error instanceof ErrorWithCode;
    const conflict =
      known && ["revision_conflict", "assignment_conflict"].includes(String(error.data?.reason));
    const status =
      error instanceof z.ZodError
        ? 400
        : conflict
          ? 409
          : known
            ? ({
                [ErrorCode.Unauthorized]: 401,
                [ErrorCode.Forbidden]: 403,
                [ErrorCode.BadRequest]: 400,
              }[error.code as ErrorCode.Unauthorized | ErrorCode.Forbidden | ErrorCode.BadRequest] ?? 503)
            : 503;
    const code = conflict
      ? "SETTINGS_CHANGED"
      : status === 401
        ? "SIGN_IN_REQUIRED"
        : status === 403
          ? "NOT_AUTHORIZED"
          : status === 400
            ? "INVALID_SETTINGS"
            : "SETTINGS_UNAVAILABLE";
    const message =
      status === 503
        ? "Appointment email settings are temporarily unavailable. Try again shortly."
        : status === 400
          ? "Check the wording, supported placeholders and selected booking links."
          : known
            ? error.message
            : "The settings could not be updated.";
    console.warn(
      JSON.stringify({
        marker: "MANCEBO_EMAIL_SETTINGS",
        operation: req.method === "PUT" ? "save" : "read",
        outcome: "rejected",
        diagnostic_id: diagnosticId,
        status,
        code,
      })
    );
    return res.status(status).json({ error: code, message, diagnosticId, retrySafe: status === 503 });
  }
}
