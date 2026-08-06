import {
  KeyRound,
  LoaderCircle,
  ServerCog,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";

import type { AccountSettingsViewModel } from "@/presentation/features/mail-workspace/account-settings.view-model";
import { EmailSignatureConfirmationConnector } from "@/presentation/features/mail-workspace/connectors/email-signature-confirmation.connector";
import { EmailSignatureSettingsView } from "@/presentation/features/mail-workspace/ui/email-signature-settings.view";
import { TwoFactorSettingsView } from "@/presentation/features/mail-workspace/ui/two-factor-settings.view";
import { MailRulesView } from "@/presentation/features/mail-workspace/ui/mail-rules.view";
import { NewMailNotificationSettingsView } from "@/presentation/features/mail-workspace/ui/new-mail-notification-settings.view";
import { MemberSessionsView } from "@/presentation/features/mail-workspace/ui/member-sessions.view";

const status = (error: string | null, success: string | null) =>
  error ? (
    <p className="text-sm font-medium text-rose-600" role="alert">{error}</p>
  ) : success ? (
    <p className="text-sm font-medium text-emerald-600" role="status">{success}</p>
  ) : null;

const inputClass =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100";

export const AccountSettingsView = ({
  settings,
}: {
  readonly settings: AccountSettingsViewModel;
}) =>
  settings.isOpen ? (
    <div
      aria-labelledby="account-settings-title"
      aria-modal="true"
      className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/55 p-3 backdrop-blur-sm sm:p-6"
      id="account-settings-dialog"
      role="dialog"
      tabIndex={-1}
    >
      <button
        aria-label="Close account settings"
        className="absolute inset-0 cursor-default"
        onClick={settings.close}
        type="button"
      />
      <section className="relative flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/40 bg-[#f8f9fc] shadow-2xl">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
          <span className="grid size-11 place-items-center rounded-2xl bg-indigo-100 text-indigo-700">
            <ShieldCheck aria-hidden size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-extrabold text-slate-900" id="account-settings-title">
              Account settings
            </h2>
            <p className="truncate text-xs text-slate-500">{settings.email}</p>
          </div>
          <button
            aria-label="Close account settings"
            className="grid size-10 place-items-center rounded-xl text-slate-500 hover:bg-slate-100"
            data-settings-initial-focus
            onClick={settings.close}
            type="button"
          >
            <X aria-hidden size={19} />
          </button>
        </header>

        <div className="space-y-4 overflow-y-auto p-4 sm:p-6">
          {settings.isLoading ? (
            <div className="grid min-h-64 place-items-center text-slate-500">
              <LoaderCircle aria-label="Loading settings" className="animate-spin" size={28} />
            </div>
          ) : (
            <>
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-3">
                  <ServerCog aria-hidden className="text-indigo-600" size={20} />
                  <div>
                    <h3 className="font-bold text-slate-900">
                      Provider capabilities
                    </h3>
                    <p className="text-xs text-slate-600">
                      Unsupported features stay visibly unavailable.
                    </p>
                  </div>
                </div>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {settings.providerFeatures.map((feature) => (
                    <li
                      className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2"
                      key={feature.label}
                    >
                      <span className="text-xs font-semibold text-slate-700">
                        {feature.label}
                      </span>
                      <span
                        className={
                          feature.supported
                            ? "text-xs font-bold text-emerald-700"
                            : "text-xs font-bold text-slate-600"
                        }
                      >
                        {feature.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              <form className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" onSubmit={settings.profile.onSubmit}>
                <div className="mb-4 flex items-center gap-3">
                  <UserRound aria-hidden className="text-indigo-600" size={20} />
                  <div>
                    <h3 className="font-bold text-slate-900">Profile</h3>
                    <p className="text-xs text-slate-500">Name shown on outgoing messages</p>
                  </div>
                </div>
                <label className="block text-xs font-bold text-slate-600">
                  Display name
                  <input
                    autoComplete="name"
                    className={`${inputClass} mt-1.5`}
                    disabled={!settings.canEditProfile}
                    maxLength={80}
                    minLength={2}
                    onChange={settings.profile.displayNameInput}
                    required
                    value={settings.displayName}
                  />
                </label>
                <label className="mt-3 block text-xs font-bold text-slate-600">
                  Email address
                  <input className={`${inputClass} mt-1.5 bg-slate-50 text-slate-500`} disabled value={settings.email} />
                </label>
                <p className="mt-2 text-[11px] text-slate-600">Email address can only be changed by the mail administrator.</p>
                {settings.profilePolicyRestricted ? (
                  <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                    Your organization has disabled member profile changes.
                  </p>
                ) : null}
                <div className="mt-4 flex items-center justify-between gap-3">
                  {status(settings.profile.error, settings.profile.success)}
                  <button
                    className="ml-auto h-10 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!settings.canEditProfile || settings.profile.isSaving}
                    type="submit"
                  >
                    {settings.profile.isSaving ? "Saving..." : "Save profile"}
                  </button>
                </div>
                {settings.passwordPolicyRestricted ? (
                  <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                    Your organization has disabled member password changes.
                  </p>
                ) : null}
              </form>

              <EmailSignatureSettingsView settings={settings.signatures} />

              <NewMailNotificationSettingsView notifications={settings.notifications} />

              <MailRulesView rules={settings.rules} />

              <TwoFactorSettingsView settings={settings.twoFactor} />

              <MemberSessionsView sessions={settings.sessions} />

              <form className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" onSubmit={settings.password.onSubmit}>
                <div className="mb-4 flex items-center gap-3">
                  <KeyRound aria-hidden className="text-indigo-600" size={20} />
                  <div>
                    <h3 className="font-bold text-slate-900">Change password</h3>
                    <p className="text-xs text-slate-500">Updates webmail, IMAP and SMTP sign-in</p>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-xs font-bold text-slate-600 sm:col-span-2">
                    Current password
                    <input autoComplete="current-password" className={`${inputClass} mt-1.5`} disabled={!settings.canChangePassword} onChange={settings.password.currentInput} required type="password" value={settings.password.current} />
                  </label>
                  <label className="block text-xs font-bold text-slate-600">
                    New password
                    <input autoComplete="new-password" className={`${inputClass} mt-1.5`} disabled={!settings.canChangePassword} minLength={8} onChange={settings.password.newValueInput} required type="password" value={settings.password.newValue} />
                  </label>
                  <label className="block text-xs font-bold text-slate-600">
                    Confirm new password
                    <input autoComplete="new-password" className={`${inputClass} mt-1.5`} disabled={!settings.canChangePassword} minLength={8} onChange={settings.password.confirmInput} required type="password" value={settings.password.confirm} />
                  </label>
                  <label className="block text-xs font-bold text-slate-600 sm:col-span-2">
                    Verification code <span className="font-normal text-slate-600">(only if 2FA is enabled)</span>
                    <input autoComplete="one-time-code" className={`${inputClass} mt-1.5`} disabled={!settings.canChangePassword} inputMode="numeric" onChange={settings.password.otpCodeInput} pattern="[0-9]{6,8}" placeholder="6-digit code" value={settings.password.otpCode} />
                  </label>
                </div>
                <div className="mt-4 flex items-center justify-between gap-3">
                  {status(settings.password.error, settings.password.success)}
                  <button
                    className="ml-auto h-10 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!settings.canChangePassword || settings.password.isSaving}
                    type="submit"
                  >
                    {settings.password.isSaving ? "Changing..." : "Change password"}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </section>
      <EmailSignatureConfirmationConnector
        confirmation={settings.closeConfirmation}
        confirmLabel="Discard and close"
        idPrefix="account-settings-close-confirmation"
      />
    </div>
  ) : null;
