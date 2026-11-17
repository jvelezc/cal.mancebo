import { describe, expect, it } from "vitest";
import { mailAcceptanceEvidence, mailFailureEvidence } from "./mailDeliveryEvidence";

describe("private mail diagnostics", () => {
  it("records a repairable SMTP cause without credentials, addresses, subject or raw booking token", () => {
    const record = mailFailureEvidence(
      "SEND_BOOKING_CONFIRMATION",
      {
        code: "EAUTH",
        responseCode: 535,
        message: "secret-password recipient@example.test private subject",
        connection: { password: "secret-password" },
      },
      "trace-123",
      "private-booking-token"
    );
    expect(record).toMatchObject({
      event: "mancebo.mail.failed",
      code: "EAUTH",
      smtp_status: 535,
      diagnostics_id: "trace-123",
      action: "repair_transport_then_resend",
    });
    expect(record.booking_ref_sha256).toMatch(/^[a-f0-9]{64}$/);
    const serialized = JSON.stringify(record);
    for (const secret of [
      "secret-password",
      "recipient@example.test",
      "private subject",
      "private-booking-token",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("requires provider review for uncertain failures rather than promising a safe retry", () => {
    expect(mailFailureEvidence("BOOKING", { code: "ETIMEDOUT" }, "trace-1")).toMatchObject({
      code: "ETIMEDOUT",
      action: "review_provider_receipt_before_resend",
    });
    expect(mailFailureEvidence("BOOKING", "secret error body", "trace-2")).toMatchObject({
      code: "MAIL_DELIVERY_FAILED",
      action: "review_provider_receipt_before_resend",
    });
  });

  it("records provider acceptance without claiming inbox delivery or logging the envelope", () => {
    const record = mailAcceptanceEvidence(
      "BOOKING",
      { messageId: "<receipt@example.test>", envelope: { to: ["private-recipient@example.test"] } },
      "trace-3"
    );
    expect(record).toMatchObject({
      event: "mancebo.mail.provider_accepted",
      provider_message_id: "<receipt@example.test>",
    });
    expect(JSON.stringify(record)).not.toContain("private-recipient");
    expect(record).not.toHaveProperty("delivered");
  });
});
