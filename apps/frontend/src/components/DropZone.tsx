import { ReactNode, useEffect, useRef, useState } from 'react';
import { FiUploadCloud } from 'react-icons/fi';

/** Wraps any content with drag-and-drop file import. Listens at the window level rather than just
 *  its own bounding box — drag a file in from anywhere over the page, not just precisely over this
 *  component — and the overlay it shows is a real full-viewport takeover (fixed, not absolute), so
 *  it reads as "the whole app is ready to catch this" rather than a small inline hint. Only one of
 *  these is ever mounted at a time in practice (whichever page/panel is currently the one that can
 *  accept an import), so a page-wide listener never fights another one for the same drop. */
export default function DropZone({
  onDrop,
  hint,
  className = '',
  children,
}: {
  onDrop: (files: File[]) => void;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const onWindowDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) onDrop(files);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onWindowDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onWindowDrop);
    };
  }, [onDrop]);

  return (
    <div className={className}>
      {children}
      {dragging && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-base-950/85 backdrop-blur-md">
          <div className="pointer-events-none flex flex-col items-center gap-5 rounded-3xl border-2 border-dashed border-accent-500/50 bg-base-900/60 px-20 py-16 text-center shadow-2xl">
            <span className="relative flex h-16 w-16 items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-accent-500/20" />
              <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-accent-500/15">
                <FiUploadCloud className="h-8 w-8 text-accent-400" />
              </span>
            </span>
            <div>
              <p className="text-2xl font-semibold text-base-50">Drop files here to import them</p>
              {hint && <p className="mt-1.5 text-sm text-base-400">{hint}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
