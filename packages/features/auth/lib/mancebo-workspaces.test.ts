import { describe, expect, it, vi } from "vitest";
vi.mock("./mancebo-principal", () => ({
  identityUrl: "https://ffpqxlrfbjyvxsfrnyqm.supabase.co",
  publishableKey: "sb_publishable_fixture",
}));
import { authorizeManceboEmailScope, readManceboEditableWorkspaces } from "./mancebo-workspaces";

const subject = "050833e4-b776-432e-a952-3caf861f29f8";
const workspace = { id: "a3f8e672-e26d-4ef3-8af8-c4525b72fd58", name: "GentleBirth", status: "active" };
const other = "1509ae0b-f8e4-44f0-abb4-647e19db11ac";
const principal = {
  subject,
  email: "fixture@example.com",
  expiresAt: 2000000000,
  platformAdministrator: false,
};
const membership = { tenant_id: workspace.id, user_id: subject, role: "tenant_admin", status: "active" };
function fixture(tenants = [workspace], memberships = [membership]) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    const source = url.pathname.endsWith("/tenant_membership") ? memberships : tenants;
    const offset = Number(url.searchParams.get("offset"));
    return new Response(JSON.stringify(source.slice(offset, offset + 250)));
  });
}

describe("Mancebo appointment email workspace authority", () => {
  it("uses the verified human token and current administrator membership under RLS", async () => {
    const request = fixture();
    const available = await readManceboEditableWorkspaces("human-token", principal, request);
    expect(available).toEqual([{ id: workspace.id, name: "GentleBirth" }]);
    expect(authorizeManceboEmailScope(workspace.id, principal, available)).toEqual({
      scopeKey: workspace.id,
      workspace: available[0],
    });
    for (const [input, options] of request.mock.calls) {
      expect(String(input).startsWith("https://ffpqxlrfbjyvxsfrnyqm.supabase.co/rest/v1/")).toBe(true);
      expect(options).toMatchObject({
        cache: "no-store",
        redirect: "error",
        headers: { Authorization: "Bearer human-token", apikey: "sb_publishable_fixture" },
      });
    }
  });

  it.each([
    "operator",
    "viewer",
  ])("does not give the %s role workspace email administration", async (role) => {
    expect(
      await readManceboEditableWorkspaces(
        "human-token",
        principal,
        fixture([workspace], [{ ...membership, role }])
      )
    ).toEqual([]);
  });

  it("rechecks removed, disabled and another user's membership instead of retaining a prior grant", async () => {
    const memberships = [membership];
    const request = fixture([workspace], memberships);
    expect(await readManceboEditableWorkspaces("human-token", principal, request)).toHaveLength(1);
    for (const changed of [null, { ...membership, status: "disabled" }, { ...membership, user_id: other }]) {
      memberships.splice(0, memberships.length, ...(changed ? [changed] : []));
      const available = await readManceboEditableWorkspaces("human-token", principal, request);
      expect(available).toEqual([]);
      expect(() => authorizeManceboEmailScope(workspace.id, principal, available)).toThrow("permission");
    }
  });

  it("reserves the platform default for a verified platform administrator", async () => {
    const available = [{ id: workspace.id, name: workspace.name }];
    expect(() => authorizeManceboEmailScope("platform", principal, available)).toThrow("permission");
    const administrator = { ...principal, platformAdministrator: true };
    expect(authorizeManceboEmailScope("platform", administrator, [])).toEqual({
      scopeKey: "platform",
      workspace: null,
    });
    expect(await readManceboEditableWorkspaces("admin-token", administrator, fixture())).toEqual(available);
  });

  it("refuses an unknown or suspended workspace even when its identifier is supplied", async () => {
    const administrator = { ...principal, platformAdministrator: true };
    const available = await readManceboEditableWorkspaces(
      "admin-token",
      administrator,
      fixture([{ ...workspace, status: "suspended" }])
    );
    expect(available).toEqual([]);
    expect(() => authorizeManceboEmailScope(other, administrator, available)).toThrow("permission");
    expect(() => authorizeManceboEmailScope("not-a-workspace", administrator, available)).toThrow(
      "permission"
    );
  });

  it("reads later pages without losing workspaces at the API page boundary", async () => {
    const tenants = Array.from({ length: 251 }, (_, i) => ({
      ...workspace,
      id: `1509ae0b-f8e4-44f0-abb4-${String(i).padStart(12, "0")}`,
      name: `Workspace ${i}`,
    }));
    const request = fixture(tenants);
    const available = await readManceboEditableWorkspaces(
      "admin-token",
      { ...principal, platformAdministrator: true },
      request
    );
    expect(available).toHaveLength(251);
    expect(available[250].id).toBe(tenants[250].id);
    expect(request.mock.calls.map(([input]) => new URL(String(input)).searchParams.get("offset"))).toEqual([
      "0",
      "250",
    ]);
  });

  it("fails closed without exposing an upstream response or credential", async () => {
    const request = vi.fn<typeof fetch>(async () => new Response("private-provider-body", { status: 503 }));
    const result = readManceboEditableWorkspaces("private-token", principal, request);
    await expect(result).rejects.toMatchObject({
      code: "internal_server_error",
      data: { upstream_status: 503, retry_safe: true },
    });
    await expect(result).rejects.toThrow("temporarily unavailable");
    await expect(result).rejects.not.toThrow("private");
  });

  it("does not bypass a refused membership read with operator credentials", async () => {
    const request = vi.fn<typeof fetch>(async (input) =>
      String(input).includes("tenant_membership")
        ? new Response("private-policy-detail", { status: 403 })
        : new Response(JSON.stringify([workspace]))
    );
    await expect(readManceboEditableWorkspaces("human-token", principal, request)).rejects.toMatchObject({
      code: "forbidden_error",
      data: { upstream_status: 403, retry_safe: false },
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(
      request.mock.calls.every(
        ([, options]) => new Headers(options?.headers).get("Authorization") === "Bearer human-token"
      )
    ).toBe(true);
  });
});
