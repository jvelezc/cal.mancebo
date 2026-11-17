"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import type { ManceboEmailSettings } from "@calcom/emails/lib/manceboEmailPolicy";
import Shell from "../shell/Shell";
import { ConfirmationEmailForm } from "./ConfirmationEmailForm";
import type { EmailFormChange } from "./ConfirmationEmailForm";

export type EmailSettingsMetadata = { canEditPlatform: boolean; workspaces: { id: string; name: string }[] };
class EmailSettingsRequestError extends Error {}
function requestError(
  value: { message?: string; diagnosticId?: string },
  fallback: string,
  referenceLabel: string
) {
  const reference =
    value.diagnosticId && /^[a-f0-9-]{36}$/i.test(value.diagnosticId)
      ? `${referenceLabel}: ${value.diagnosticId}`
      : "";
  return new EmailSettingsRequestError([value.message ?? fallback, reference].filter(Boolean).join(" "));
}
export default function AppointmentEmailSettings({
  metadata,
  initialScope,
  permissionsUnavailable = false,
}: {
  metadata: EmailSettingsMetadata;
  initialScope?: string;
  permissionsUnavailable?: boolean;
}) {
  const { t } = useLocale();
  const choices = [
    ...(metadata.canEditPlatform ? [{ id: "platform", name: t("mancebo_email_platform") }] : []),
    ...metadata.workspaces,
  ];
  const [scope, setScope] = useState(
    initialScope
      ? choices.some((choice) => choice.id === initialScope)
        ? initialScope
        : ""
      : choices.length === 1
        ? (choices[0]?.id ?? "")
        : ""
  );
  const [loaded, setLoaded] = useState<{ scope: string; settings: ManceboEmailSettings } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const saveRequest = useRef<AbortController | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    const current = ++generation.current;
    const controller = new AbortController();
    setLoaded(null);
    setError("");
    setNotice("");
    setDirty(false);
    setSaving(false);
    if (scope)
      fetch(`/api/mancebo/email-templates?scope=${encodeURIComponent(scope)}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          const value = (await response.json()) as {
            settings: ManceboEmailSettings;
            message?: string;
            diagnosticId?: string;
          };
          if (!response.ok)
            throw requestError(value, t("mancebo_email_load_failed"), t("mancebo_email_support_reference"));
          if (!controller.signal.aborted && current === generation.current)
            setLoaded({ scope, settings: value.settings });
        })
        .catch((failure: unknown) => {
          if (!controller.signal.aborted && current === generation.current)
            setError(
              failure instanceof EmailSettingsRequestError ? failure.message : t("mancebo_email_load_failed")
            );
        });
    return () => {
      controller.abort();
      saveRequest.current?.abort();
    };
  }, [scope, reload, t]);
  const save = async (value: EmailFormChange) => {
    if (!loaded || loaded.scope !== scope || saving) return;
    const current = generation.current;
    const controller = new AbortController();
    saveRequest.current = controller;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/mancebo/email-templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ ...value, scope, expectedRevision: loaded.settings.revision }),
      });
      const result = (await response.json()) as { revision: number; message?: string; diagnosticId?: string };
      if (!response.ok)
        throw requestError(result, t("mancebo_email_save_failed"), t("mancebo_email_support_reference"));
      if (controller.signal.aborted || current !== generation.current) return;
      const previous = !value.enabled ? loaded.settings.saved : null;
      const savedWords = previous
        ? {
            subject: previous.subject,
            greeting: previous.greeting,
            introduction: previous.introduction,
            closing: previous.closing,
          }
        : value.template;
      setLoaded({
        scope,
        settings: {
          ...loaded.settings,
          revision: result.revision,
          saved: {
            ...savedWords,
            enabled: value.enabled,
            revision: result.revision,
            updatedAt: new Date().toISOString(),
          },
        },
      });
      setDirty(false);
      setNotice(t("mancebo_email_saved"));
    } catch (failure) {
      if (!controller.signal.aborted && current === generation.current)
        setError(
          failure instanceof EmailSettingsRequestError ? failure.message : t("mancebo_email_save_failed")
        );
    } finally {
      if (!controller.signal.aborted && current === generation.current) setSaving(false);
    }
  };
  return (
    <Shell heading={t("mancebo_email_title")} subtitle={t("mancebo_email_purpose")}>
      <div className="mx-auto max-w-6xl space-y-6">
        <a
          href="https://mancebo.ai/docs?topic=appointment-emails"
          target="_blank"
          rel="noopener noreferrer"
          className="text-emphasis inline-block underline">
          {t("mancebo_email_guide")}
        </a>
        <p className="text-default">{t("mancebo_email_purpose")}</p>
        {!choices.length ? (
          permissionsUnavailable ? (
            <div>
              <p role="alert">{t("mancebo_email_permissions_unavailable")}</p>
              <button type="button" className="mt-3 underline" onClick={() => window.location.reload()}>
                {t("mancebo_email_reload")}
              </button>
            </div>
          ) : (
            <p role="status">{t("mancebo_email_no_access")}</p>
          )
        ) : (
          <>
            <div className="border-subtle bg-default rounded-lg border p-5">
              <label htmlFor="email-scope" className="text-emphasis mb-2 block font-medium">
                {t("mancebo_email_scope")}
              </label>
              <select
                id="email-scope"
                value={scope}
                className="border-default bg-default text-emphasis w-full max-w-lg rounded-md border p-3"
                onChange={(event) => {
                  if (dirty && !window.confirm(t("mancebo_email_discard"))) return;
                  ++generation.current;
                  saveRequest.current?.abort();
                  setScope(event.target.value);
                }}>
                <option value="" disabled>
                  {t("mancebo_email_choose_scope")}
                </option>
                {choices.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.name}
                  </option>
                ))}
              </select>
              <p className="text-subtle mt-2 text-sm">
                {t(
                  !scope
                    ? "mancebo_email_choose_scope"
                    : scope === "platform"
                      ? "mancebo_email_global_hint"
                      : "mancebo_email_workspace_hint"
                )}
              </p>
            </div>
            {error && (
              <div>
                <p ref={errorRef} tabIndex={-1} role="alert" className="text-red-700">
                  {error}
                </p>
                <button
                  type="button"
                  className="text-emphasis mt-3 underline"
                  onClick={() => {
                    if (dirty && !window.confirm(t("mancebo_email_discard"))) return;
                    setReload((value) => value + 1);
                  }}>
                  {t("mancebo_email_reload")}
                </button>
              </div>
            )}
            <p role="status" aria-live="polite">
              {notice || (dirty ? t("mancebo_email_unsaved") : "")}
            </p>
            {loaded?.scope === scope ? (
              <ConfirmationEmailForm
                key={`${scope}-${reload}-${loaded.settings.revision}`}
                settings={loaded.settings}
                saving={saving}
                onSave={save}
                onDirty={setDirty}
              />
            ) : (
              !error && (
                <p role="status">{t(scope ? "mancebo_email_loading" : "mancebo_email_choose_scope")}</p>
              )
            )}
          </>
        )}
      </div>
    </Shell>
  );
}
