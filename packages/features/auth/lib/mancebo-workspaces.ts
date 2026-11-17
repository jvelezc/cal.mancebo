import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { z } from "zod";
import { identityUrl, publishableKey } from "./mancebo-principal";
import type { readManceboPrincipal } from "./mancebo-principal";

type Principal = Awaited<ReturnType<typeof readManceboPrincipal>>;
const workspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  status: z.string(),
});
const membershipSchema = z.object({
  tenant_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: z.string(),
  status: z.string(),
});
export type ManceboEditableWorkspace = Pick<z.infer<typeof workspaceSchema>, "id" | "name">;

export async function readManceboEditableWorkspaces(
  accessToken: string,
  principal: Principal,
  request: typeof fetch = fetch
) {
  const signal = AbortSignal.timeout(10000);
  const rows = async (query: string) => {
    const result: unknown[] = [];
    for (let offset = 0; ; offset += 250) {
      const response = await request(`${identityUrl}/rest/v1/${query}&limit=250&offset=${offset}`, {
        headers: { apikey: publishableKey, Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        redirect: "error",
        signal,
      });
      if (!response.ok)
        throw new ErrorWithCode(
          response.status >= 500 ? ErrorCode.InternalServerError : ErrorCode.Forbidden,
          response.status >= 500
            ? "Workspace access is temporarily unavailable. Try again."
            : "Workspace access could not be confirmed.",
          { upstream_status: response.status, retry_safe: response.status >= 500 }
        );
      const page = z
        .array(z.unknown())
        .max(250)
        .parse(await response.json());
      result.push(...page);
      if (page.length < 250) return result;
    }
  };
  // The human JWT and existing RLS apply to every page; never fall back to an
  // operator credential when a membership has been removed or disabled.
  const [workspaces, memberships] = await Promise.all([
    rows("tenant?select=id,name,status&status=eq.active&order=name,id"),
    principal.platformAdministrator
      ? Promise.resolve([])
      : rows(
          `tenant_membership?select=tenant_id,user_id,role,status&user_id=eq.${principal.subject}&status=eq.active&order=tenant_id`
        ),
  ]);
  const administered = new Set(
    z
      .array(membershipSchema)
      .parse(memberships)
      .filter(
        (row) => row.user_id === principal.subject && row.status === "active" && row.role === "tenant_admin"
      )
      .map((row) => row.tenant_id)
  );
  return z
    .array(workspaceSchema)
    .parse(workspaces)
    .filter((row) => row.status === "active" && (principal.platformAdministrator || administered.has(row.id)))
    .map(({ id, name }) => ({ id, name }));
}

export function authorizeManceboEmailScope(
  scope: string,
  principal: Principal,
  workspaces: ManceboEditableWorkspace[]
) {
  if (scope === "platform" && principal.platformAdministrator) return { scopeKey: scope, workspace: null };
  const workspace = workspaces.find((row) => row.id === scope);
  if (scope !== "platform" && z.string().uuid().safeParse(scope).success && workspace)
    return { scopeKey: scope, workspace };
  throw new ErrorWithCode(
    ErrorCode.Forbidden,
    "You do not have permission to change these appointment emails."
  );
}
