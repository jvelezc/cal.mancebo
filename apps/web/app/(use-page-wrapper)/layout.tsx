import process from "node:process";
import PageWrapper from "../../components/PageWrapperAppDir";
import { cookies, headers } from "next/headers";
import Script from "next/script";
import { getToken } from "next-auth/jwt";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { ManceboSessionBridge } from "../../modules/auth/ManceboSessionBridge";

export default async function PageWrapperLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const nonce = h.get("x-csp-nonce") ?? undefined;
  const headScript = process.env.NEXT_PUBLIC_HEAD_SCRIPTS;
  const bodyScript = process.env.NEXT_PUBLIC_BODY_SCRIPTS;
  const manceboMode = process.env.NEXT_PUBLIC_MANCEBO_AUTH_ENABLED === "true";
  const token = manceboMode
    ? await getToken({ req: buildLegacyRequest(h, await cookies()), secret: process.env.NEXTAUTH_SECRET })
    : null;
  const renderedSubject = typeof token?.manceboSubject === "string" ? token.manceboSubject : null;

  const scripts = [
    {
      id: "injected-head-script",
      script: headScript ?? "",
    },
    {
      id: "injected-body-script",
      script: bodyScript ?? "",
    },
  ].filter((script): script is { id: string; script: string } => !!script.script);

  return (
    <>
      <PageWrapper requiresLicense={false} nonce={nonce}>
        {manceboMode ? (
          <ManceboSessionBridge renderedSubject={renderedSubject}>{children}</ManceboSessionBridge>
        ) : (
          children
        )}
        {scripts.map((script) => (
          // biome-ignore lint/security/noDangerouslySetInnerHtml: Injected scripts from env vars
          <Script
            key={script.id}
            nonce={nonce}
            id={script.id}
            dangerouslySetInnerHTML={{
              __html: script.script,
            }}
          />
        ))}
      </PageWrapper>
    </>
  );
}
