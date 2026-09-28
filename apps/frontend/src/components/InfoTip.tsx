import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FiInfo } from 'react-icons/fi';

/** A small hover-for-explanation (i) icon. */
const TIP_WIDTH = 260;
/** Keeps the bubble clear of the window edges when an icon sits near one. */
const VIEWPORT_MARGIN = 8;

export default function InfoTip({ text }: { text: string }) {
  const iconRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; below: boolean } | null>(
    null,
  );

  const show = () => {
    const rect = iconRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Centred on the icon, then pulled back inside the viewport if that would overhang either edge.
    const idealLeft = rect.left + rect.width / 2 - TIP_WIDTH / 2;
    const maxLeft = window.innerWidth - TIP_WIDTH - VIEWPORT_MARGIN;
    const left = Math.max(VIEWPORT_MARGIN, Math.min(idealLeft, maxLeft));

    // Prefer above; flip below when there isn't room, so a tip near the top of the page isn't cut
    // off by the window itself.
    const below = rect.top < 140;
    const top = below ? rect.bottom + 8 : rect.top - 8;

    setPosition({ left, top, below });
  };

  return (
    <>
      <span
        ref={iconRef}
        className="inline-flex align-middle"
        onMouseEnter={show}
        onMouseLeave={() => setPosition(null)}
        onFocus={show}
        onBlur={() => setPosition(null)}
        tabIndex={0}
      >
        <FiInfo className="h-3.5 w-3.5 cursor-help text-base-500 hover:text-accent-400" />
      </span>

      {position &&
        createPortal(
          <span
            role="tooltip"
            className="pointer-events-none fixed z-[200] rounded-lg border border-base-700 bg-base-900 px-2.5 py-1.5 text-xs font-normal normal-case leading-snug text-base-200 shadow-xl"
            style={{
              left: position.left,
              top: position.top,
              width: TIP_WIDTH,
              // Anchored by its bottom edge when sitting above the icon, so it grows upward and the
              // gap to the icon stays constant however tall the text is.
              transform: position.below ? undefined : 'translateY(-100%)',
            }}
          >
            {text}
          </span>,
          document.body,
        )}
    </>
  );
}
