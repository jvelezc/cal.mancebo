// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ token: vi.fn(), headers: vi.fn(), cookies: vi.fn() }));
vi.mock("next/headers", () => ({ headers: mocks.headers, cookies: mocks.cookies }));
vi.mock("next-auth/jwt", () => ({ getToken: mocks.token }));
vi.mock("next/script", () => ({ default: () => null }));
vi.mock("../../components/PageWrapperAppDir", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../modules/auth/ManceboSessionBridge", () => ({
  ManceboSessionBridge: ({
    children,
    renderedSubject,
  }: {
    children: ReactNode;
    renderedSubject: string | null;
  }) => (
    <section data-testid="rendered-identity" data-subject={renderedSubject ?? "none"}>
      {children}
    </section>
  ),
}));
import Layout from "../../app/(use-page-wrapper)/layout";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_MANCEBO_AUTH_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_HEAD_SCRIPTS", "");
  vi.stubEnv("NEXT_PUBLIC_BODY_SCRIPTS", "");
  mocks.headers.mockResolvedValue(new Headers());
  mocks.cookies.mockResolvedValue({ getAll: () => [] });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});
describe("appointment server page identity context", () => {
  it("tags the rendered page with its signed native subject without exposing its token", async () => {
    mocks.token.mockResolvedValue({
      manceboSubject: "native-account-a",
      manceboAccessToken: "private-access-token",
    });
    render(await Layout({ children: <p>Page content</p> }));
    expect(screen.getByTestId("rendered-identity").getAttribute("data-subject")).toBe("native-account-a");
    expect(document.body.innerHTML).not.toContain("private-access-token");
    expect(mocks.token).toHaveBeenCalledTimes(1);
  });
  it.each([
    { name: "absent session", value: null },
    { name: "invalid subject type", value: { manceboSubject: 42 } },
  ])("passes an empty render context for $name", async ({ value }) => {
    mocks.token.mockResolvedValue(value);
    render(await Layout({ children: <p>Public handoff</p> }));
    expect(screen.getByTestId("rendered-identity").getAttribute("data-subject")).toBe("none");
    expect(mocks.token).toHaveBeenCalledTimes(1);
  });
  it("preserves the upstream wrapper when Mancebo managed sign-in is disabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_MANCEBO_AUTH_ENABLED", "false");
    render(await Layout({ children: <p>Original wrapper</p> }));
    expect(screen.getByText("Original wrapper")).toBeTruthy();
    expect(screen.queryByTestId("rendered-identity")).toBeNull();
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.cookies).not.toHaveBeenCalled();
  });
});
