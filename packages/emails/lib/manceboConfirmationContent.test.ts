import { describe, expect, it } from "vitest";
import {
  confirmationTemplateSchema,
  defaultConfirmationTemplate,
  formatConfirmationTime,
  renderConfirmationContent,
} from "./manceboConfirmationContent";
import type { ConfirmationContext } from "./manceboConfirmationContent";
const sample: ConfirmationContext = {
  calendarAttachmentAvailable: true,
  values: {
    recipient_name: "Taylor",
    appointment_title: "Your introduction call",
    appointment_date: "Tuesday, November 17, 2026",
    appointment_time: "9:30 AM – 9:45 AM",
    appointment_timezone: "UTC",
    host_name: "Alex",
    attendee_name: "Taylor",
    workspace_name: "GentleBirth",
  },
  rescheduleUrl: "https://appointments.mancebo.ai/reschedule/synthetic-id",
  cancelUrl: "https://appointments.mancebo.ai/booking/synthetic-id?cancel=true",
  hostEmail: "host@example.com",
};
describe("Mancebo appointment confirmation content", () => {
  it("provides a professional default with readable appointment details and working action destinations", () => {
    const result = renderConfirmationContent(defaultConfirmationTemplate, sample);
    expect(result.subject).toBe("Confirmed: Your introduction call");
    expect(result.html).toContain("Hello Taylor,");
    expect(result.html).toContain("Mancebo.ai");
    expect(result.html).toContain("Appointment confirmed</h1>");
    expect(result.html).toContain("Appointments for GentleBirth");
    expect(result.html).toContain("9:30 AM – 9:45 AM (UTC)");
    expect(result.html).toContain('href="https://appointments.mancebo.ai/reschedule/synthetic-id"');
    expect(result.text).toContain("Host: Alex");
    expect(result.text).toContain("Attendee: Taylor");
    expect(result.text).toContain("calendar invitation is attached");
    expect(result.text).not.toContain("restores the calendar invitation");
  });
  it("applies the same saved words and personalized fields to HTML and plain text", () => {
    const template = {
      ...defaultConfirmationTemplate,
      introduction: "Welcome to {{workspace_name}}, {{recipient_name}}.\nWe'll meet {{appointment_date}}.",
      closing: "Thank you, {{host_name}}",
    };
    const result = renderConfirmationContent(template, sample);
    for (const phrase of [
      "Welcome to GentleBirth, Taylor.",
      "Tuesday, November 17, 2026",
      "Thank you, Alex",
    ]) {
      expect(result.html).toContain(phrase);
      expect(result.text).toContain(phrase);
    }
    expect(result.html).toContain("<br>");
    expect(result.text).not.toContain("<br>");
  });
  it.each([
    "{{unknown_field}}",
    "{{host_name",
    "host_name}}",
  ])("rejects unsupported or incomplete placeholder %s", (field) => {
    expect(
      confirmationTemplateSchema.safeParse({ ...defaultConfirmationTemplate, introduction: field }).success
    ).toBe(false);
  });
  it("rejects a header-injecting subject and unsupported template properties", () => {
    expect(
      confirmationTemplateSchema.safeParse({
        ...defaultConfirmationTemplate,
        subject: "Confirmed\r\nBcc: stranger@example.com",
      }).success
    ).toBe(false);
    expect(
      confirmationTemplateSchema.safeParse({ ...defaultConfirmationTemplate, sender: "stranger@example.com" })
        .success
    ).toBe(false);
  });
  it("escapes editable words and booking values without treating them as HTML", () => {
    const result = renderConfirmationContent(
      { ...defaultConfirmationTemplate, introduction: '<script>alert("x")</script>' },
      {
        ...sample,
        values: {
          ...sample.values,
          recipient_name: '<img src=x onerror="alert(1)">',
          appointment_title: "Private\r\nBcc: stranger@example.com",
        },
      }
    );
    expect(result.html).toContain("&lt;script&gt;");
    expect(result.html).toContain("&lt;img");
    expect(result.html).not.toContain("<script>");
    expect(result.html).not.toContain("<img src=x");
    expect(result.subject).not.toMatch(/[\r\n]/);
  });
  it("does not fabricate joining details or calendar attachments", () => {
    const result = renderConfirmationContent(defaultConfirmationTemplate, {
      ...sample,
      calendarAttachmentAvailable: false,
    });
    expect(result.html).toContain("A meeting location has not been added");
    expect(result.html).not.toContain("Join appointment</a>");
    expect(result.text).not.toContain("invitation is attached");
  });
  it("shows a real meeting link while rejecting unsafe or foreign management links", () => {
    const result = renderConfirmationContent(defaultConfirmationTemplate, {
      ...sample,
      joinUrl: "https://meet.example.com/room",
      cancelUrl: "javascript:alert(1)",
      rescheduleUrl: "https://foreign.example/reschedule",
    });
    expect(result.html).toContain('href="https://meet.example.com/room"');
    expect(result.html).not.toContain("A meeting location has not been added");
    expect(result.html).not.toContain("javascript:");
    expect(result.html).not.toContain("foreign.example");
  });
  it("formats date and time in the actual recipient zone and makes UTC fallback explicit", () => {
    const local = formatConfirmationTime(
      "2026-11-17T09:30:00Z",
      "2026-11-17T09:45:00Z",
      "America/Los_Angeles"
    );
    expect(local).toMatchObject({
      appointment_timezone: "America/Los_Angeles",
      appointment_time: "1:30 AM – 1:45 AM",
    });
    expect(
      formatConfirmationTime("2026-11-17T09:30:00Z", "2026-11-17T09:45:00Z", "invalid-zone")
    ).toMatchObject({ appointment_timezone: "UTC", appointment_time: "9:30 AM – 9:45 AM" });
    expect(() => formatConfirmationTime("invalid", "invalid", "UTC")).toThrow("Valid appointment");
  });
  it("names both local dates when an appointment crosses midnight", () => {
    const result = formatConfirmationTime(
      "2026-11-17T07:45:00Z",
      "2026-11-17T08:15:00Z",
      "America/Los_Angeles"
    );
    expect(result.appointment_date).toContain("Monday, November 16, 2026");
    expect(result.appointment_date).toContain("Tuesday, November 17, 2026");
    expect(result.appointment_time).toBe("11:45 PM – 12:15 AM");
  });
});
