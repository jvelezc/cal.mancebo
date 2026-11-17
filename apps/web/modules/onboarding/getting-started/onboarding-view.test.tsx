// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ push: vi.fn(), setSelectedPlan: vi.fn(), reset: vi.fn() }));
const router = { push: mocks.push };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("../store/onboarding-store", () => ({
  useOnboardingStore: () => ({
    selectedPlan: "team",
    setSelectedPlan: mocks.setSelectedPlan,
    resetOnboardingPreservingPlan: mocks.reset,
  }),
}));
vi.mock("../components/OnboardingLayout", () => ({
  OnboardingLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("../components/OnboardingCard", () => ({
  OnboardingCard: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h1>{title}</h1>
      {children}
    </section>
  ),
}));
vi.mock("../components/onboarding-continuation-prompt", () => ({ OnboardingContinuationPrompt: () => null }));
vi.mock("../components/plan-icon", () => ({ PlanIcon: () => null }));
vi.mock("@calcom/ui/components/badge", () => ({ Badge: () => null }));
vi.mock("@calcom/ui/components/button", () => ({ Button: () => null }));
vi.mock("@calcom/ui/components/radio", () => ({ RadioAreaGroup: { Group: () => null, Item: () => null } }));
vi.mock("@calcom/ui/classNames", () => ({ default: () => "" }));
vi.mock("framer-motion", () => ({ AnimatePresence: () => null }));
vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));

import { OnboardingView } from "./onboarding-view";

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

it("opens personal setup without offering upstream plans in Mancebo mode", () => {
  vi.stubEnv("NEXT_PUBLIC_MANCEBO_AUTH_ENABLED", "true");
  render(<OnboardingView userEmail="organizer@example.invalid" />);
  expect(mocks.setSelectedPlan).toHaveBeenCalledWith("personal");
  expect(mocks.push).toHaveBeenCalledWith("/onboarding/personal/settings");
  expect(screen.queryByText("onboarding_select_plan")).toBeNull();
  expect(screen.getByRole("heading", { name: "loading" })).toBeTruthy();
});

it("preserves upstream plan selection outside Mancebo mode", () => {
  vi.stubEnv("NEXT_PUBLIC_MANCEBO_AUTH_ENABLED", "false");
  render(<OnboardingView userEmail="organizer@example.invalid" />);
  expect(screen.getByRole("heading", { name: "onboarding_select_plan" })).toBeTruthy();
  expect(mocks.push).not.toHaveBeenCalled();
  expect(mocks.setSelectedPlan).not.toHaveBeenCalled();
});
