import { randomUUID } from "node:crypto";
import { decodeHTML } from "entities";
import { z } from "zod";

import dayjs from "@calcom/dayjs";
import { FeaturesRepository } from "@calcom/features/flags/features.repository";
import isSmsCalEmail from "@calcom/lib/isSmsCalEmail";
import { serverConfig } from "@calcom/lib/serverConfig";
import { getServerErrorFromUnknown } from "@calcom/lib/server/getServerErrorFromUnknown";
import { setTestEmail } from "@calcom/lib/testEmails";
import { prisma } from "@calcom/prisma";

import { sanitizeDisplayName } from "../lib/sanitizeDisplayName";
import { mailAcceptanceEvidence, mailFailureEvidence } from "../lib/mailDeliveryEvidence";

export default class BaseEmail {
  name = "";

  protected getTimezone() {
    return "";
  }

  protected getLocale(): string {
    return "";
  }

  protected getFormattedRecipientTime({ time, format }: { time: string; format: string }) {
    return dayjs(time).tz(this.getTimezone()).locale(this.getLocale()).format(format);
  }

  protected async getNodeMailerPayload(): Promise<Record<string, unknown>> {
    return {};
  }
  public async sendEmail() {
    const diagnosticsId = randomUUID();
    const event = "calEvent" in this ? this.calEvent : undefined;
    const bookingUid =
      typeof event === "object" && event !== null && "uid" in event && typeof event.uid === "string"
        ? event.uid
        : undefined;
    const featuresRepository = new FeaturesRepository(prisma);
    const emailsDisabled = await featuresRepository.checkIfFeatureIsEnabledGlobally("emails");
    /** If email kill switch exists and is active, we prevent emails being sent. */
    if (emailsDisabled) {
      console.warn("Skipped Sending Email due to active Kill Switch");
      return new Promise((r) => r("Skipped Sending Email due to active Kill Switch"));
    }

    if (process.env.INTEGRATION_TEST_MODE === "true") {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      //@ts-expect-error
      setTestEmail(await this.getNodeMailerPayload());
      console.log(
        "Skipped Sending Email as process.env.NEXT_PUBLIC_UNIT_TESTS is set. Emails are available in globalThis.testEmails"
      );
      return new Promise((r) => r("Skipped sendEmail for Unit Tests"));
    }

    const payload = await this.getNodeMailerPayload();

    const from = "from" in payload ? (payload.from as string) : "";
    const to = "to" in payload ? (payload.to as string) : "";

    if (isSmsCalEmail(to)) {
      console.log(`Skipped Sending Email to faux email: ${to}`);
      return new Promise((r) => r(`Skipped Sending Email to faux email: ${to}`));
    }

    const sanitizedFrom = sanitizeDisplayName(from);
    const sanitizedTo = sanitizeDisplayName(to);

    const parseSubject = z.string().safeParse(payload?.subject);
    const payloadWithUnEscapedSubject = {
      headers: this.getMailerOptions().headers,
      ...payload,
      ...{
        from: sanitizedFrom,
        to: sanitizedTo,
      },
      ...(parseSubject.success && { subject: decodeHTML(parseSubject.data) }),
    };
    const { createTransport } = await import("nodemailer");
    await new Promise((resolve, reject) =>
      createTransport(this.getMailerOptions().transport).sendMail(
        payloadWithUnEscapedSubject,
        (_err, info) => {
          if (_err) {
            const err = getServerErrorFromUnknown(_err);
            reject(err);
          } else {
            console.info(JSON.stringify(mailAcceptanceEvidence(this.name, info, diagnosticsId, bookingUid)));
            resolve(info);
          }
        }
      )
    ).catch((error) =>
      this.printNodeMailerError(getServerErrorFromUnknown(error), diagnosticsId, bookingUid)
    );
    return new Promise((resolve) => resolve("send mail async"));
  }
  protected getMailerOptions() {
    return {
      transport: serverConfig.transport,
      from: serverConfig.from,
      headers: serverConfig.headers,
    };
  }
  protected printNodeMailerError(error: Error, diagnosticsId: string, bookingUid?: string): void {
    /** Don't clog the logs with unsent emails in E2E */
    if (process.env.NEXT_PUBLIC_IS_E2E === "true") return;
    console.error(JSON.stringify(mailFailureEvidence(this.name, error, diagnosticsId, bookingUid)));
  }
}
