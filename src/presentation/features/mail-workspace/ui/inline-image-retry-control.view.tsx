import { LoaderCircle, RotateCcw } from "lucide-react";

export const InlineImageRetryControlView = ({
  failedCount,
  isRetrying,
  onRetry,
}: {
  readonly failedCount: number;
  readonly isRetrying: boolean;
  readonly onRetry: () => void;
}) =>
  failedCount > 0 ? (
    <div
      className="mt-3 flex min-h-11 flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
    >
      <span className="min-w-0 flex-1" role="status">
        {failedCount === 1
          ? "An embedded image could not be loaded."
          : `${failedCount} embedded images could not be loaded.`}
      </span>
      <button
        aria-label={
          isRetrying
            ? "Retrying embedded images"
            : "Retry embedded images"
        }
        className="flex h-11 items-center gap-2 rounded-xl border border-amber-300 bg-white px-3 font-bold text-amber-950 transition hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-wait disabled:opacity-60"
        disabled={isRetrying}
        onClick={onRetry}
        type="button"
      >
        {isRetrying ? (
          <LoaderCircle aria-hidden className="animate-spin" size={16} />
        ) : (
          <RotateCcw aria-hidden size={16} />
        )}
        {isRetrying ? "Retrying…" : "Retry embedded images"}
      </button>
    </div>
  ) : null;
