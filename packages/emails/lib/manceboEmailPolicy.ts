import prisma from "@calcom/prisma";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { authorizeManceboEmailScope } from "@calcom/features/auth/lib/mancebo-workspaces";
import { confirmationTemplateSchema, defaultConfirmationTemplate } from "./manceboConfirmationContent";
import type { ConfirmationTemplate } from "./manceboConfirmationContent";

export type ManceboEmailScope = ReturnType<typeof authorizeManceboEmailScope>;
const wordsSelect = { subject: true, greeting: true, introduction: true, closing: true } as const;
const policySelect = { ...wordsSelect, enabled: true, revision: true, updatedAt: true } as const;
const words = (value: ConfirmationTemplate) => ({
  subject: value.subject,
  greeting: value.greeting,
  introduction: value.introduction,
  closing: value.closing,
});
export function validSavedConfirmation(value: ConfirmationTemplate | null) {
  const parsed = confirmationTemplateSchema.safeParse(value ? words(value) : null);
  return parsed.success ? parsed.data : null;
}
const conflict = () =>
  new ErrorWithCode(
    ErrorCode.BadRequest,
    "A newer email setting was saved. Reload it before saving your changes.",
    { reason: "revision_conflict" }
  );

export async function readManceboEmailSettings(scope: ManceboEmailScope, nativeUserId: number) {
  const [saved, platform, eventTypes, linkedEventCount] = await Promise.all([
    prisma.manceboAppointmentEmailTemplate.findUnique({
      where: { scopeKey: scope.scopeKey },
      select: policySelect,
    }),
    scope.workspace
      ? prisma.manceboAppointmentEmailTemplate.findUnique({
          where: { scopeKey: "platform" },
          select: policySelect,
        })
      : Promise.resolve(null),
    scope.workspace
      ? prisma.eventType.findMany({
          where: { userId: nativeUserId, teamId: null },
          orderBy: { id: "asc" },
          select: {
            id: true,
            title: true,
            slug: true,
            manceboEmailWorkspace: { select: { workspaceId: true } },
          },
        })
      : Promise.resolve([]),
    scope.workspace
      ? prisma.manceboEventEmailWorkspace.count({ where: { workspaceId: scope.workspace.id } })
      : Promise.resolve(0),
  ]);
  const inheritedTemplate = platform?.enabled
    ? (validSavedConfirmation(platform) ?? defaultConfirmationTemplate)
    : defaultConfirmationTemplate;
  const effectiveTemplate = saved?.enabled
    ? (validSavedConfirmation(saved) ?? inheritedTemplate)
    : inheritedTemplate;
  return {
    scopeKey: scope.scopeKey,
    workspaceName: scope.workspace?.name ?? null,
    saved: saved
      ? {
          ...words(saved),
          enabled: saved.enabled,
          revision: saved.revision,
          updatedAt: saved.updatedAt.toISOString(),
        }
      : null,
    revision: saved?.revision ?? 0,
    inheritedTemplate,
    effectiveTemplate,
    invalidSavedTemplate: Boolean(saved?.enabled && !validSavedConfirmation(saved)),
    linkedEventCount,
    eventTypes: eventTypes.map((event) => ({
      id: event.id,
      title: event.title,
      slug: event.slug,
      selected: event.manceboEmailWorkspace?.workspaceId === scope.scopeKey,
      assignedElsewhere: Boolean(
        event.manceboEmailWorkspace && event.manceboEmailWorkspace.workspaceId !== scope.scopeKey
      ),
    })),
  };
}
export type ManceboEmailSettings = Awaited<ReturnType<typeof readManceboEmailSettings>>;

export async function saveManceboEmailSettings(input: {
  scope: ManceboEmailScope;
  nativeUserId: number;
  manceboSubject: string;
  expectedRevision: number;
  enabled: boolean;
  template: ConfirmationTemplate;
  eventTypeIds: number[];
}) {
  const { scope, nativeUserId, manceboSubject, expectedRevision, enabled, eventTypeIds } = input;
  const workspace = scope.workspace;
  const template = confirmationTemplateSchema.parse(input.template);
  if (workspace ? scope.scopeKey !== workspace.id : scope.scopeKey !== "platform")
    throw new ErrorWithCode(ErrorCode.Forbidden, "This workspace has not been authorized.");
  if (!workspace && eventTypeIds.length)
    throw new ErrorWithCode(ErrorCode.BadRequest, "Choose booking links within a workspace.");
  if (
    new Set(eventTypeIds).size !== eventTypeIds.length ||
    eventTypeIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
  )
    throw new ErrorWithCode(ErrorCode.BadRequest, "Choose each booking link once.");
  try {
    return await prisma.$transaction(
      async (tx) => {
        const saved = await tx.manceboAppointmentEmailTemplate.findUnique({
          where: { scopeKey: scope.scopeKey },
          select: policySelect,
        });
        if ((saved?.revision ?? 0) !== expectedRevision) throw conflict();
        if (workspace) {
          const selected = await tx.eventType.findMany({
            where: { id: { in: eventTypeIds }, userId: nativeUserId, teamId: null },
            select: { id: true, manceboEmailWorkspace: { select: { workspaceId: true } } },
          });
          if (selected.length !== eventTypeIds.length)
            throw new ErrorWithCode(
              ErrorCode.Forbidden,
              "You can assign only your own personal booking links."
            );
          if (
            selected.some(
              (event) =>
                event.manceboEmailWorkspace && event.manceboEmailWorkspace.workspaceId !== workspace.id
            )
          )
            throw new ErrorWithCode(
              ErrorCode.BadRequest,
              "A selected booking link already uses another workspace. Remove its old assignment first.",
              { reason: "assignment_conflict" }
            );
        }
        // Reset changes inheritance without destroying the last custom wording.
        const content = !enabled && saved ? words(saved) : template;
        const data = {
          ...content,
          enabled,
          updatedByManceboUserId: manceboSubject,
          workspaceId: workspace?.id ?? null,
        };
        if (saved) {
          const changed = await tx.manceboAppointmentEmailTemplate.updateMany({
            where: { scopeKey: scope.scopeKey, revision: expectedRevision },
            data: { ...data, revision: { increment: 1 } },
          });
          if (changed.count !== 1) throw conflict();
        } else
          await tx.manceboAppointmentEmailTemplate.create({
            data: { ...data, scopeKey: scope.scopeKey, revision: 1 },
            select: { revision: true },
          });
        if (workspace) {
          await tx.manceboEventEmailWorkspace.deleteMany({
            where: { workspaceId: workspace.id, eventType: { userId: nativeUserId, teamId: null } },
          });
          if (eventTypeIds.length)
            await tx.manceboEventEmailWorkspace.createMany({
              data: eventTypeIds.map((eventTypeId) => ({
                eventTypeId,
                workspaceId: workspace.id,
                workspaceName: workspace.name,
                linkedByManceboUserId: manceboSubject,
              })),
            });
        }
        return { revision: expectedRevision + 1 };
      },
      { isolationLevel: "Serializable" }
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "P2002" || error.code === "P2034")
    )
      throw conflict();
    throw error;
  }
}
