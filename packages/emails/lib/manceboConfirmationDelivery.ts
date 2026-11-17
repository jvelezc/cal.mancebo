import prisma from "@calcom/prisma";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";
import { getCancelLink, getRescheduleLink } from "@calcom/lib/CalEventParser";
import {
  defaultConfirmationTemplate,
  formatConfirmationTime,
  renderConfirmationContent,
} from "./manceboConfirmationContent";
import { validSavedConfirmation } from "./manceboEmailPolicy";

const policySelect = {
  subject: true,
  greeting: true,
  introduction: true,
  closing: true,
  enabled: true,
} as const;
export async function renderManceboConfirmation(input: {
  event: CalendarEvent;
  recipient: Person;
  attendee: boolean;
  calendarAttachmentAvailable: boolean;
}) {
  const { event, recipient, attendee, calendarAttachmentAvailable } = input;
  const binding = event.eventTypeId
    ? await prisma.manceboEventEmailWorkspace.findUnique({
        where: { eventTypeId: event.eventTypeId },
        select: { workspaceId: true, workspaceName: true },
      })
    : null;
  const [platform, workspace] = await Promise.all([
    prisma.manceboAppointmentEmailTemplate.findUnique({
      where: { scopeKey: "platform" },
      select: policySelect,
    }),
    binding
      ? prisma.manceboAppointmentEmailTemplate.findUnique({
          where: { scopeKey: binding.workspaceId },
          select: policySelect,
        })
      : Promise.resolve(null),
  ]);
  const inherited = platform?.enabled
    ? (validSavedConfirmation(platform) ?? defaultConfirmationTemplate)
    : defaultConfirmationTemplate;
  const template = workspace?.enabled ? (validSavedConfirmation(workspace) ?? inherited) : inherited;
  // A provider marker such as integrations:daily is not evidence of a meeting URL.
  const joinUrl =
    event.videoCallData?.url ||
    event.additionalInformation?.hangoutLink ||
    event.additionalInformation?.entryPoints?.find((point) => point.entryPointType === "video")?.uri ||
    (event.location?.startsWith("https://") ? event.location : null);
  const location = event.location && !event.location.startsWith("integrations:") ? event.location : null;
  const facts = formatConfirmationTime(event.startTime, event.endTime, recipient.timeZone);
  return renderConfirmationContent(template, {
    values: {
      ...facts,
      recipient_name: recipient.name,
      appointment_title: event.type || event.title,
      host_name: event.organizer.name,
      attendee_name: attendee ? recipient.name : event.attendees.map((person) => person.name).join(", "),
      workspace_name: binding?.workspaceName ?? "Mancebo.ai",
    },
    calendarAttachmentAvailable,
    location,
    joinUrl,
    hostEmail: attendee && event.hideOrganizerEmail ? null : event.organizer.email,
    rescheduleUrl: event.disableRescheduling
      ? null
      : getRescheduleLink({ calEvent: event, attendee: attendee ? recipient : undefined }),
    cancelUrl: event.disableCancelling ? null : getCancelLink(event, attendee ? recipient : undefined),
  });
}
