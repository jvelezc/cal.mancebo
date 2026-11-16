// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), read: vi.fn() }));
vi.mock("@calcom/prisma", () => ({ default: { user: mocks } }));
vi.mock("@calcom/prisma/enums", () => ({
  IdentityProvider: { MANCEBO: "MANCEBO" },
  UserPermissionRole: { USER: "USER", ADMIN: "ADMIN" },
}));
vi.mock("@calcom/features/profile/repositories/ProfileRepository", () => ({
  ProfileRepository: {
    findAllProfilesForUserIncludingMovedUser: vi
      .fn()
      .mockResolvedValue([{ id: null, upId: "usr-7", organizationId: null }]),
  },
}));
vi.mock("./mancebo-principal", () => ({ readManceboPrincipal: mocks.read }));

import { authorizeMancebo, manceboSessionToken } from "./mancebo-auth";

const subject = "a3f8e672-e26d-4ef3-8af8-c4525b72fd58";
const native = {
  id: 7,
  uuid: subject,
  username: "person",
  name: "Person",
  email: "person@example.test",
  role: "USER",
  locked: false,
  locale: "en",
  manceboUserId: subject,
  identityProvider: "MANCEBO",
};
const authorize = () => authorizeMancebo({ accessToken: "synthetic-token" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue({
    subject,
    email: native.email,
    expiresAt: Math.floor(Date.now() / 1000) + 60,
    platformAdministrator: false,
  });
  mocks.findUnique.mockResolvedValue(native);
});
describe("Mancebo appointment profile authorization", () => {
  it("looks up an immutable subject rather than linking by email", async () => {
    const result = await authorize();
    expect(result).toMatchObject({ id: 7, manceboSubject: subject });
    expect(mocks.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { manceboUserId: subject } })
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("creates only an ordinary user without a native password or team grant", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.create.mockResolvedValue(native);
    await authorize();
    const data = mocks.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ manceboUserId: subject, role: "USER", identityProvider: "MANCEBO" });
    expect(data).not.toHaveProperty("password");
    expect(data).not.toHaveProperty("teams");
  });
  it("refuses a legacy email collision rather than taking over an account", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.create.mockRejectedValue(new Error("unique email"));
    await expect(authorize()).rejects.toThrow("MANCEBO_PROFILE_LINK_REQUIRED");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("fails closed for locked or legacy native accounts", async () => {
    mocks.findUnique.mockResolvedValue({ ...native, locked: true });
    await expect(authorize()).rejects.toThrow("MANCEBO_SIGN_IN_REQUIRED");
    mocks.findUnique.mockResolvedValue({ ...native, identityProvider: "CAL" });
    await expect(authorize()).rejects.toThrow("MANCEBO_SIGN_IN_REQUIRED");
  });
  it("removes native admin privilege when central admin access is removed", async () => {
    mocks.findUnique.mockResolvedValue({ ...native, role: "ADMIN" });
    const result = await authorize();
    expect(result?.role).toBe("USER");
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { email: native.email, role: "USER" },
    });
  });
  it("revalidates sessions and refuses legacy or switched identities", async () => {
    await expect(manceboSessionToken({ id: 7 })).rejects.toThrow("MANCEBO_SIGN_IN_REQUIRED");
    await expect(
      manceboSessionToken({ manceboAccessToken: "token", manceboSubject: "different" })
    ).rejects.toThrow("MANCEBO_SIGN_IN_REQUIRED");
    const result = await manceboSessionToken({
      manceboAccessToken: "token",
      role: "ADMIN",
      org: { id: 99, slug: "forged", fullDomain: "", domainSuffix: "", role: "OWNER" },
    });
    expect(result).toMatchObject({ id: 7, role: "USER", upId: "usr-7" });
    expect(result).not.toHaveProperty("org");
  });
});
