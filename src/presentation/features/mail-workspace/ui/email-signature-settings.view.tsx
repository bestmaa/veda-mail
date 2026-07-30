import { FileSignature, RefreshCw } from "lucide-react";

import type { EmailSignatureSettingsViewModel } from "@/presentation/features/mail-workspace/email-signature-settings.view-model";
import { EmailSignatureConfirmationConnector } from "@/presentation/features/mail-workspace/connectors/email-signature-confirmation.connector";
import { EmailSignatureDefaultsView } from "@/presentation/features/mail-workspace/ui/email-signature-defaults.view";
import { EmailSignatureEditorView } from "@/presentation/features/mail-workspace/ui/email-signature-editor.view";
import { EmailSignatureSettingsListView } from "@/presentation/features/mail-workspace/ui/email-signature-settings-list.view";

export const EmailSignatureSettingsView = ({
  settings,
}: {
  readonly settings: EmailSignatureSettingsViewModel;
}) => (
  <section
    aria-labelledby="email-signature-settings-title"
    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
  >
    <div className="mb-4 flex items-center gap-3">
      <FileSignature aria-hidden className="text-indigo-600" size={20} />
      <div className="min-w-0">
        <h3
          className="font-bold text-slate-900"
          id="email-signature-settings-title"
        >
          Email signatures
        </h3>
        <p className="truncate text-xs text-slate-600">
          Signatures for {settings.accountEmail}
        </p>
      </div>
    </div>

    {settings.error ? (
      <div
        className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800"
        role="alert"
      >
        <span className="min-w-0 flex-1">{settings.error}</span>
        <button
          className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-bold hover:bg-rose-100"
          onClick={settings.retry}
          type="button"
        >
          <RefreshCw aria-hidden size={14} />
          Retry
        </button>
      </div>
    ) : null}

    <div className="grid min-w-0 gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <EmailSignatureSettingsListView settings={settings} />
      {settings.editor ? (
        <EmailSignatureEditorView
          editor={settings.editor}
          isSaving={settings.isSaving}
        />
      ) : (
        <div className="grid min-h-56 place-items-center rounded-xl border border-dashed border-slate-300 px-5 text-center">
          <div>
            <p className="text-sm font-bold text-slate-700">
              Select or create a signature
            </p>
            <p className="mt-1 text-xs text-slate-600">
              Saved content remains disabled until you choose it as a default.
            </p>
          </div>
        </div>
      )}
    </div>

    <div className="mt-4">
      <EmailSignatureDefaultsView
        defaults={settings.defaults}
        isSaving={settings.isSaving}
        signatures={settings.items}
      />
    </div>

    <span aria-live="polite" className="sr-only" role="status">
      {settings.status ?? (settings.isSaving ? "Saving signature settings" : "")}
    </span>
    <EmailSignatureConfirmationConnector
      confirmation={settings.deleteConfirmation}
      confirmLabel="Delete signature"
      idPrefix="email-signature-delete-confirmation"
    />
    <EmailSignatureConfirmationConnector
      confirmation={settings.modeConfirmation}
      confirmLabel="Switch to plain text"
      idPrefix="email-signature-mode-confirmation"
    />
  </section>
);
