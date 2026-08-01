import type { MemberSessionViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";

export const MemberSignOutConfirmationView = ({
  session,
}: {
  readonly session: MemberSessionViewModel;
}) => session.confirmation.isOpen ? (
  <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/55 p-5">
    <div
      aria-describedby="sign-out-confirmation-description"
      aria-labelledby="sign-out-confirmation-title"
      aria-modal="true"
      className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
      id="member-sign-out-confirmation-dialog"
      role="alertdialog"
      tabIndex={-1}
    >
      <h2 className="text-base font-bold text-slate-900" id="sign-out-confirmation-title">
        Sign out everywhere in this session?
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-600" id="sign-out-confirmation-description">
        Signing out ends this mailbox session in every open Veda Mail tab and attempts to permanently remove its browser-local draft recovery, including interrupted send or discard markers. If cleanup fails, Veda Mail keeps the mailbox hidden and asks you to retry. Check Sent and save or copy anything you need in every tab first.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button className="h-10 rounded-xl px-3 text-sm font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50" disabled={session.isSigningOut} id="member-sign-out-confirmation-cancel" onClick={session.confirmation.onCancel} type="button">
          Keep editing
        </button>
        <button className="h-10 rounded-xl bg-red-700 px-3 text-sm font-bold text-white hover:bg-red-800 disabled:opacity-50" disabled={session.isSigningOut} id="member-sign-out-confirmation-confirm" onClick={session.confirmation.onConfirm} type="button">
          {session.isSigningOut ? "Signing out…" : "Sign out everywhere"}
        </button>
      </div>
    </div>
  </div>
) : null;
