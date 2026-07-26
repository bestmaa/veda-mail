import {
  ArrowLeft,
  ArrowRight,
  AtSign,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";

import type { MemberLoginViewProps } from "@/presentation/features/member-login/member-login.view-model";
import { BrandMarkView } from "@/presentation/shared/branding/ui/brand-mark.view";

export const MemberLoginView = ({
  adminHref,
  branding,
  email,
  error,
  isSubmitting,
  isTwoFactorStep,
  onBackToPassword,
  onEmailInput,
  onOtpCodeInput,
  onPasswordInput,
  onSubmit,
  otpCode,
  password,
  providerLabel,
  submitLabel,
}: MemberLoginViewProps) => (
  <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-[#f4f5fb] p-4 text-slate-900" style={branding.brandStyle}>
    <div
      aria-hidden
      className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(99,102,241,0.13),transparent_32%),radial-gradient(circle_at_90%_85%,rgba(255,120,90,0.16),transparent_30%)]"
    />
    <section className="relative w-full max-w-md rounded-[30px] border border-white/80 bg-white/95 p-7 shadow-2xl shadow-indigo-950/10 sm:p-9">
      <div className="flex items-center gap-3">
        <BrandMarkView branding={branding} />
        <div>
          <p className="text-xl font-extrabold tracking-[-0.04em] text-[#1e214d]">
            {branding.productName}
          </p>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
            member mailbox
          </p>
        </div>
      </div>

      <h1 className="mt-9 text-3xl font-extrabold tracking-[-0.05em]">
        {isTwoFactorStep ? "Verify it’s you" : "Sign in to your mail"}
      </h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        {isTwoFactorStep
          ? `Enter the authenticator code or an unused backup code for ${email}.`
          : "Use the complete email address and password issued by your organization."}
      </p>
      <p className="mt-3 rounded-xl bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700">
        Service: {providerLabel}
      </p>

      <form aria-busy={isSubmitting} className="mt-7 space-y-4" onSubmit={onSubmit}>
        {!isTwoFactorStep ? <label className="block">
          <span className="mb-2 block text-xs font-bold text-slate-700">
            Email address
          </span>
          <span className="flex h-12 items-center gap-3 rounded-2xl border border-slate-200 px-4 focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-100">
            <AtSign aria-hidden className="text-slate-400" size={18} />
            <input
              autoComplete="username"
              autoFocus
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              inputMode="email"
              onChange={onEmailInput}
              placeholder="name@example.com"
              required
              type="email"
              value={email}
            />
          </span>
        </label> : null}
        {!isTwoFactorStep ? <label className="block">
          <span className="mb-2 block text-xs font-bold text-slate-700">
            Password
          </span>
          <span className="flex h-12 items-center gap-3 rounded-2xl border border-slate-200 px-4 focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-100">
            <KeyRound aria-hidden className="text-slate-400" size={18} />
            <input
              autoComplete="current-password"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              onChange={onPasswordInput}
              placeholder="Enter mailbox password"
              required
              type="password"
              value={password}
            />
          </span>
        </label> : (
          <label className="block">
            <span className="mb-2 block text-xs font-bold text-slate-700">
              Authenticator or backup code
            </span>
            <span className="flex h-14 items-center gap-3 rounded-2xl border border-slate-200 px-4 focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-100">
              <ShieldCheck aria-hidden className="text-indigo-500" size={19} />
              <input
                autoComplete="one-time-code"
                autoFocus
                className="min-w-0 flex-1 bg-transparent text-center font-mono text-xl font-bold tracking-[0.35em] outline-none"
                inputMode="text"
                maxLength={64}
                onChange={onOtpCodeInput}
                placeholder="000000 or backup code"
                required
                value={otpCode}
              />
            </span>
          </label>
        )}
        {error ? (
          <p
            className="rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-700"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <button
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--brand-primary)] text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? (
            <LoaderCircle aria-hidden className="animate-spin" size={18} />
          ) : (
            <ArrowRight aria-hidden size={18} />
          )}
          <span aria-live="polite">{submitLabel}</span>
        </button>
        {isTwoFactorStep ? (
          <button
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-50"
            disabled={isSubmitting}
            onClick={onBackToPassword}
            type="button"
          >
            <ArrowLeft aria-hidden size={15} />
            Use a different password
          </button>
        ) : null}
      </form>

      <p className="mt-6 flex items-center justify-center gap-2 text-[11px] font-semibold text-slate-400">
        <ShieldCheck aria-hidden size={14} />
        Credentials are exchanged securely and are never stored in this browser
      </p>
      <p className="mt-3 text-center text-[11px] text-slate-400">
        Organization administrator?{" "}
        <a
          className="font-bold text-indigo-600 hover:text-indigo-800 hover:underline"
          href={adminHref}
        >
          Configure mail service
        </a>
      </p>
      {branding.publicRepositoryUrl ? (
        <p className="mt-3 text-center text-[10px] text-slate-400">
          <a className="font-semibold hover:underline" href={branding.publicRepositoryUrl} rel="noreferrer" target="_blank">
            Open-source code
          </a>
        </p>
      ) : null}
    </section>
  </main>
);
