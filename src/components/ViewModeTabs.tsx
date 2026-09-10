import './ViewModeTabs.css';

export type ViewMode = 'side-by-side' | 'unified' | 'additions' | 'removals' | 'changes-only' | 'visual';

interface ViewModeTabsProps {
  activeMode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
}

const tabs: { mode: ViewMode; label: string }[] = [
  { mode: 'side-by-side', label: 'Split' },
  { mode: 'unified', label: 'Inline' },
  { mode: 'additions', label: 'Added' },
  { mode: 'removals', label: 'Removed' },
  { mode: 'changes-only', label: 'Changes' },
  { mode: 'visual', label: 'Visual' },
];

export function ViewModeTabs({ activeMode, onModeChange }: ViewModeTabsProps) {
  return (
    <div className="view-mode-tabs" role="group" aria-label="Comparison view">
      {tabs.map(({ mode, label }) => (
        <button
          type="button"
          key={mode}
          className={`view-mode-tab ${activeMode === mode ? 'active' : ''}`}
          onClick={() => onModeChange(mode)}
          aria-pressed={activeMode === mode}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
