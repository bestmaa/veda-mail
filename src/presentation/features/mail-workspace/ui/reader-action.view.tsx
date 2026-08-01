export const ReaderActionView = ({
  children,
  disabled = false,
  label,
  onClick,
}: {
  readonly children: React.ReactNode;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onClick: React.MouseEventHandler<HTMLButtonElement>;
}) => (
  <button
    aria-label={label}
    className="grid size-9 place-items-center rounded-xl text-slate-500 transition enabled:hover:bg-slate-100 enabled:hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
    disabled={disabled}
    onClick={onClick}
    title={label}
    type="button"
  >
    {children}
  </button>
);
