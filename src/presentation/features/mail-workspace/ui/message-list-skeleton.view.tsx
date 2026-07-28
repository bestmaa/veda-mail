export const MessageListSkeletonView = () => (
  <div
    aria-label="Loading messages"
    className="space-y-2 px-3 py-3"
    role="status"
  >
    {[1, 2, 3, 4, 5, 6].map((item) => (
      <div
        className="h-[104px] animate-pulse rounded-2xl border border-slate-100 bg-white p-4"
        key={item}
      >
        <div className="mb-3 h-3 w-2/5 rounded bg-slate-100" />
        <div className="mb-2 h-3 w-4/5 rounded bg-slate-100" />
        <div className="h-3 w-3/5 rounded bg-slate-100" />
      </div>
    ))}
  </div>
);
