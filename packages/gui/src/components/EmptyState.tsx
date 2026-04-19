export function EmptyState({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}): JSX.Element {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center text-neutral-500 gap-2">
      <div className="text-sm">{title}</div>
      {hint && <div className="text-xs text-neutral-600">{hint}</div>}
    </div>
  );
}
