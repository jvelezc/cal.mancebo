import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../packages/i18n/locales/en/common.json";
vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => messages[key as keyof typeof messages] ?? key }),
}));
import { defaultConfirmationTemplate } from "@calcom/emails/lib/manceboConfirmationContent";
import type { ManceboEmailSettings } from "@calcom/emails/lib/manceboEmailPolicy";
import { ConfirmationEmailForm } from "./ConfirmationEmailForm";

const settings: ManceboEmailSettings = {
  scopeKey: "a3f8e672-e26d-4ef3-8af8-c4525b72fd58",
  workspaceName: "GentleBirth",
  saved: null,
  revision: 0,
  inheritedTemplate: defaultConfirmationTemplate,
  effectiveTemplate: defaultConfirmationTemplate,
  invalidSavedTemplate: false,
  linkedEventCount: 1,
  eventTypes: [
    { id: 5, title: "My planning call", slug: "planning", selected: true, assignedElsewhere: false },
    { id: 6, title: "Another workspace's call", slug: "elsewhere", selected: false, assignedElsewhere: true },
  ],
};
afterEach(cleanup);
function setup(value = settings) {
  const save = vi.fn();
  const dirty = vi.fn();
  render(<ConfirmationEmailForm settings={value} saving={false} onSave={save} onDirty={dirty} />);
  return { save, dirty };
}
describe("appointment confirmation wording form", () => {
  it("previews the inherited email with sample facts without sending or saving anything", () => {
    const { save } = setup();
    const preview = screen.getByTitle("Email preview");
    expect(preview.getAttribute("srcdoc")).toContain("Project planning call");
    expect(preview.getAttribute("srcdoc")).toContain("Appointment confirmed");
    expect(preview.getAttribute("sandbox")).toBe("");
    expect(screen.getByText("Using the platform default wording.")).toBeTruthy();
    expect(screen.getByLabelText("Subject").matches(":disabled")).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });
  it("edits wording and inserts a supported field before saving the selected own booking links", () => {
    const { save, dirty } = setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "Use custom wording" }));
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Your visit: " } });
    fireEvent.change(screen.getByRole("combobox", { name: "Add a personalization field: Subject" }), {
      target: { value: "appointment_title" },
    });
    fireEvent.change(screen.getByLabelText("Opening message"), {
      target: { value: "We look forward to meeting you." },
    });
    expect(screen.getByText("Your visit: Project planning call")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save email settings" }));
    expect(save).toHaveBeenCalledExactlyOnceWith({
      enabled: true,
      template: {
        ...defaultConfirmationTemplate,
        subject: "Your visit: {{appointment_title}}",
        introduction: "We look forward to meeting you.",
      },
      eventTypeIds: [5],
    });
    expect(dirty).toHaveBeenCalled();
    expect(
      (screen.getByRole("checkbox", { name: /Another workspace's call/ }) as HTMLInputElement).disabled
    ).toBe(true);
  });
  it("uses default wording without losing saved custom words or saving before confirmation", () => {
    const custom = { ...defaultConfirmationTemplate, introduction: "Saved custom greeting." };
    const { save } = setup({
      ...settings,
      saved: { ...custom, enabled: true, revision: 2, updatedAt: "2026-11-17T00:00:00Z" },
      revision: 2,
      effectiveTemplate: custom,
    });
    expect((screen.getByLabelText("Opening message") as HTMLTextAreaElement).value).toBe(custom.introduction);
    fireEvent.click(screen.getByRole("button", { name: "Use default wording" }));
    expect(screen.getByTitle("Email preview").getAttribute("srcdoc")).not.toContain(custom.introduction);
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save email settings" }));
    expect(save).toHaveBeenCalledExactlyOnceWith({ enabled: false, template: custom, eventTypeIds: [5] });
  });
  it("blocks an unknown personalization field and keeps its invalid text out of the preview", () => {
    const { save } = setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "Use custom wording" }));
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "{{private_secret}}" } });
    expect(screen.getByRole("alert").textContent).toContain("supported personalization fields");
    expect((screen.getByRole("button", { name: "Save email settings" }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect(screen.getByTitle("Email preview").getAttribute("srcdoc")).not.toContain("private_secret");
    expect(save).not.toHaveBeenCalled();
  });
  it("keeps global defaults separate from workspace booking link assignments", () => {
    setup({ ...settings, scopeKey: "platform", workspaceName: null, eventTypes: [] });
    expect(screen.getByText("Using Mancebo.ai's standard confirmation wording.")).toBeTruthy();
    expect(screen.queryByText("Your booking links for this workspace")).toBeNull();
  });
});
