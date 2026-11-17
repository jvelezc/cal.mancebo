"use client";

import Link from "next/link";
import { useLocale } from "@calcom/lib/hooks/useLocale";

export function ManceboConnectionScope({ messaging = false }: { messaging?: boolean }) {
  const { t } = useLocale();
  return (
    <div className="border-subtle mb-6 space-y-4 rounded-lg border p-5">
      <div>
        <h2 className="text-emphasis font-semibold">{t("mancebo_connections_personal")}</h2>
        <p className="text-default mt-2 text-sm">{t("mancebo_connections_scope")}</p>
      </div>
      {messaging && (
        <section className="border-subtle border-t pt-4">
          <h3 className="text-emphasis font-semibold">{t("mancebo_email_confirmations")}</h3>
          <p className="text-default my-2 text-sm">{t("mancebo_email_first_party")}</p>
          <Link
            href="/email-templates"
            className="text-emphasis inline-flex rounded border px-4 py-2 font-medium underline-offset-4 hover:underline">
            {t("mancebo_email_edit")}
          </Link>
        </section>
      )}
    </div>
  );
}
