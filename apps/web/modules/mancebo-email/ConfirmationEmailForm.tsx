"use client";

import { useState } from "react";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import {
  confirmationTemplateSchema,
  confirmationPlaceholders,
  renderConfirmationContent,
} from "@calcom/emails/lib/manceboConfirmationContent";
import type {
  ConfirmationContext,
  ConfirmationTemplate,
} from "@calcom/emails/lib/manceboConfirmationContent";
import type { ManceboEmailSettings } from "@calcom/emails/lib/manceboEmailPolicy";

const fields = ["subject", "greeting", "introduction", "closing"] as const;
const inputClass = "border-default bg-default text-emphasis w-full rounded-md border p-3 disabled:opacity-60";
const previewContext: ConfirmationContext = {
  values: {
    recipient_name: "Alex",
    appointment_title: "Project planning call",
    appointment_date: "November 24, 2026",
    appointment_time: "10:00–10:30",
    appointment_timezone: "America/New_York",
    host_name: "Jordan",
    attendee_name: "Alex",
    workspace_name: "Mancebo.ai",
  },
  calendarAttachmentAvailable: true,
  location: "Video call",
  joinUrl: "https://example.com/meeting",
  rescheduleUrl: "https://appointments.mancebo.ai/reschedule/sample",
  cancelUrl: "https://appointments.mancebo.ai/booking/sample?cancel=true",
};
export type EmailFormChange = { enabled: boolean; template: ConfirmationTemplate; eventTypeIds: number[] };
export function ConfirmationEmailForm({
  settings,
  saving,
  onSave,
  onDirty,
}: {
  settings: ManceboEmailSettings;
  saving: boolean;
  onSave: (value: EmailFormChange) => void;
  onDirty: (value: boolean) => void;
}) {
  const { t } = useLocale();
  const [enabled, setEnabled] = useState(settings.saved?.enabled ?? false);
  const initial = settings.saved ?? settings.effectiveTemplate;
  const [template, setTemplate] = useState<ConfirmationTemplate>({
    subject: initial.subject,
    greeting: initial.greeting,
    introduction: initial.introduction,
    closing: initial.closing,
  });
  const [selected, setSelected] = useState(
    settings.eventTypes.filter((event) => event.selected).map((event) => event.id)
  );
  const parsed = confirmationTemplateSchema.safeParse(template);
  const preview = renderConfirmationContent(
    enabled && parsed.success ? parsed.data : settings.inheritedTemplate,
    {
      ...previewContext,
      values: { ...previewContext.values, workspace_name: settings.workspaceName ?? "Mancebo.ai" },
    }
  );
  const markChanged = () => onDirty(true);
  const change = (field: keyof ConfirmationTemplate, value: string) => {
    setTemplate((previous) => ({ ...previous, [field]: value }));
    markChanged();
  };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (parsed.success || !enabled)
          onSave({
            enabled,
            template: parsed.success ? parsed.data : settings.inheritedTemplate,
            eventTypeIds: selected,
          });
      }}
      className="grid gap-8 lg:grid-cols-2">
      <div className="space-y-6">
        <div className="border-subtle rounded-lg border p-5">
          <label className="text-emphasis flex items-start gap-3 font-medium">
            <input
              type="checkbox"
              checked={enabled}
              disabled={saving}
              className="mt-1"
              onChange={(event) => {
                setEnabled(event.target.checked);
                markChanged();
              }}
            />
            {t("mancebo_email_customize")}
          </label>
          <p className="text-subtle mt-2 text-sm">
            {enabled
              ? t("mancebo_email_custom_active")
              : t(
                  settings.workspaceName
                    ? "mancebo_email_platform_inherited"
                    : "mancebo_email_builtin_inherited"
                )}
          </p>
        </div>
        {settings.invalidSavedTemplate && <p role="status">{t("mancebo_email_invalid_saved")}</p>}
        <fieldset disabled={!enabled || saving} className="space-y-5">
          <legend className="text-emphasis mb-3 text-lg font-semibold">{t("mancebo_email_wording")}</legend>
          {fields.map((field) => (
            <div key={field}>
              <label htmlFor={`email-${field}`} className="text-emphasis mb-2 block font-medium">
                {t(`mancebo_email_${field}`)}
              </label>
              {field === "subject" || field === "greeting" ? (
                <input
                  id={`email-${field}`}
                  className={inputClass}
                  value={template[field]}
                  maxLength={field === "subject" ? 180 : 300}
                  onChange={(event) => change(field, event.target.value)}
                />
              ) : (
                <textarea
                  id={`email-${field}`}
                  className={inputClass}
                  rows={4}
                  value={template[field]}
                  maxLength={5000}
                  onChange={(event) => change(field, event.target.value)}
                />
              )}
              <select
                aria-label={`${t("mancebo_email_insert")}: ${t(`mancebo_email_${field}`)}`}
                value=""
                className="text-default mt-2 max-w-full rounded border p-2 text-sm"
                onChange={(event) => change(field, `${template[field]}{{${event.target.value}}}`)}>
                <option value="" disabled>
                  {t("mancebo_email_insert")}
                </option>
                {confirmationPlaceholders.map((placeholder) => (
                  <option key={placeholder} value={placeholder}>{`{{${placeholder}}}`}</option>
                ))}
              </select>
            </div>
          ))}
          {enabled && !parsed.success && (
            <p role="alert" className="text-red-700">
              {t("mancebo_email_invalid_words")}
            </p>
          )}
        </fieldset>
        {settings.workspaceName && (
          <fieldset disabled={saving} className="border-subtle rounded-lg border p-5">
            <legend className="text-emphasis px-1 font-semibold">{t("mancebo_email_booking_links")}</legend>
            <p className="text-subtle mb-4 text-sm">{t("mancebo_email_personal_links")}</p>
            {settings.eventTypes.length === 0 && <p>{t("mancebo_email_no_links")}</p>}
            {settings.eventTypes.map((event) => (
              <label key={event.id} className="text-emphasis mb-3 flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected.includes(event.id)}
                  disabled={event.assignedElsewhere}
                  onChange={(e) => {
                    setSelected((current) =>
                      e.target.checked ? [...current, event.id] : current.filter((id) => id !== event.id)
                    );
                    markChanged();
                  }}
                />
                <span>
                  {event.title}
                  {event.assignedElsewhere && (
                    <span className="text-subtle block text-sm">{t("mancebo_email_other_workspace")}</span>
                  )}
                </span>
              </label>
            ))}
            <p className="text-subtle text-sm">{t("mancebo_email_other_hosts")}</p>
          </fieldset>
        )}
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={saving || (enabled && !parsed.success)}
            className="bg-inverted text-inverted rounded-md px-5 py-3 font-medium disabled:opacity-50">
            {t(saving ? "mancebo_email_saving" : "mancebo_email_save")}
          </button>
          <button
            type="button"
            disabled={saving || !enabled}
            onClick={() => {
              setEnabled(false);
              markChanged();
            }}
            className="border-default rounded-md border px-4 py-3 disabled:opacity-50">
            {t("mancebo_email_reset")}
          </button>
        </div>
        <p className="text-subtle text-sm">{t("mancebo_email_reset_hint")}</p>
      </div>
      <section aria-labelledby="email-preview-title" className="min-w-0">
        <h2 id="email-preview-title" className="text-emphasis text-lg font-semibold">
          {t("mancebo_email_preview")}
        </h2>
        <p className="text-subtle my-3 text-sm">{t("mancebo_email_preview_hint")}</p>
        <p className="text-emphasis mb-3 break-words font-medium">{preview.subject}</p>
        <iframe
          title={t("mancebo_email_preview")}
          srcDoc={preview.html}
          sandbox=""
          className="border-subtle h-[700px] w-full rounded-lg border bg-white"
        />
      </section>
    </form>
  );
}
