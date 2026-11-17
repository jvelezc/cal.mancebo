import type { CalendarEvent, Person } from "@calcom/types/Calendar";
import type { TFunction } from "i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ binding: vi.fn(), policy: vi.fn(), ics: vi.fn(), upstream: vi.fn() }));
vi.mock("@calcom/prisma", () => ({
  default: {
    manceboEventEmailWorkspace: { findUnique: mocks.binding },
    manceboAppointmentEmailTemplate: { findUnique: mocks.policy },
  },
}));
vi.mock("./_base-email", () => ({
  default: class {
    protected getMailerOptions() {
      return { from: "notifications@mancebo.ai" };
    }
  },
}));
vi.mock("../src/renderEmail", () => ({ default: mocks.upstream }));
vi.mock("../lib/generateIcsFile", () => ({
  default: mocks.ics,
  GenerateIcsRole: { ATTENDEE: "attendee", ORGANIZER: "organizer" },
}));
vi.mock("@calcom/lib/constants", () => ({ EMAIL_FROM_NAME: "Mancebo.ai" }));
vi.mock("@calcom/lib/CalEventParser", () => ({
  getRichDescription: vi.fn(),
  getCancelLink: () => "https://appointments.mancebo.ai/booking/example?cancel=true",
  getRescheduleLink: () => "https://appointments.mancebo.ai/reschedule/example",
}));
vi.mock("lodash/cloneDeep", () => ({
  default: (value: CalendarEvent) => ({
    ...value,
    attendees: value.attendees.map((person) => ({ ...person })),
  }),
}));
import { defaultConfirmationTemplate } from "../lib/manceboConfirmationContent";
import { renderManceboConfirmation } from "../lib/manceboConfirmationDelivery";
import AttendeeScheduledEmail from "./attendee-scheduled-email";
import OrganizerScheduledEmail from "./organizer-scheduled-email";
class AttendeePayload extends AttendeeScheduledEmail {
  payload() {
    return this.getNodeMailerPayload();
  }
}
class OrganizerPayload extends OrganizerScheduledEmail {
  payload() {
    return this.getNodeMailerPayload();
  }
}
const language = { locale: "en", translate: ((key: string) => key) as TFunction };
const guest: Person = { name: "Alex", email: "alex@example.test", timeZone: "America/New_York", language };
const event: CalendarEvent = {
  eventTypeId: 5,
  type: "Planning call",
  title: "Planning call",
  uid: "synthetic-booking",
  startTime: "2026-11-24T15:00:00Z",
  endTime: "2026-11-24T15:30:00Z",
  organizer: { name: "Jordan", email: "jordan@example.test", timeZone: "UTC", language },
  attendees: [guest, { ...guest, name: "Private guest", email: "hidden@example.test" }],
};
const stored = {
  ...defaultConfirmationTemplate,
  enabled: true,
  subject: "Your {{workspace_name}} appointment",
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("MANCEBO_AUTH_ENABLED", "true");
  mocks.binding.mockResolvedValue(null);
  mocks.policy.mockResolvedValue(null);
  mocks.ics.mockReturnValue({ method: "REQUEST", filename: "event.ics", content: "SYNTHETIC-CALENDAR" });
  mocks.upstream.mockResolvedValue("upstream-email");
});
describe("appointment confirmation delivery", () => {
  it("uses the built-in professional default for an unassigned booking", async () => {
    const result = await renderManceboConfirmation({
      event,
      recipient: guest,
      attendee: true,
      calendarAttachmentAvailable: true,
    });
    expect(result.subject).toBe("Confirmed: Planning call");
    expect(result.text).toContain("10:00 AM – 10:30 AM (America/New_York)");
    expect(result.html).toContain("Appointment confirmed");
    expect(mocks.binding).toHaveBeenCalledExactlyOnceWith({
      where: { eventTypeId: 5 },
      select: { workspaceId: true, workspaceName: true },
    });
    expect(mocks.policy).toHaveBeenCalledTimes(1);
  });
  it("uses only the event's explicit workspace assignment for its custom wording", async () => {
    mocks.binding.mockResolvedValue({ workspaceId: "workspace-a", workspaceName: "GentleBirth" });
    mocks.policy.mockImplementation(async ({ where }) =>
      where.scopeKey === "workspace-a" ? stored : { ...stored, subject: "Platform wording" }
    );
    const result = await renderManceboConfirmation({
      event,
      recipient: guest,
      attendee: true,
      calendarAttachmentAvailable: true,
    });
    expect(result.subject).toBe("Your GentleBirth appointment");
    expect(result.html).toContain("Appointments for GentleBirth");
    expect(mocks.policy.mock.calls.map(([arg]) => arg.where.scopeKey)).toEqual(["platform", "workspace-a"]);
  });
  it.each([
    { name: "disabled override", override: { ...stored, enabled: false } },
    { name: "invalid saved override", override: { ...stored, subject: "{{unknown}}" } },
  ])("inherits the platform wording for $name", async ({ override }) => {
    mocks.binding.mockResolvedValue({ workspaceId: "workspace-a", workspaceName: "GentleBirth" });
    mocks.policy.mockImplementation(async ({ where }) =>
      where.scopeKey === "workspace-a" ? override : { ...stored, subject: "Platform confirmation" }
    );
    const result = await renderManceboConfirmation({
      event,
      recipient: guest,
      attendee: true,
      calendarAttachmentAvailable: false,
    });
    expect(result.subject).toBe("Platform confirmation");
  });
  it("does not disclose other guests or a hidden host email in the attendee body", async () => {
    const result = await renderManceboConfirmation({
      event: { ...event, hideOrganizerEmail: true, disableCancelling: true, disableRescheduling: true },
      recipient: guest,
      attendee: true,
      calendarAttachmentAvailable: false,
    });
    expect(result.text).toContain("Attendee: Alex");
    expect(result.html + result.text).not.toMatch(
      /Private guest|hidden@example|jordan@example|Reschedule|Cancel appointment/
    );
  });
  it("does not invent a meeting URL or claim a missing calendar attachment", async () => {
    const result = await renderManceboConfirmation({
      event: { ...event, location: "integrations:daily" },
      recipient: guest,
      attendee: true,
      calendarAttachmentAvailable: false,
    });
    expect(result.text).toContain("A meeting location has not been added");
    expect(result.html + result.text).not.toMatch(
      /Join appointment|invitation is attached|integrations:daily/
    );
  });
  it("integrates the professional content and one ICS event into the actual attendee payload", async () => {
    const payload = await new AttendeePayload(
      { ...event, seatsPerTimeSlot: 5, seatsShowAttendees: false },
      guest
    ).payload();
    expect(payload.subject).toBe("Confirmed: Planning call");
    expect(payload.to).toBe("Alex <alex@example.test>");
    expect(payload.replyTo).toBe("jordan@example.test");
    expect(payload.icalEvent).toEqual({
      method: "REQUEST",
      filename: "event.ics",
      content: "SYNTHETIC-CALENDAR",
    });
    expect(payload.html).not.toContain("Private guest");
    expect(mocks.ics.mock.calls[0][0].calEvent.attendees).toEqual([guest]);
    expect(mocks.upstream).not.toHaveBeenCalled();
  });
  it("uses organizer timezone and does not claim an attachment when the ICS generator omits it", async () => {
    mocks.ics.mockReturnValue(null);
    const payload = await new OrganizerPayload({ calEvent: event }).payload();
    expect(payload.text).toContain("3:00 PM – 3:30 PM (UTC)");
    expect(payload.text).not.toContain("invitation is attached");
    expect(payload.to).toBe("jordan@example.test");
    expect(payload.icalEvent).toBeNull();
  });
  it("keeps the original specialized organizer notice for a seat update", async () => {
    await new OrganizerPayload({ calEvent: event, newSeat: true }).payload();
    expect(mocks.upstream).toHaveBeenCalledTimes(1);
    expect(mocks.binding).not.toHaveBeenCalled();
  });
});
