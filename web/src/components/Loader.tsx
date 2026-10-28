export function Loader({ label = "読みこみ中" }: { label?: string }) {
  return (
    <span className="loader" role="status" aria-label={label}>
      <i />
      <i />
      <i />
    </span>
  );
}
