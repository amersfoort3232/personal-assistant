type ApprovalBarProps = {
  busy: boolean;
  selectedIds: string[];
  onApprove(blockIds: string[]): void;
};

export function ApprovalBar({ busy, onApprove, selectedIds }: ApprovalBarProps) {
  const count = selectedIds.length;
  const blockLabel = `${count} selected block${count === 1 ? '' : 's'}`;

  return (
    <div className="approval-bar">
      <span aria-live="polite">{blockLabel}</span>
      <button
        aria-label={`Approve ${blockLabel}`}
        className="button button-primary"
        disabled={busy || count === 0}
        onClick={() => onApprove(selectedIds)}
        type="button"
      >
        {busy ? 'Working…' : `Approve ${blockLabel}`}
      </button>
    </div>
  );
}
