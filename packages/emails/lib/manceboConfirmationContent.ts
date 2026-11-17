import { z } from "zod";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";

export const confirmationPlaceholders = [
  "recipient_name",
  "appointment_title",
  "appointment_date",
  "appointment_time",
  "appointment_timezone",
  "host_name",
  "attendee_name",
  "workspace_name",
] as const;
export type ConfirmationPlaceholder = (typeof confirmationPlaceholders)[number];
const supported = new Set<string>(confirmationPlaceholders);
const placeholderPattern = /\{\{\s*([a-z_]+)\s*\}\}/g;
const validPlaceholders = (text: string) => {
  const remaining = text.replace(placeholderPattern, (match, key: string) =>
    supported.has(key) ? "" : match
  );
  return !remaining.includes("{{") && !remaining.includes("}}");
};
const bodyField = (maximum: number) =>
  z.string().max(maximum).refine(validPlaceholders, "Choose a supported appointment field.");
export const confirmationTemplateSchema = z
  .object({
    subject: bodyField(180).refine(
      (value) => value.trim().length > 0 && !/[\r\n]/.test(value),
      "Use a subject on one line."
    ),
    greeting: bodyField(300),
    introduction: bodyField(5000),
    closing: bodyField(5000),
  })
  .strict();
export type ConfirmationTemplate = z.infer<typeof confirmationTemplateSchema>;
export const defaultConfirmationTemplate: ConfirmationTemplate = {
  subject: "Confirmed: {{appointment_title}}",
  greeting: "Hello {{recipient_name}},",
  introduction: "Please review your appointment details below.",
  closing: "Please keep this email for your records.",
};

export type ConfirmationContext = {
  values: Record<ConfirmationPlaceholder, string>;
  calendarAttachmentAvailable: boolean;
  location?: string | null;
  joinUrl?: string | null;
  rescheduleUrl?: string | null;
  cancelUrl?: string | null;
  hostEmail?: string | null;
};

const htmlEscapes: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => htmlEscapes[character] ?? character);
const interpolate = (value: string, context: ConfirmationContext) =>
  value.replace(placeholderPattern, (_match, key: string) => context.values[key as ConfirmationPlaceholder]);
function safeLink(value: string | null | undefined, owned = false) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      (owned && url.hostname !== "appointments.mancebo.ai")
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export function formatConfirmationTime(start: string, end: string, timezone: string) {
  const first = new Date(start),
    last = new Date(end);
  if (
    !Number.isFinite(first.getTime()) ||
    !Number.isFinite(last.getTime()) ||
    first.getTime() >= last.getTime()
  )
    throw new ErrorWithCode(ErrorCode.BadRequest, "Valid appointment start and end times are required.");
  let zone = timezone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(first);
  } catch {
    zone = "UTC";
  }
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return {
    appointment_date:
      date.format(first) === date.format(last)
        ? date.format(first)
        : `${date.format(first)} – ${date.format(last)}`,
    appointment_time: `${new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(first)} – ${new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(last)}`,
    appointment_timezone: zone,
  };
}

/** Preview and delivery share one escaped renderer; appointment facts stay generated. */
export function renderConfirmationContent(template: ConfirmationTemplate, context: ConfirmationContext) {
  const fields = confirmationTemplateSchema.parse(template);
  const expandedSubject = interpolate(fields.subject, context)
    .replace(/[\r\n]+/g, " ")
    .trim();
  const subject = expandedSubject.length > 180 ? expandedSubject.slice(0, 179) + "…" : expandedSubject;
  const greeting = interpolate(fields.greeting, context),
    introduction = interpolate(fields.introduction, context),
    closing = interpolate(fields.closing, context);
  const join = safeLink(context.joinUrl),
    reschedule = safeLink(context.rescheduleUrl, true),
    cancel = safeLink(context.cancelUrl, true);
  const hostEmail = z.string().email().safeParse(context.hostEmail);
  const details: [string, string][] = [
    ["Appointment", context.values.appointment_title],
    ["Date", context.values.appointment_date],
    ["Time", `${context.values.appointment_time} (${context.values.appointment_timezone})`],
    ["Host", context.values.host_name],
    ["Attendee", context.values.attendee_name],
  ];
  if (context.location) details.push(["Location", context.location]);
  const paragraph = (value: string) =>
    value
      ? `<p style="margin:0 0 18px;font-size:16px;line-height:1.6">${escapeHtml(value).replace(/\n/g, "<br>")}</p>`
      : "";
  const actions = [
    reschedule ? `<a href="${escapeHtml(reschedule)}" style="color:#1749d1">Reschedule</a>` : "",
    cancel ? `<a href="${escapeHtml(cancel)}" style="color:#1749d1">Cancel appointment</a>` : "",
  ].filter(Boolean);
  const missingLocation =
    !join && !context.location
      ? "A meeting location has not been added. Contact your host for joining details."
      : "";
  const calendarNotice = context.calendarAttachmentAvailable
    ? "The calendar invitation is attached. Open it to add this appointment to your calendar."
    : "Please review the appointment date and time above.";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;background:#f4f7fb;color:#13243a;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fff;border:1px solid #dce4ef;border-radius:12px;overflow:hidden">
<tr><td style="padding:24px 32px;background:#102e50;color:#fff;font-size:22px;font-weight:700">Mancebo.ai${context.values.workspace_name && context.values.workspace_name !== "Mancebo.ai" ? `<p style="margin:8px 0 0;color:#d5e3f8;font-size:14px;font-weight:400">Appointments for ${escapeHtml(context.values.workspace_name)}</p>` : ""}</td></tr>
<tr><td style="padding:32px"><h1 style="margin:0 0 24px;font-size:27px;line-height:1.25">Appointment confirmed</h1>
${paragraph(greeting)}${paragraph(introduction)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0;background:#f5f8fc;border:1px solid #dce4ef;border-radius:8px"><tr><td style="padding:8px 20px">${details.map(([label, value]) => `<p style="margin:12px 0;font-size:16px;line-height:1.5"><span style="color:#4d6079;font-size:13px">${escapeHtml(label)}</span><br><strong>${escapeHtml(value)}</strong></p>`).join("")}</td></tr></table>
${join ? `<p style="margin:24px 0"><a href="${escapeHtml(join)}" style="display:inline-block;padding:13px 20px;background:#1749d1;color:#fff;border-radius:6px;text-decoration:none;font-weight:700">Join appointment</a></p>` : paragraph(missingLocation)}
${paragraph(closing)}${actions.length ? `<p style="font-size:14px;line-height:1.8">Need to make a change?<br>${actions.join(" &nbsp;·&nbsp; ")}</p>` : ""}
${hostEmail.success ? `<p style="font-size:14px;line-height:1.6">Questions? Contact your host at <a href="mailto:${escapeHtml(hostEmail.data)}" style="color:#1749d1">${escapeHtml(hostEmail.data)}</a>.</p>` : ""}
</td></tr><tr><td style="padding:20px 32px;border-top:1px solid #dce4ef;color:#4d6079;font-size:13px;line-height:1.6">${calendarNotice}</td></tr></table></td></tr></table></body></html>`;
  const text = [
    greeting,
    introduction,
    ...details.map(([label, value]) => `${label}: ${value}`),
    join ? `Join appointment: ${join}` : missingLocation,
    closing,
    reschedule ? `Reschedule: ${reschedule}` : "",
    cancel ? `Cancel appointment: ${cancel}` : "",
    hostEmail.success ? `Contact your host: ${hostEmail.data}` : "",
    calendarNotice,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { subject, html, text };
}
