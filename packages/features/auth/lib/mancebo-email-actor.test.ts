import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ token: vi.fn(), principal: vi.fn(), user: vi.fn(), workspaces: vi.fn() }));
vi.mock("next-auth/jwt", () => ({ getToken: mocks.token }));
vi.mock("@calcom/prisma", () => ({ default: { user: { findUnique: mocks.user } } }));
vi.mock("./mancebo-principal", () => ({ readManceboPrincipal: mocks.principal }));
vi.mock("./mancebo-workspaces", () => ({ readManceboEditableWorkspaces: mocks.workspaces }));
import type { NextApiRequest } from "next";
import { readManceboEmailActor } from "./mancebo-email-actor";
const subject = "050833e4-b776-432e-a952-3caf861f29f8";
const req = { headers: {} } as NextApiRequest;
const token = { sub: "3", manceboSubject: subject, manceboAccessToken: "human-session-only" };
const principal = {
  subject,
  email: "synthetic@example.test",
  platformAdministrator: false,
  expiresAt: 9999999999,
};
const user = { id: 3, manceboUserId: subject, identityProvider: "MANCEBO", locked: false };

describe("appointment email actor", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("MANCEBO_AUTH_ENABLED", "true");
    mocks.token.mockResolvedValue(token);
    mocks.principal.mockResolvedValue(principal);
    mocks.user.mockResolvedValue(user);
    mocks.workspaces.mockResolvedValue([{ id: "workspace", name: "Synthetic organization" }]);
  });
  it("uses the verified human identity and never returns the saved session token", async () => {
    const actor = await readManceboEmailActor(req);
    expect(mocks.user).toHaveBeenCalledExactlyOnceWith({
      where: { manceboUserId: subject },
      select: { id: true, manceboUserId: true, identityProvider: true, locked: true },
    });
    expect(mocks.workspaces).toHaveBeenCalledWith(token.manceboAccessToken, principal, expect.any(Function));
    expect(actor).toEqual({
      nativeUserId: 3,
      principal,
      workspaces: [{ id: "workspace", name: "Synthetic organization" }],
    });
    expect(JSON.stringify(actor)).not.toContain(token.manceboAccessToken);
  });
  it("rejects an absent native session before reading account permissions", async () => {
    mocks.token.mockResolvedValue(null);
    await expect(readManceboEmailActor(req)).rejects.toMatchObject({ code: "unauthorized_error" });
    expect(mocks.principal).not.toHaveBeenCalled();
    expect(mocks.user).not.toHaveBeenCalled();
  });
  it("rejects an expired or revoked Mancebo session without reading native settings", async () => {
    mocks.principal.mockRejectedValue(new Error("MANCEBO_SIGN_IN_REQUIRED"));
    await expect(readManceboEmailActor(req)).rejects.toMatchObject({ code: "unauthorized_error" });
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.workspaces).not.toHaveBeenCalled();
  });
  it("rejects an account switch that does not match the encrypted session", async () => {
    mocks.principal.mockResolvedValue({ ...principal, subject: "another-person" });
    await expect(readManceboEmailActor(req)).rejects.toMatchObject({ code: "unauthorized_error" });
    expect(mocks.user).not.toHaveBeenCalled();
  });
  it.each([
    { name: "locked", value: { ...user, locked: true } },
    { name: "legacy identity", value: { ...user, identityProvider: "CAL" } },
    { name: "different native user", value: { ...user, id: 4 } },
    { name: "missing immutable link", value: { ...user, manceboUserId: null } },
    { name: "absent profile", value: null },
  ])("rejects $name before loading editable workspaces", async ({ value }) => {
    mocks.user.mockResolvedValue(value);
    await expect(readManceboEmailActor(req)).rejects.toMatchObject({ code: "unauthorized_error" });
    expect(mocks.workspaces).not.toHaveBeenCalled();
  });
  it("keeps identity service outages distinct from a request to sign in again", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("private-provider-error", { status: 503 }))
    );
    mocks.principal.mockImplementation(async (_token, request: typeof fetch) => {
      await request("https://identity.example.test/user");
      return principal;
    });
    await expect(readManceboEmailActor(req)).rejects.toMatchObject({
      code: "internal_server_error",
      data: { reason: "identity_unavailable", retry_safe: true },
    });
    expect(mocks.user).not.toHaveBeenCalled();
  });
  it("does not serve email settings when managed identity is disabled", async () => {
    vi.stubEnv("MANCEBO_AUTH_ENABLED", "false");
    vi.stubEnv("NEXT_PUBLIC_MANCEBO_AUTH_ENABLED", "false");
    await expect(readManceboEmailActor(req)).rejects.toMatchObject({ code: "forbidden_error" });
    expect(mocks.token).not.toHaveBeenCalled();
  });
});
