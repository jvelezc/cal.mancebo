import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), authorize: vi.fn(), read: vi.fn(), save: vi.fn() }));
vi.mock("@calcom/features/auth/lib/mancebo-email-actor", () => ({ readManceboEmailActor: mocks.actor }));
vi.mock("@calcom/features/auth/lib/mancebo-workspaces", () => ({
  authorizeManceboEmailScope: mocks.authorize,
}));
vi.mock("@calcom/emails/lib/manceboEmailPolicy", () => ({
  readManceboEmailSettings: mocks.read,
  saveManceboEmailSettings: mocks.save,
}));
import { defaultConfirmationTemplate } from "@calcom/emails/lib/manceboConfirmationContent";
import { ErrorWithCode } from "@calcom/lib/errors";
import { ErrorCode } from "@calcom/lib/errorCodes";
import handler from "./email-templates";

const scope = "a3f8e672-e26d-4ef3-8af8-c4525b72fd58";
const workspace = { id: scope, name: "GentleBirth" };
const principal = { subject: "050833e4-b776-432e-a952-3caf861f29f8", platformAdministrator: false };
const actor = { nativeUserId: 3, principal, workspaces: [workspace] };
const body = {
  scope,
  expectedRevision: 2,
  enabled: true,
  template: defaultConfirmationTemplate,
  eventTypeIds: [5],
};
async function request(method = "GET", fields: Partial<NextApiRequest> = {}) {
  const response = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  await handler(
    {
      method,
      query: {},
      headers: { origin: "https://appointments.mancebo.ai" },
      ...fields,
    } as NextApiRequest,
    response as unknown as NextApiResponse
  );
  return { status: response.status.mock.calls[0][0], body: response.json.mock.calls[0][0], response };
}
describe("appointment email settings HTTP API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.actor.mockResolvedValue(actor);
    mocks.authorize.mockReturnValue({ scopeKey: scope, workspace });
    mocks.read.mockResolvedValue({ revision: 2 });
    mocks.save.mockResolvedValue({ revision: 3 });
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  it("lists only verified editable workspace metadata without creating or saving settings", async () => {
    const result = await request();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ canEditPlatform: false, workspaces: [workspace] });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(result.response.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
  });
  it("checks scope permission before reading settings for the current native user", async () => {
    const result = await request("GET", { query: { scope } });
    expect(result.status).toBe(200);
    expect(mocks.authorize).toHaveBeenCalledExactlyOnceWith(scope, principal, [workspace]);
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith({ scopeKey: scope, workspace }, 3);
    expect(result.body.settings).toEqual({ revision: 2 });
  });
  it("saves using verified actor identity rather than caller-supplied ownership", async () => {
    const result = await request("PUT", { body });
    expect(result.status).toBe(200);
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({
      ...body,
      scope: { scopeKey: scope, workspace },
      nativeUserId: 3,
      manceboSubject: principal.subject,
    });
    expect(result.body).toEqual({ revision: 3 });
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(body.template.introduction);
  });
  it.each([
    undefined,
    "https://another.mancebo.ai",
    "https://attacker.example.test",
  ])("rejects a foreign or absent mutation origin %s before reading the session", async (origin) => {
    const result = await request("PUT", { headers: { origin }, body });
    expect(result.status).toBe(403);
    expect(mocks.actor).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("does not authorize an absent session through a submitted workspace", async () => {
    mocks.actor.mockRejectedValue(
      new ErrorWithCode(ErrorCode.Unauthorized, "Sign in to Mancebo to continue.")
    );
    const result = await request("PUT", { body });
    expect(result.status).toBe(401);
    expect(mocks.authorize).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each(["GET", "PUT"])("denies a forged scope on %s before reading or saving policy", async (method) => {
    mocks.authorize.mockImplementation(() => {
      throw new ErrorWithCode(ErrorCode.Forbidden, "Not authorized.");
    });
    const result = await request(method, { body, query: { scope } });
    expect(result.status).toBe(403);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each([
    { name: "forged owner", value: { ...body, nativeUserId: 1 } },
    {
      name: "unsupported placeholder",
      value: { ...body, template: { ...body.template, subject: "{{secret}}" } },
    },
    {
      name: "header injection",
      value: { ...body, template: { ...body.template, subject: "Hello\r\nBcc: hidden@example.test" } },
    },
  ])("rejects $name without saving", async ({ value }) => {
    const result = await request("PUT", { body: value });
    expect(result.status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("returns a conflict instead of replaying a stale update", async () => {
    mocks.save.mockRejectedValue(
      new ErrorWithCode(ErrorCode.BadRequest, "Reload before saving.", { reason: "revision_conflict" })
    );
    const result = await request("PUT", { body });
    expect(result.status).toBe(409);
    expect(result.body.error).toBe("SETTINGS_CHANGED");
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });
  it("redacts private failures in responses and structured logs while retaining a support reference", async () => {
    mocks.read.mockRejectedValue(new Error("private-token-and-recipient@example.test"));
    const result = await request("GET", { query: { scope } });
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ error: "SETTINGS_UNAVAILABLE", retrySafe: true });
    expect(result.body.diagnosticId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify([result.body, vi.mocked(console.warn).mock.calls])).not.toContain(
      "private-token-and-recipient"
    );
    expect(JSON.parse(vi.mocked(console.warn).mock.calls[0][0])).toMatchObject({
      diagnostic_id: result.body.diagnosticId,
      status: 503,
    });
  });
  it("rejects unsupported HTTP methods without reading authentication or mutating data", async () => {
    const result = await request("POST", { body });
    expect(result.status).toBe(405);
    expect(result.response.setHeader).toHaveBeenCalledWith("Allow", "GET, PUT");
    expect(mocks.actor).not.toHaveBeenCalled();
  });
});
