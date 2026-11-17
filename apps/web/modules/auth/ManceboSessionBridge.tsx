"use client";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import { usePathname } from "next/navigation";
import { getSession, signIn, signOut } from "next-auth/react";
import { useEffect, useRef, useState } from "react";

const manceboOrigin = "https://mancebo.ai";

/** Reuse the first-party Mancebo session; no native password or new identity provider. */
export function ManceboSessionBridge({
  children,
  renderedSubject,
}: {
  children: React.ReactNode;
  renderedSubject: string | null;
}) {
  const { t } = useLocale();
  const pathname = usePathname();
  const currentPath = useRef(pathname);
  currentPath.current = pathname;
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
    let acceptedSubject: string | null = null;
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
      if (acceptedToken && accessToken === acceptedToken && subject === acceptedSubject) {
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
          if (currentPath.current?.startsWith("/auth/") || currentPath.current === "/signup") {
            window.location.replace("/event-types");
            return;
          }
          // A full document refresh discards cached server pages for another identity.
          if (renderedSubject !== subject) {
            window.location.replace("/event-types");
            return;
          }
          acceptedToken = accessToken;
          acceptedSubject = subject;
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
      if (signingOut) return;
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
    if (currentPath.current !== "/auth/logout") send("mancebo:appointments-ready");
    // Keep one verified bridge across client navigation; renew tokens before expiry.
    const timer = window.setInterval(() => {
      if (!signingOut) send("mancebo:appointments-ready");
    }, 30000);
    return () => {
      active = false;
      generation++;
      window.clearInterval(timer);
      window.removeEventListener("message", receive);
      window.removeEventListener("mancebo:appointments-sign-out", requestSignOut);
    };
  }, [renderedSubject]);

  useEffect(() => {
    if (pathname === "/auth/logout") window.dispatchEvent(new Event("mancebo:appointments-sign-out"));
    else if (connected && (pathname?.startsWith("/auth/") || pathname === "/signup"))
      window.location.replace("/event-types");
  }, [pathname, connected]);

  if (connected && !pathname?.startsWith("/auth/") && pathname !== "/signup") return <>{children}</>;
  return (
    <main
      className="mx-auto flex min-h-72 max-w-lg flex-col items-center justify-center gap-4 px-6 py-16"
      aria-busy={!failed}>
      {!failed && (
        <svg
          aria-hidden="true"
          className="h-6 w-6 animate-spin text-emphasis motion-reduce:animate-none"
          viewBox="0 0 24 24"
          fill="none">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.2" />
          <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
      <p role="status" aria-live="polite" className="text-center text-sm text-muted">
        {t(failed ? "mancebo_appointments_connection_failed" : "mancebo_appointments_connecting")}
      </p>
      {failed && (
        <a
          className="rounded-sm underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
          href={`${manceboOrigin}/appointments`}
          target="_top">
          {t("mancebo_appointments_continue")}
        </a>
      )}
    </main>
  );
}
