import { useCallback } from 'react';
import './PDFDropZone.css';

interface PDFDropZoneProps {
  label: string;
  file: File | null;
  onFileSelect: (file: File) => void;
  disabled?: boolean;
}

export function PDFDropZone({ label, file, onFileSelect, disabled = false }: PDFDropZoneProps) {
  const inputId = `file-input-${label.replace(/\s+/g, '-').toLowerCase()}`;
  const hintId = `${inputId}-hint`;

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (disabled) return;
      
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile && droppedFile.type === 'application/pdf') {
        onFileSelect(droppedFile);
      }
    },
    [onFileSelect, disabled]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = e.target.files?.[0];
      if (selectedFile && selectedFile.type === 'application/pdf') {
        onFileSelect(selectedFile);
      }
    },
    [onFileSelect]
  );

  return (
    <div
      className={`pdf-dropzone ${file ? 'has-file' : ''} ${disabled ? 'disabled' : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <input
        type="file"
        accept=".pdf,application/pdf"
        onChange={handleFileInput}
        id={inputId}
        aria-describedby={hintId}
        disabled={disabled}
      />
      <label htmlFor={inputId}>
        <div className="dropzone-content">
          <div className="dropzone-icon" aria-hidden="true">
            <span>PDF</span>
          </div>
          <div className="dropzone-text">
            <span className="dropzone-label">{label}</span>
            <strong className={file ? 'dropzone-filename' : 'dropzone-prompt'}>
              {file ? file.name : 'Choose a PDF'}
            </strong>
            <span className="dropzone-hint" id={hintId}>
              {file ? 'Ready to compare · select to replace' : 'Drop it here or browse your device'}
            </span>
          </div>
          <span className="dropzone-action" aria-hidden="true">{file ? 'Replace' : 'Browse'}</span>
        </div>
      </label>
    </div>
  );
}
