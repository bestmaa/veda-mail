export const ReaderActionView = ({
  children,
  label,
  onClick,
}: {
  readonly children: React.ReactNode;
  readonly label: string;
  readonly onClick: () => void;
}) => (
  <button
    aria-label={label}
    className="grid size-9 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
    onClick={onClick}
    title={label}
    type="button"
  >
    {children}
  </button>
);
