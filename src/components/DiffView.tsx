import { alignTextLines } from '../utils/diffUtils';
import type { DiffPart } from '../utils/diffUtils';
import './DiffView.css';

interface DiffViewProps {
  parts: DiffPart[];
  mode: 'side-by-side' | 'unified' | 'additions' | 'removals' | 'changes-only';
  originalText?: string;
  modifiedText?: string;
}

export function DiffView({ parts, mode, originalText, modifiedText }: DiffViewProps) {
  if (mode === 'side-by-side' && originalText !== undefined && modifiedText !== undefined) {
    const rows = alignTextLines(originalText, modifiedText);

    return (
      <div className="diff-view side-by-side">
        <h4 className="panel-header">Original</h4>
        <h4 className="panel-header">Modified</h4>
        <div className="diff-content diff-side-content">
          {rows.map((row, rowIndex) => (
            <div className="diff-side-row" key={rowIndex}>
              <div className="diff-side-cell original">
                {row.parts.map((part, partIndex) => !part.added && (
                  <span key={partIndex} className={part.removed ? 'diff-removed' : ''}>
                    {part.value}
                  </span>
                ))}
              </div>
              <div className="diff-side-cell modified">
                {row.parts.map((part, partIndex) => !part.removed && (
                  <span key={partIndex} className={part.added ? 'diff-added' : ''}>
                    {part.value}
                  </span>
                ))}
              </div>
            </div>
          ))}
          </div>
      </div>
    );
  }

  if (mode === 'additions') {
    const additionParts = parts.filter(part => part.added);
    if (additionParts.length === 0) {
      return (
        <div className="diff-view empty">
          <p>No additions found</p>
        </div>
      );
    }
    return (
      <div className="diff-view additions-only">
        <h4 className="panel-header additions-header">Additions</h4>
        <div className="diff-content">
          {additionParts.map((part, index) => (
            <div key={index} className="diff-block diff-added">
              {part.value}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (mode === 'removals') {
    const removalParts = parts.filter(part => part.removed);
    if (removalParts.length === 0) {
      return (
        <div className="diff-view empty">
          <p>No removals found</p>
        </div>
      );
    }
    return (
      <div className="diff-view removals-only">
        <h4 className="panel-header removals-header">Removals</h4>
        <div className="diff-content">
          {removalParts.map((part, index) => (
            <div key={index} className="diff-block diff-removed">
              {part.value}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (mode === 'changes-only') {
    const additionParts = parts.filter(part => part.added);
    const removalParts = parts.filter(part => part.removed);
    
    if (additionParts.length === 0 && removalParts.length === 0) {
      return (
        <div className="diff-view empty">
          <p>No changes found</p>
        </div>
      );
    }
    
    return (
      <div className="diff-view changes-split">
        <div className="changes-panel additions-panel">
          <h4 className="panel-header additions-header">Additions ({additionParts.length})</h4>
          <div className="diff-content">
            {additionParts.length > 0 ? (
              additionParts.map((part, index) => (
                <div key={index} className="diff-block diff-added">
                  {part.value}
                </div>
              ))
            ) : (
              <p className="empty-message">No additions</p>
            )}
          </div>
        </div>
        <div className="changes-panel removals-panel">
          <h4 className="panel-header removals-header">Removals ({removalParts.length})</h4>
          <div className="diff-content">
            {removalParts.length > 0 ? (
              removalParts.map((part, index) => (
                <div key={index} className="diff-block diff-removed">
                  {part.value}
                </div>
              ))
            ) : (
              <p className="empty-message">No removals</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Unified view
  return (
    <div className="diff-view unified">
      <h4 className="panel-header">Changes</h4>
      <div className="diff-content">
        {parts.map((part, index) => (
          <span
            key={index}
            className={
              part.added
                ? 'diff-added'
                : part.removed
                ? 'diff-removed'
                : ''
            }
          >
            {part.value}
          </span>
        ))}
      </div>
    </div>
  );
}
