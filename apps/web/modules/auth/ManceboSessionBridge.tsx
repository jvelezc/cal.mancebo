"use client";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import { usePathname } from "next/navigation";
import { getSession, signIn, signOut } from "next-auth/react";
import { useEffect, useState } from "react";

const manceboOrigin = "https://mancebo.ai";

/** Reuse the first-party Mancebo session; no native password or new identity provider. */
export function ManceboSessionBridge({ children }: { children: React.ReactNode }) {
  const { t } = useLocale();
  const pathname = usePathname();
  const [connected, setConnected] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (window.parent === window) {
      window.location.replace(`${manceboOrigin}/appointments`);
      return;
    }
    let active = true;
    let generation = 0;
    let acceptedToken: string | null = null;
    let signingOut = false;
    let queue = Promise.resolve();
    const send = (type: string, subject?: string) =>
      window.parent.postMessage({ type, subject }, manceboOrigin);
    const receive = (event: MessageEvent) => {
      if (event.origin !== manceboOrigin || event.source !== window.parent) return;
      if (signingOut) return;
      if (event.data?.type !== "mancebo:appointments-session") return;
      const { accessToken, subject } = event.data;
      if (
        accessToken !== null &&
        (typeof accessToken !== "string" || accessToken.length > 16384 || typeof subject !== "string")
      )
        return;
      if (acceptedToken && accessToken === acceptedToken) {
        send("mancebo:appointments-connected", subject);
        return;
      }
      const current = ++generation;
      acceptedToken = null;
      setConnected(false);
      setFailed(false);
      // Serialize renewal and account changes so an earlier response cannot
      // replace a newer login. Never render the previous account during a switch.
      queue = queue.then(async () => {
        if (!active || current !== generation) return;
        try {
          if (accessToken === null) {
            acceptedToken = null;
            await signOut({ redirect: false });
            return;
          }
          const result = await signIn("mancebo", { accessToken, redirect: false });
          if (!active || current !== generation) return;
          if (!result || result.error) throw new Error("MANCEBO_SIGN_IN_REQUIRED");
          const session = await getSession();
          if (!active || current !== generation) return;
          if (session?.manceboSubject !== subject) throw new Error("MANCEBO_SIGN_IN_REQUIRED");
          acceptedToken = accessToken;
          if (pathname?.startsWith("/auth/") || pathname === "/signup") {
            window.location.replace("/event-types");
            return;
          }
          setConnected(true);
          send("mancebo:appointments-connected", subject);
        } catch {
          if (!active || current !== generation) return;
          acceptedToken = null;
          setFailed(true);
          send("mancebo:appointments-error");
        }
      });
    };
    window.addEventListener("message", receive);
    const requestSignOut = () => {
      signingOut = true;
      generation++;
      acceptedToken = null;
      setConnected(false);
      queue = queue.then(async () => {
        try {
          await signOut({ redirect: false });
          send("mancebo:appointments-sign-out");
        } catch {
          if (active) setFailed(true);
        }
      });
    };
    window.addEventListener("mancebo:appointments-sign-out", requestSignOut);
    send("mancebo:appointments-ready");
    // Reconcile after page navigation and obtain fresh Mancebo tokens before expiry.
    const timer = window.setInterval(() => send("mancebo:appointments-ready"), 30000);
    return () => {
      active = false;
      generation++;
      window.clearInterval(timer);
      window.removeEventListener("message", receive);
      window.removeEventListener("mancebo:appointments-sign-out", requestSignOut);
    };
  }, [pathname]);

  if (connected && !pathname?.startsWith("/auth/") && pathname !== "/signup") return <>{children}</>;
  return (
    <main className="mx-auto max-w-lg space-y-4 px-6 py-16">
      <h1 className="text-2xl font-semibold">Mancebo.ai</h1>
      <p role="status">
        {t(failed ? "mancebo_appointments_connection_failed" : "mancebo_appointments_connecting")}
      </p>
      <a className="underline" href={`${manceboOrigin}/appointments`} target="_top">
        {t("mancebo_appointments_continue")}
      </a>
    </main>
  );
}
