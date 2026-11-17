import { createHash } from "node:crypto";

function context(template: string, diagnosticsId: string, bookingUid?: string) {
  return {
    template: /^[A-Za-z0-9_]{1,80}$/.test(template) ? template : "MAIL_TEMPLATE",
    diagnostics_id: diagnosticsId,
    ...(bookingUid ? { booking_ref_sha256: createHash("sha256").update(bookingUid).digest("hex") } : {}),
  };
}

export function mailFailureEvidence(
  template: string,
  error: unknown,
  diagnosticsId: string,
  bookingUid?: string
) {
  const value = typeof error === "object" && error !== null ? error : {};
  const code =
    "code" in value && typeof value.code === "string" && /^[A-Z0-9_]{1,50}$/.test(value.code)
      ? value.code
      : "MAIL_DELIVERY_FAILED";
  const smtpStatus =
    "responseCode" in value &&
    typeof value.responseCode === "number" &&
    Number.isInteger(value.responseCode) &&
    value.responseCode >= 400 &&
    value.responseCode <= 599
      ? value.responseCode
      : undefined;
  return {
    event: "mancebo.mail.failed",
    ...context(template, diagnosticsId, bookingUid),
    code,
    ...(smtpStatus ? { smtp_status: smtpStatus } : {}),
    action: ["ECONNREFUSED", "ENOTFOUND", "EAUTH"].includes(code)
      ? "repair_transport_then_resend"
      : "review_provider_receipt_before_resend",
  };
}

export function mailAcceptanceEvidence(
  template: string,
  info: unknown,
  diagnosticsId: string,
  bookingUid?: string
) {
  const value = typeof info === "object" && info !== null ? info : {};
  const messageId =
    "messageId" in value && typeof value.messageId === "string" && /^[^\s]{1,200}$/.test(value.messageId)
      ? value.messageId
      : undefined;
  return {
    event: "mancebo.mail.provider_accepted",
    ...context(template, diagnosticsId, bookingUid),
    ...(messageId ? { provider_message_id: messageId } : {}),
  };
}
