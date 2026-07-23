import {
  ArrowRight,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";

import type { AdminLoginViewProps } from "@/presentation/features/admin-login/admin-login.view-model";
import { BrandMarkView } from "@/presentation/shared/branding/ui/brand-mark.view";

export const AdminLoginView = ({
  branding,
  error,
  isSubmitting,
  onPasswordInput,
  onSubmit,
  onUsernameInput,
  password,
  submitLabel,
  username,
}: AdminLoginViewProps) => (
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
            administration
          </p>
        </div>
      </div>

      <span className="mt-9 grid size-12 place-items-center rounded-2xl bg-indigo-50 text-[#4f46a5]">
        <LockKeyhole aria-hidden size={22} />
      </span>
      <h1 className="mt-5 text-3xl font-extrabold tracking-[-0.05em]">
        Administrator access
      </h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        Sign in to configure the organization mail service and allowed domains.
      </p>

      <form aria-busy={isSubmitting} className="mt-7 space-y-4" onSubmit={onSubmit}>
        <label className="block">
          <span className="mb-2 block text-xs font-bold text-slate-700">
            Administrator username
          </span>
          <input
            autoComplete="username"
            autoFocus
            className="h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
            onChange={onUsernameInput}
            placeholder="owner"
            required
            value={username}
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-xs font-bold text-slate-700">
            Administrator password
          </span>
          <span className="flex h-12 items-center gap-3 rounded-2xl border border-slate-200 px-4 focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-100">
            <KeyRound aria-hidden className="text-slate-400" size={18} />
            <input
              autoComplete="current-password"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              onChange={onPasswordInput}
              placeholder="Enter administrator password"
              required
              type="password"
              value={password}
            />
          </span>
        </label>
        {error ? (
          <p
            className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-700"
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
      </form>

      <p className="mt-6 flex items-center justify-center gap-2 text-[11px] font-semibold text-slate-400">
        <ShieldCheck aria-hidden size={14} />
        Protected by an encrypted, HttpOnly administrator session
      </p>
    </section>
  </main>
);
