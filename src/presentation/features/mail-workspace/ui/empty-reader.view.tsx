import { Mail } from "lucide-react";

export const EmptyReaderView = ({
  isComposerReady,
  onCompose,
}: {
  readonly isComposerReady: boolean;
  readonly onCompose: () => void;
}) => (
  <section className="hidden min-h-0 place-items-center bg-white p-10 lg:grid">
    <div className="max-w-sm text-center">
      <span className="mx-auto grid size-20 place-items-center rounded-[26px] bg-gradient-to-br from-indigo-50 to-orange-50 text-[#4f46a5]">
        <Mail aria-hidden size={32} strokeWidth={1.6} />
      </span>
      <h2 className="mt-6 text-xl font-extrabold tracking-[-0.03em] text-slate-800">
        Your inbox, without the noise
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Select a message to read it here, or start a focused new conversation.
      </p>
      <button
        aria-busy={!isComposerReady}
        className="mt-5 rounded-xl bg-[#2f3274] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#25285f] disabled:cursor-wait disabled:opacity-70"
        disabled={!isComposerReady}
        onClick={onCompose}
        title={isComposerReady ? undefined : "Loading account settings"}
        type="button"
      >
        Compose message
      </button>
    </div>
  </section>
);
