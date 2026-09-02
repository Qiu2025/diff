import './DiffStats.css';

interface DiffStatsProps {
  additions: number;
  deletions: number;
  unchanged: number;
  totalChanges: number;
  changePercentage: number;
}

export function DiffStats({ additions, deletions, unchanged, changePercentage }: DiffStatsProps) {
  const total = additions + deletions + unchanged;
  const additionPercent = total > 0 ? (additions / total) * 100 : 0;
  const deletionPercent = total > 0 ? (deletions / total) * 100 : 0;

  return (
    <section className="diff-stats" aria-label="Comparison summary">
      <div className="change-rate">
        <span>Changed</span>
        <strong>{changePercentage.toFixed(1)}%</strong>
      </div>
      <dl className="stat-list">
        <div className="stat-item additions">
          <dt>Added</dt>
          <dd>+{additions}</dd>
        </div>
        <div className="stat-item removals">
          <dt>Removed</dt>
          <dd>−{deletions}</dd>
        </div>
        <div className="stat-item unchanged">
          <dt>Unchanged</dt>
          <dd>{unchanged}</dd>
        </div>
      </dl>
      <div className="stat-bar" aria-hidden="true">
        <span className="stat-bar-segment additions" style={{ width: `${additionPercent}%` }} />
        <span className="stat-bar-segment removals" style={{ width: `${deletionPercent}%` }} />
      </div>
    </section>
  );
}
