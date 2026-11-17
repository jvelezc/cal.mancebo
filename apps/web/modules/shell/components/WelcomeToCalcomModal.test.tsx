// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ closeModal: vi.fn() }));
vi.mock("@calcom/lib/constants", () => ({ APP_NAME: "Mancebo.ai" }));
vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("../hooks/useWelcomeToCalcomModal", () => ({
  useWelcomeToCalcomModal: () => ({ isOpen: true, closeModal: mocks.closeModal }),
}));
vi.mock("@calcom/ui/components/button", () => ({
  Button: ({
    children,
    href,
    target,
    onClick,
  }: {
    children: ReactNode;
    href?: string;
    target?: string;
    onClick?: () => void;
  }) =>
    href ? (
      <a href={href} target={target}>
        {children}
      </a>
    ) : (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
}));
vi.mock("@calcom/ui/components/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@calcom/ui/components/logo", () => ({ Logo: () => <span>Mancebo.ai</span> }));
vi.mock("@coss/ui/icons", () => ({ CheckIcon: () => null, UserIcon: () => null }));

import { WelcomeToCalcomModal } from "./WelcomeToCalcomModal";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it("welcomes Mancebo users with available appointment tasks and the specific guide", () => {
  vi.stubEnv("NEXT_PUBLIC_MANCEBO_AUTH_ENABLED", "true");
  render(<WelcomeToCalcomModal />);
  expect(screen.getByText("mancebo_appointments_hours")).toBeTruthy();
  expect(screen.getByText("mancebo_appointments_links")).toBeTruthy();
  expect(screen.getByText("mancebo_appointments_review")).toBeTruthy();
  expect(screen.queryByText("cal_ai_phone_agent")).toBeNull();
  expect(screen.queryByText("accept_payments_via_stripe")).toBeNull();
  expect(screen.queryByText("cal_video")).toBeNull();
  expect(screen.getByRole("link", { name: "learn_more" }).getAttribute("href")).toBe(
    "https://mancebo.ai/docs?topic=appointments"
  );
  fireEvent.click(screen.getByRole("button", { name: "continue" }));
  expect(mocks.closeModal).toHaveBeenCalledTimes(1);
});

it("keeps upstream features outside Mancebo mode", () => {
  vi.stubEnv("NEXT_PUBLIC_MANCEBO_AUTH_ENABLED", "false");
  render(<WelcomeToCalcomModal />);
  expect(screen.getByText("cal_ai_phone_agent")).toBeTruthy();
  expect(screen.getByRole("link", { name: "learn_more" }).getAttribute("href")).toBe("https://cal.diy");
});
