import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../packages/i18n/locales/en/common.json";
const translate = (key: string) => messages[key as keyof typeof messages] ?? key;
vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: translate }) }));
vi.mock("../shell/Shell", () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("./ConfirmationEmailForm", () => ({
  ConfirmationEmailForm: ({
    settings,
    onSave,
    onDirty,
  }: {
    settings: { workspaceName: string; saved?: { subject: string } };
    onSave: (value: object) => void;
    onDirty: (value: boolean) => void;
  }) => (
    <div>
      <h2>{settings.workspaceName} wording</h2>
      <input
        aria-label="Draft wording"
        defaultValue={settings.saved?.subject ?? "Keep my draft"}
        onChange={() => onDirty(true)}
      />
      <button
        onClick={() => onSave({ enabled: true, template: { subject: "Your visit" }, eventTypeIds: [5] })}>
        Save draft
      </button>
      <button
        onClick={() =>
          onSave({ enabled: false, template: { subject: "Unsaved changed words" }, eventTypeIds: [5] })
        }>
        Reset draft
      </button>
    </div>
  ),
}));
import AppointmentEmailSettings from "./AppointmentEmailSettings";

const first = { id: "a3f8e672-e26d-4ef3-8af8-c4525b72fd58", name: "GentleBirth" };
const second = { id: "1509ae0b-f8e4-44f0-abb4-647e19db11ac", name: "Second workspace" };
const metadata = { canEditPlatform: false, workspaces: [first, second] };
const response = (workspaceName: string) =>
  new Response(JSON.stringify({ settings: { workspaceName, revision: 4 } }));
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("appointment email settings journey", () => {
  it("opens only an authorized requested workspace and saves with its loaded revision", async () => {
    fetcher.mockResolvedValueOnce(response(first.name));
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ revision: 5 })));
    render(<AppointmentEmailSettings metadata={metadata} initialScope={first.id} />);
    await screen.findByRole("heading", { name: "GentleBirth wording" });
    expect(fetcher.mock.calls[0][0]).toBe(`/api/mancebo/email-templates?scope=${first.id}`);
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByText(/Email settings saved/);
    const init = fetcher.mock.calls[1][1];
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toEqual({
      scope: first.id,
      expectedRevision: 4,
      enabled: true,
      template: { subject: "Your visit" },
      eventTypeIds: [5],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("option", { name: "Platform default — all workspaces" })).toBeNull();
  });
  it("clears the old workspace immediately and ignores an earlier response after switching scope", async () => {
    let resolveFirst: (value: Response) => void = () => {};
    fetcher.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
    );
    fetcher.mockResolvedValueOnce(response(second.name));
    render(<AppointmentEmailSettings metadata={metadata} initialScope={first.id} />);
    fireEvent.change(screen.getByLabelText("Edit emails for"), { target: { value: second.id } });
    await screen.findByRole("heading", { name: "Second workspace wording" });
    await act(async () => resolveFirst(response(first.name)));
    expect(screen.queryByRole("heading", { name: "GentleBirth wording" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Second workspace wording" })).toBeTruthy();
    expect(fetcher.mock.calls[1][0]).toContain(second.id);
  });
  it("keeps a rejected draft and focuses its actionable error without retrying the save", async () => {
    fetcher.mockResolvedValueOnce(response(first.name));
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "A newer setting was saved. Reload before saving." }), {
        status: 409,
      })
    );
    render(<AppointmentEmailSettings metadata={metadata} initialScope={first.id} />);
    await screen.findByRole("heading", { name: "GentleBirth wording" });
    fireEvent.change(screen.getByLabelText("Draft wording"), { target: { value: "My unsaved words" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Reload before saving");
    expect(document.activeElement).toBe(alert);
    expect((screen.getByLabelText("Draft wording") as HTMLInputElement).value).toBe("My unsaved words");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("keeps the selected workspace and draft when discarding unsaved changes is declined", async () => {
    fetcher.mockResolvedValue(response(first.name));
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AppointmentEmailSettings metadata={metadata} initialScope={first.id} />);
    await screen.findByRole("heading", { name: "GentleBirth wording" });
    fireEvent.change(screen.getByLabelText("Draft wording"), { target: { value: "My draft" } });
    fireEvent.change(screen.getByLabelText("Edit emails for"), { target: { value: second.id } });
    expect((screen.getByLabelText("Edit emails for") as HTMLSelectElement).value).toBe(first.id);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not offer editor scopes to a person without an editable workspace", () => {
    render(<AppointmentEmailSettings metadata={{ canEditPlatform: false, workspaces: [] }} />);
    expect(screen.getByRole("status").textContent).toContain("Only a workspace administrator");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("distinguishes an account permission outage from missing administrator access", () => {
    render(
      <AppointmentEmailSettings
        metadata={{ canEditPlatform: false, workspaces: [] }}
        permissionsUnavailable
      />
    );
    expect(screen.getByRole("alert").textContent).toContain("could not check your account permissions");
    expect(screen.queryByText(/Only a workspace administrator/)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not select another workspace when the requested scope is unauthorized", () => {
    render(
      <AppointmentEmailSettings
        metadata={{ ...metadata, canEditPlatform: true }}
        initialScope="unrelated-workspace"
      />
    );
    expect((screen.getByLabelText("Edit emails for") as HTMLSelectElement).value).toBe("");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("redacts an unexpected load failure and does not retry automatically", async () => {
    fetcher.mockRejectedValue(new TypeError("private-source-and-credential"));
    render(<AppointmentEmailSettings metadata={metadata} initialScope={first.id} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Email settings could not be loaded. Try reloading the saved settings.");
    expect(document.body.textContent).not.toContain("private-source-and-credential");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("restores the last saved custom words after a successful inheritance reset", async () => {
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          settings: {
            workspaceName: first.name,
            revision: 4,
            saved: {
              subject: "Last saved words",
              greeting: "Hello",
              introduction: "Welcome",
              closing: "Thank you",
            },
          },
        })
      )
    );
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ revision: 5 })));
    render(<AppointmentEmailSettings metadata={metadata} initialScope={first.id} />);
    await screen.findByRole("heading", { name: "GentleBirth wording" });
    fireEvent.change(screen.getByLabelText("Draft wording"), { target: { value: "Unsaved changed words" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset draft" }));
    await screen.findByText(/Email settings saved/);
    expect((screen.getByLabelText("Draft wording") as HTMLInputElement).value).toBe("Last saved words");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
