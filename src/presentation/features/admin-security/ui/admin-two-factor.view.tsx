import Image from "next/image";
import {
  Copy,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  Smartphone,
  Trash2,
} from "lucide-react";

import type { AdminSecurityViewProps } from "@/presentation/features/admin-security/admin-security.view-model";

export const AdminTwoFactorView = (model: AdminSecurityViewProps) => (
  <section className="mt-6 rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
    <div className="flex flex-wrap items-start gap-3">
      <span className="grid size-11 place-items-center rounded-2xl bg-indigo-50 text-indigo-700">
        <Smartphone aria-hidden size={21} />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-lg font-extrabold">Authenticator app (2FA)</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Protect the administration panel with Google Authenticator,
          Microsoft Authenticator, or another TOTP app.
        </p>
      </div>
      <span className={`rounded-full px-3 py-1 text-[11px] font-extrabold ${
        model.twoFactorEnabled
          ? "bg-emerald-50 text-emerald-700"
          : "bg-slate-100 text-slate-700"
      }`}>
        {model.twoFactorEnabled ? "Enabled" : "Disabled"}
      </span>
    </div>

    {model.recoveryCodes.length > 0 ? (
      <div className="mt-6 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5">
        <h4 className="font-extrabold text-amber-950">
          Save these backup codes now
        </h4>
        <p className="mt-1 text-xs leading-5 text-amber-800">
          Each code works once. They will not be shown again. Keep them in a
          password manager or another safe offline place.
        </p>
        <div className="mt-4 grid gap-2 rounded-xl bg-white p-4 font-mono text-sm sm:grid-cols-2">
          {model.recoveryCodes.map((code) => <span key={code}>{code}</span>)}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="flex h-10 items-center gap-2 rounded-xl bg-amber-900 px-4 text-xs font-bold text-white" onClick={model.onCopyRecoveryCodes} type="button">
            <Copy aria-hidden size={15} /> Copy codes
          </button>
          <button className="h-10 rounded-xl px-4 text-xs font-bold text-amber-900" onClick={model.onDismissRecoveryCodes} type="button">
            I have saved them
          </button>
        </div>
      </div>
    ) : model.twoFactorEnrollment ? (
      <form className="mt-6 grid gap-5 lg:grid-cols-[260px_1fr]" onSubmit={model.onTwoFactorSubmit}>
        <div className="rounded-2xl bg-slate-50 p-4 text-center">
          <Image alt="Authenticator QR code" className="mx-auto rounded-xl" height={240} src={model.twoFactorEnrollment.qrDataUrl} unoptimized width={240} />
          <p className="mt-3 text-[11px] font-bold text-slate-500">
            Cannot scan? Enter this key:
          </p>
          <code className="mt-1 block break-all text-xs font-bold text-slate-800">
            {model.twoFactorEnrollment.secret}
          </code>
        </div>
        <div>
          <h4 className="font-extrabold">Verify the new authenticator</h4>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Scan the QR code, then enter your current admin password and the
            current 6-digit code.
          </p>
          <SecretFields model={model} />
          <button className="mt-4 flex h-11 items-center gap-2 rounded-xl bg-[#2f3274] px-4 text-sm font-bold text-white disabled:opacity-60" disabled={model.isTwoFactorWorking} type="submit">
            {model.isTwoFactorWorking ? <LoaderCircle aria-hidden className="animate-spin" size={16} /> : <ShieldCheck aria-hidden size={16} />}
            Enable 2FA
          </button>
        </div>
      </form>
    ) : model.twoFactorEnabled ? (
      <div className="mt-6 rounded-2xl bg-slate-50 p-5">
        <p className="text-sm font-bold text-slate-800">
          {model.recoveryCodesRemaining} unused backup codes remain.
        </p>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          To disable 2FA, confirm with the current password and an authenticator
          or unused backup code.
        </p>
        <div className="mt-4 max-w-xl"><SecretFields model={model} /></div>
        <button className="mt-4 flex h-11 items-center gap-2 rounded-xl border border-red-200 bg-white px-4 text-sm font-bold text-red-700 disabled:opacity-60" disabled={model.isTwoFactorWorking || !model.twoFactorPassword || !model.twoFactorCode} onClick={model.onDisableTwoFactor} type="button">
          {model.isTwoFactorWorking ? <LoaderCircle aria-hidden className="animate-spin" size={16} /> : <Trash2 aria-hidden size={16} />}
          Disable 2FA
        </button>
      </div>
    ) : (
      <div className="mt-6">
        {!model.recoveryConfigured ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold leading-5 text-amber-800">
            Emergency recovery is not configured. Add
            {" VEDA_MAIL_ADMIN_RECOVERY_TOKEN "}in Dokploy before enabling 2FA.
          </p>
        ) : (
          <p className="text-xs leading-5 text-slate-500">
            Emergency terminal recovery is configured. It can reset the admin
            password and remove 2FA if both your phone and backup codes are lost.
          </p>
        )}
        <button className="mt-4 flex h-11 items-center gap-2 rounded-xl bg-[#2f3274] px-4 text-sm font-bold text-white disabled:opacity-60" disabled={model.isTwoFactorWorking || !model.recoveryConfigured} onClick={model.onStartTwoFactor} type="button">
          {model.isTwoFactorWorking ? <LoaderCircle aria-hidden className="animate-spin" size={16} /> : <Smartphone aria-hidden size={16} />}
          Set up authenticator
        </button>
      </div>
    )}
  </section>
);

const SecretFields = ({ model }: { readonly model: AdminSecurityViewProps }) => (
  <div className="mt-4 grid gap-3 sm:grid-cols-2">
    <label className="block">
      <span className="mb-2 block text-xs font-bold">Current password</span>
      <span className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3">
        <KeyRound aria-hidden className="text-slate-400" size={16} />
        <input autoComplete="current-password" className="min-w-0 flex-1 bg-transparent text-sm outline-none" onChange={model.twoFactorPasswordInput} required type="password" value={model.twoFactorPassword} />
      </span>
    </label>
    <label className="block">
      <span className="mb-2 block text-xs font-bold">Verification code</span>
      <input autoComplete="one-time-code" className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-sm uppercase outline-none" onChange={model.twoFactorCodeInput} placeholder="123456" required value={model.twoFactorCode} />
    </label>
  </div>
);
