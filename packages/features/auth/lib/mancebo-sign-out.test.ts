// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock("next-auth/react", () => mocks);
import { signOut } from "./mancebo-sign-out";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

it("requests unified Mancebo sign-out instead of independently reopening a native session", async () => {
  vi.stubEnv("NEXT_PUBLIC_MANCEBO_AUTH_ENABLED", "true");
  const received = vi.fn();
  window.addEventListener("mancebo:appointments-sign-out", received);
  try {
    await signOut({ callbackUrl: "/auth/logout" });
    expect(received).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("mancebo:appointments-sign-out", received);
  }
});

it("keeps native sign-out options outside Mancebo mode", async () => {
  vi.stubEnv("NEXT_PUBLIC_MANCEBO_AUTH_ENABLED", "false");
  await signOut({ callbackUrl: "/auth/logout" });
  expect(mocks.signOut).toHaveBeenCalledWith({ callbackUrl: "/auth/logout" });
});
