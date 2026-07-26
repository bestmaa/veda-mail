import Image from "next/image";
import {
  QrCode,
  ShieldCheck,
  ShieldOff,
  Smartphone,
} from "lucide-react";

import type { AccountSettingsViewModel } from "@/presentation/features/mail-workspace/account-settings.view-model";

type TwoFactorViewModel = AccountSettingsViewModel["twoFactor"];

const inputClass =
  "mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100";

const status = (settings: TwoFactorViewModel) =>
  settings.error ? (
    <p className="text-sm font-medium text-rose-600" role="alert">
      {settings.error}
    </p>
  ) : settings.success ? (
    <p className="text-sm font-medium text-emerald-600" role="status">
      {settings.success}
    </p>
  ) : null;

const ProofFields = ({ settings }: { settings: TwoFactorViewModel }) => (
  <div className="grid gap-3 sm:grid-cols-2">
    <label className="block text-xs font-bold text-slate-600">
      Current mailbox password
      <input
        autoComplete="current-password"
        className={inputClass}
        onChange={settings.currentPasswordInput}
        required
        type="password"
        value={settings.currentPassword}
      />
    </label>
    <label className="block text-xs font-bold text-slate-600">
      Current 6-digit code
      <input
        autoComplete="one-time-code"
        className={`${inputClass} text-center font-mono text-lg font-bold tracking-[0.25em]`}
        inputMode="numeric"
        maxLength={6}
        onChange={settings.otpCodeInput}
        pattern="[0-9]{6}"
        placeholder="000000"
        required
        value={settings.otpCode}
      />
    </label>
  </div>
);

const EnrollmentView = ({ settings }: { settings: TwoFactorViewModel }) => {
  const enrollment = settings.enrollment;
  if (!enrollment) {
    return null;
  }
  return (
    <form className="space-y-4" onSubmit={settings.onEnable}>
      <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
        <p className="text-sm font-bold text-slate-900">
          1. Scan this QR code
        </p>
        <p className="mt-1 text-xs leading-5 text-slate-600">
          Open Google Authenticator, Microsoft Authenticator, Authy or another
          TOTP app and add a new account.
        </p>
        <div className="mt-4 grid place-items-center">
          <Image
            alt="Authenticator setup QR code"
            className="rounded-xl border border-slate-200 bg-white p-2"
            height={240}
            src={enrollment.qrDataUrl}
            unoptimized
            width={240}
          />
        </div>
        <p className="mt-4 text-xs font-bold text-slate-600">
          Manual setup key
        </p>
        <code className="mt-1 block select-all break-all rounded-xl bg-white px-3 py-2 text-center text-sm font-bold tracking-wider text-slate-700">
          {enrollment.secret}
        </code>
      </div>
      <p className="text-sm font-bold text-slate-900">
        2. Confirm the setup
      </p>
      <ProofFields settings={settings} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        {status(settings)}
        <div className="ml-auto flex gap-2">
          <button
            className="h-10 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-600 hover:bg-slate-50"
            onClick={settings.cancelEnrollment}
            type="button"
          >
            Cancel
          </button>
          <button
            className="h-10 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
            disabled={settings.isSaving}
            type="submit"
          >
            {settings.isSaving ? "Enabling..." : "Enable verification"}
          </button>
        </div>
      </div>
    </form>
  );
};

const EnabledView = ({ settings }: { settings: TwoFactorViewModel }) => (
  <form className="space-y-4" onSubmit={settings.onDisable}>
    <div className="flex items-start gap-3 rounded-xl border border-emerald-100 bg-emerald-50 p-3">
      <ShieldCheck
        aria-hidden
        className="mt-0.5 shrink-0 text-emerald-600"
        size={18}
      />
      <div>
        <p className="text-sm font-bold text-emerald-800">
          Authenticator verification is enabled
        </p>
        <p className="mt-1 text-xs leading-5 text-emerald-700">
          Every new Veda Mail sign-in requires your password and current
          authenticator code.
        </p>
      </div>
    </div>
    <details className="rounded-xl border border-slate-200 p-3">
      <summary className="cursor-pointer text-xs font-bold text-slate-600">
        Disable authenticator verification
      </summary>
      <div className="mt-3 space-y-3">
        <ProofFields settings={settings} />
        <button
          className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50"
          disabled={settings.isSaving}
          type="submit"
        >
          <ShieldOff aria-hidden size={16} />
          {settings.isSaving ? "Disabling..." : "Disable verification"}
        </button>
      </div>
    </details>
    {status(settings)}
  </form>
);

export const TwoFactorSettingsView = ({
  settings,
}: {
  readonly settings: TwoFactorViewModel;
}) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="mb-4 flex items-center gap-3">
      <Smartphone aria-hidden className="text-indigo-600" size={20} />
      <div>
        <h3 className="font-bold text-slate-900">
          Authenticator verification
        </h3>
        <p className="text-xs text-slate-500">
          Protect sign-in with a changing 6-digit code
        </p>
      </div>
    </div>
    {!settings.canManage ? (
      <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
        This mail service does not support authenticator verification.
      </p>
    ) : settings.enrollment ? (
      <EnrollmentView settings={settings} />
    ) : settings.enabled ? (
      <EnabledView settings={settings} />
    ) : (
      <div>
        <div className="flex items-start gap-3 rounded-xl bg-slate-50 p-3">
          <QrCode
            aria-hidden
            className="mt-0.5 shrink-0 text-slate-500"
            size={18}
          />
          <p className="text-xs leading-5 text-slate-600">
            Scan a QR code once. Your phone will then generate codes even while
            it is offline.
          </p>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          {status(settings)}
          <button
            className="ml-auto h-10 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
            disabled={settings.isSaving}
            onClick={settings.startEnrollment}
            type="button"
          >
            {settings.isSaving ? "Preparing..." : "Set up authenticator"}
          </button>
        </div>
      </div>
    )}
  </section>
);
