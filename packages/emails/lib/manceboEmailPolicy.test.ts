import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  template: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  binding: { count: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
  eventType: { findMany: vi.fn() },
  beforeTransaction: vi.fn(),
  options: vi.fn(),
}));
vi.mock("@calcom/prisma", () => {
  const tx = {
    manceboAppointmentEmailTemplate: mocks.template,
    manceboEventEmailWorkspace: mocks.binding,
    eventType: mocks.eventType,
  };
  return {
    default: {
      ...tx,
      $transaction: async (action: (value: typeof tx) => Promise<unknown>, options: object) => {
        mocks.beforeTransaction();
        mocks.options(options);
        return action(tx);
      },
    },
  };
});
import { defaultConfirmationTemplate } from "./manceboConfirmationContent";
import { readManceboEmailSettings, saveManceboEmailSettings } from "./manceboEmailPolicy";
const workspace = { id: "a3f8e672-e26d-4ef3-8af8-c4525b72fd58", name: "GentleBirth" };
const scope = { scopeKey: workspace.id, workspace };
const other = "1509ae0b-f8e4-44f0-abb4-647e19db11ac";
const saved = {
  ...defaultConfirmationTemplate,
  enabled: true,
  revision: 1,
  updatedAt: new Date("2026-11-17T00:00:00Z"),
};
const input = {
  scope,
  nativeUserId: 7,
  manceboSubject: "050833e4-b776-432e-a952-3caf861f29f8",
  expectedRevision: 0,
  enabled: true,
  template: defaultConfirmationTemplate,
  eventTypeIds: [12],
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.template.findUnique.mockResolvedValue(null);
  mocks.template.updateMany.mockResolvedValue({ count: 1 });
  mocks.eventType.findMany.mockResolvedValue([
    { id: 12, title: "Intro", slug: "intro", manceboEmailWorkspace: null },
  ]);
  mocks.binding.count.mockResolvedValue(0);
});
const expectNoMutation = () => {
  expect(mocks.template.create).not.toHaveBeenCalled();
  expect(mocks.template.updateMany).not.toHaveBeenCalled();
  expect(mocks.binding.deleteMany).not.toHaveBeenCalled();
  expect(mocks.binding.createMany).not.toHaveBeenCalled();
};
describe("Mancebo appointment email policy", () => {
  it("inherits the platform wording while retaining disabled workspace custom words", async () => {
    mocks.template.findUnique.mockImplementation(async ({ where }) =>
      where.scopeKey === "platform"
        ? { ...saved, introduction: "Platform welcome" }
        : { ...saved, enabled: false, introduction: "Previous custom words" }
    );
    const result = await readManceboEmailSettings(scope, 7);
    expect(result.effectiveTemplate.introduction).toBe("Platform welcome");
    expect(result.saved).toMatchObject({ enabled: false, introduction: "Previous custom words" });
    expectNoMutation();
  });
  it("uses an enabled valid workspace override and reports an invalid saved override", async () => {
    mocks.template.findUnique.mockResolvedValue({ ...saved, introduction: "Workspace welcome" });
    expect((await readManceboEmailSettings(scope, 7)).effectiveTemplate.introduction).toBe(
      "Workspace welcome"
    );
    mocks.template.findUnique.mockResolvedValue({ ...saved, introduction: "{{unknown}}" });
    const fallback = await readManceboEmailSettings(scope, 7);
    expect(fallback.invalidSavedTemplate).toBe(true);
    expect(fallback.effectiveTemplate).toEqual(defaultConfirmationTemplate);
  });
  it("does not reveal another workspace identifier in the current owner's booking links", async () => {
    mocks.eventType.findMany.mockResolvedValue([
      { id: 12, title: "Intro", slug: "intro", manceboEmailWorkspace: { workspaceId: other } },
    ]);
    const result = await readManceboEmailSettings(scope, 7);
    expect(result.eventTypes).toEqual([
      { id: 12, title: "Intro", slug: "intro", selected: false, assignedElsewhere: true },
    ]);
    expect(JSON.stringify(result)).not.toContain(other);
  });
  it("saves only owned links within the authorized workspace using a serializable transaction", async () => {
    expect(await saveManceboEmailSettings(input)).toEqual({ revision: 1 });
    expect(mocks.options).toHaveBeenCalledWith({ isolationLevel: "Serializable" });
    expect(mocks.eventType.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [12] }, userId: 7, teamId: null } })
    );
    expect(mocks.binding.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: workspace.id, eventType: { userId: 7, teamId: null } },
    });
    expect(mocks.binding.createMany).toHaveBeenCalledWith({
      data: [
        {
          eventTypeId: 12,
          workspaceId: workspace.id,
          workspaceName: "GentleBirth",
          linkedByManceboUserId: input.manceboSubject,
        },
      ],
    });
  });
  it("rejects a foreign owner's link before changing any policy or binding", async () => {
    mocks.eventType.findMany.mockResolvedValue([]);
    await expect(saveManceboEmailSettings(input)).rejects.toMatchObject({ code: "forbidden_error" });
    expectNoMutation();
  });
  it("does not overwrite a link assigned to a different workspace", async () => {
    mocks.eventType.findMany.mockResolvedValue([{ id: 12, manceboEmailWorkspace: { workspaceId: other } }]);
    await expect(saveManceboEmailSettings(input)).rejects.toMatchObject({
      data: { reason: "assignment_conflict" },
    });
    expectNoMutation();
  });
  it("refuses a stale revision before any change and preserves words when resetting inheritance", async () => {
    mocks.template.findUnique.mockResolvedValue({ ...saved, introduction: "Keep my words" });
    await expect(saveManceboEmailSettings(input)).rejects.toMatchObject({
      data: { reason: "revision_conflict" },
    });
    expectNoMutation();
    await saveManceboEmailSettings({ ...input, expectedRevision: 1, enabled: false });
    expect(mocks.template.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scopeKey: workspace.id, revision: 1 },
        data: expect.objectContaining({
          enabled: false,
          introduction: "Keep my words",
          revision: { increment: 1 },
        }),
      })
    );
  });
  it("treats a lost optimistic update as a conflict before changing bindings", async () => {
    mocks.template.findUnique.mockResolvedValue(saved);
    mocks.template.updateMany.mockResolvedValue({ count: 0 });
    await expect(saveManceboEmailSettings({ ...input, expectedRevision: 1 })).rejects.toMatchObject({
      data: { reason: "revision_conflict" },
    });
    expect(mocks.binding.deleteMany).not.toHaveBeenCalled();
  });
  it.each([
    "P2002",
    "P2034",
  ])("does not automatically replay uncertain concurrent transaction %s", async (code) => {
    mocks.beforeTransaction.mockImplementation(() => {
      throw { code, message: "private-database-detail" };
    });
    const result = saveManceboEmailSettings(input);
    await expect(result).rejects.toMatchObject({ data: { reason: "revision_conflict" } });
    await expect(result).rejects.not.toThrow("private");
    expect(mocks.beforeTransaction).toHaveBeenCalledTimes(1);
    expectNoMutation();
  });
  it("rejects duplicate link choices and disallows binding links to the global default", async () => {
    await expect(saveManceboEmailSettings({ ...input, eventTypeIds: [12, 12] })).rejects.toThrow("once");
    await expect(
      saveManceboEmailSettings({ ...input, scope: { scopeKey: "platform", workspace: null } })
    ).rejects.toThrow("within a workspace");
    expectNoMutation();
  });
});
