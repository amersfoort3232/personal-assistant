import type { EventCreationResult, ScheduleBlock } from '../../shared/domain';

type ApprovalResultViewProps = {
  blocks: ScheduleBlock[];
  busy: boolean;
  results: EventCreationResult[];
  onRetryFailed(blockIds: string[]): void;
};

const STATUS_DETAILS = {
  created: { heading: 'Created events', label: 'Created' },
  'already-existed': { heading: 'Already existed', label: 'Already existed' },
  failed: { heading: 'Failed events', label: 'Failed' },
} as const;

function readableErrorCode(errorCode: string | undefined): string {
  if (!errorCode) return 'Unknown error';
  return errorCode.toLowerCase().replaceAll('_', ' ');
}

export function ApprovalResultView({
  blocks,
  busy,
  onRetryFailed,
  results,
}: ApprovalResultViewProps) {
  const titles = new Map(blocks.map((block) => [block.id, block.title]));
  const failedIds = results
    .filter((result) => result.status === 'failed')
    .map((result) => result.blockId);

  return (
    <section className="approval-results" aria-labelledby="results-title">
      <p className="eyebrow">Google Calendar</p>
      <h1 id="results-title">Calendar results</h1>
      <p className="lede">Each selected block is reported separately.</p>

      <div className="result-groups">
        {(['created', 'already-existed', 'failed'] as const).map((status) => {
          const matching = results.filter((result) => result.status === status);
          if (matching.length === 0) return null;
          const details = STATUS_DETAILS[status];
          return (
            <section aria-label={details.heading} className={`result-group result-${status}`} key={status}>
              <h2>{details.heading}</h2>
              <ul>
                {matching.map((result) => (
                  <li key={result.blockId}>
                    <strong>{titles.get(result.blockId) ?? result.blockId}</strong>
                    <span>
                      {details.label}
                      {status === 'failed' ? ` — ${readableErrorCode(result.errorCode)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {results.length === 0 && <p className="empty-state">No event results were returned.</p>}
      {failedIds.length > 0 && (
        <button
          className="button button-primary retry-events"
          disabled={busy}
          onClick={() => onRetryFailed(failedIds)}
          type="button"
        >
          Retry failed events
        </button>
      )}
    </section>
  );
}
