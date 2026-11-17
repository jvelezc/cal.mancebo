// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  getSession: vi.fn(),
  pathname: "/event-types",
}));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("next-auth/react", () => mocks);
vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (key: string) => key }) }));

import { ManceboSessionBridge } from "./ManceboSessionBridge";

const parent = { postMessage: vi.fn() };
const originalParent = window.parent;
const subject = "a3f8e672-e26d-4ef3-8af8-c4525b72fd58";
const send = (data: object, origin = "https://mancebo.ai", source: unknown = parent) =>
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, origin, source: source as Window }));
  });
const session = (accessToken: string | null, id: string | null = subject) => ({
  type: "mancebo:appointments-session",
  accessToken,
  subject: id,
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname = "/event-types";
  Object.defineProperty(window, "parent", { configurable: true, value: parent });
  mocks.signIn.mockResolvedValue({ error: null });
  mocks.getSession.mockResolvedValue({ manceboSubject: subject });
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "parent", { configurable: true, value: originalParent });
});
const mount = () =>
  render(
    <ManceboSessionBridge>
      <p>Private appointments</p>
    </ManceboSessionBridge>
  );
describe("Mancebo appointment browser session boundary", () => {
  it("keeps the verified session connected during ordinary client navigation", async () => {
    const view = mount();
    send(session("token"));
    await screen.findByText("Private appointments");
    mocks.pathname = "/availability";
    view.rerender(
      <ManceboSessionBridge>
        <p>Private appointments</p>
      </ManceboSessionBridge>
    );
    send(session("token"));
    await act(async () => {});
    expect(mocks.signIn).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Private appointments")).toBeDefined();
    expect(screen.queryByRole("link", { name: "mancebo_appointments_continue" })).toBeNull();
  });

  it("shows a loading status and reserves the return action for a real connection failure", async () => {
    mocks.signIn.mockResolvedValue({ error: "AccessDenied" });
    mount();
    expect(screen.getByRole("status").textContent).toBe("mancebo_appointments_connecting");
    expect(screen.queryByRole("link", { name: "mancebo_appointments_continue" })).toBeNull();
    send(session("token"));
    await screen.findByText("mancebo_appointments_connection_failed");
    expect(screen.getByRole("link", { name: "mancebo_appointments_continue" }).getAttribute("target")).toBe(
      "_top"
    );
    expect(screen.queryByText("Private appointments")).toBeNull();
  });

  it("signs out once when a connected customer navigates to the logout route", async () => {
    const view = mount();
    send(session("token"));
    await screen.findByText("Private appointments");
    mocks.pathname = "/auth/logout";
    view.rerender(
      <ManceboSessionBridge>
        <p>Private appointments</p>
      </ManceboSessionBridge>
    );
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1));
    send(session("late-token"));
    await act(async () => {});
    expect(mocks.signIn).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Private appointments")).toBeNull();
    expect(
      parent.postMessage.mock.calls.filter(([message]) => message.type === "mancebo:appointments-sign-out")
    ).toHaveLength(1);
  });

  it("closes both sessions when an embedded native logout address is opened", async () => {
    mocks.pathname = "/auth/logout";
    mount();
    await waitFor(() =>
      expect(parent.postMessage).toHaveBeenCalledWith(
        { type: "mancebo:appointments-sign-out", subject: undefined },
        "https://mancebo.ai"
      )
    );
    expect(mocks.signOut).toHaveBeenCalledWith({ redirect: false });
    send(session("late-token"));
    await act(async () => {});
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(screen.queryByText("Private appointments")).toBeNull();
  });
  it("clears the native session before requesting Mancebo sign-out and refuses new handoffs", async () => {
    mount();
    send(session("token"));
    await screen.findByText("Private appointments");
    act(() => {
      window.dispatchEvent(new Event("mancebo:appointments-sign-out"));
    });
    await waitFor(() =>
      expect(parent.postMessage).toHaveBeenCalledWith(
        { type: "mancebo:appointments-sign-out", subject: undefined },
        "https://mancebo.ai"
      )
    );
    expect(mocks.signOut).toHaveBeenCalledWith({ redirect: false });
    send(session("new-token"));
    await act(async () => {});
    expect(mocks.signIn).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Private appointments")).toBeNull();
  });
  it("shows appointment content only after the owned parent and server identity agree", async () => {
    mount();
    expect(screen.queryByText("Private appointments")).toBeNull();
    send(session("synthetic-token"));
    await screen.findByText("Private appointments");
    expect(mocks.signIn).toHaveBeenCalledWith("mancebo", { accessToken: "synthetic-token", redirect: false });
    expect(parent.postMessage).toHaveBeenCalledWith(
      { type: "mancebo:appointments-connected", subject },
      "https://mancebo.ai"
    );
  });
  it("ignores an untrusted origin, sibling window or unrelated message", async () => {
    mount();
    send(session("token"), "https://another.mancebo.ai");
    send(session("token"), "https://mancebo.ai", {});
    send({ type: "unrelated", accessToken: "token" });
    await act(async () => {});
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(screen.queryByText("Private appointments")).toBeNull();
  });
  it("hides the interface when the verified identity differs from the parent account", async () => {
    mocks.getSession.mockResolvedValue({ manceboSubject: "another-account" });
    mount();
    send(session("token"));
    await screen.findByText("mancebo_appointments_connection_failed");
    expect(screen.queryByText("Private appointments")).toBeNull();
  });
  it("clears the native session and hides private content on Mancebo sign-out", async () => {
    mount();
    send(session("token"));
    await screen.findByText("Private appointments");
    send(session(null, null));
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledWith({ redirect: false }));
    expect(screen.queryByText("Private appointments")).toBeNull();
  });
  it("serializes account changes and never displays a stale sign-in result", async () => {
    const other = "1509ae0b-f8e4-44f0-abb4-647e19db11ac";
    mocks.getSession.mockResolvedValue({ manceboSubject: other });
    let finish: (value: { error: null }) => void = () => {};
    mocks.signIn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    mount();
    send(session("old-token"));
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledTimes(1));
    send(session("new-token", other));
    expect(mocks.signIn).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ error: null });
    });
    await screen.findByText("Private appointments");
    expect(mocks.signIn.mock.calls.map((call) => call[1].accessToken)).toEqual(["old-token", "new-token"]);
    expect(mocks.getSession).toHaveBeenCalledTimes(1);
  });
});
