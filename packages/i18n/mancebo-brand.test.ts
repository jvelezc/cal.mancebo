import { describe, expect, it } from "vitest";
import { brandSchedulingTranslations } from "./mancebo-brand";

describe("Mancebo scheduling product copy", () => {
  it("brands product text while preserving translation IDs, rich text and interpolation", () => {
    expect(
      brandSchedulingTranslations({
        sign_in_to_cal_com: "Sign in to Cal.diy",
        localized: "<0>Cal.com</0> {{name}}",
        ordinary: "Google Calendar",
      })
    ).toEqual({
      sign_in_to_cal_com: "Sign in to Mancebo.ai",
      localized: "<0>Mancebo.ai</0> {{name}}",
      ordinary: "Google Calendar",
    });
  });
  it("keeps upstream links, legal attribution and provider identifiers accurate", () => {
    expect(
      brandSchedulingTranslations({
        source: "https://github.com/calcom/cal.diy",
        docs: "https://cal.com/docs",
        legal: "Cal.com, Inc.",
        host: "app.cal.com",
        provider: "Cal Video",
      })
    ).toEqual({
      source: "https://github.com/calcom/cal.diy",
      docs: "https://cal.com/docs",
      legal: "Cal.com, Inc.",
      host: "app.cal.com",
      provider: "Cal Video",
    });
  });
});
