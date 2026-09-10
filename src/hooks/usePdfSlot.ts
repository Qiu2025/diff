import { useCallback, useEffect, useRef, useState } from 'react';

import type { PDFDocument, PdfSession } from '../utils/pdfUtils';

export interface LoadedPdf {
  doc: PDFDocument;
  session: PdfSession;
}

/**
 * Holds one open PDF for the lifetime of a comparison.
 *
 * Text extraction alone does not need an open document, but visual comparison
 * renders pages on demand, so the session stays open until it is replaced, the
 * comparison is cleared, or the application unmounts. Exactly one session per
 * slot is alive at a time: adopting a new one destroys the one it replaces.
 */
export function usePdfSlot(): [LoadedPdf | null, (next: LoadedPdf | null) => void] {
  const [loaded, setLoaded] = useState<LoadedPdf | null>(null);
  const current = useRef<LoadedPdf | null>(null);

  const adopt = useCallback((next: LoadedPdf | null) => {
    const previous = current.current;
    current.current = next;
    if (previous && previous !== next) void previous.session.destroy();
    setLoaded(next);
  }, []);

  useEffect(() => () => {
    void current.current?.session.destroy();
    current.current = null;
  }, []);

  return [loaded, adopt];
}
