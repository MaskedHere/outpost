import type { CSSProperties } from 'react';

// A basic clip-art hillside.
const TREES = [
  { x: 10, y: 136, scale: 1, dur: 5, delay: 0, amp: 1 },
  { x: 120, y: 99, scale: 1.25, dur: 4.6, delay: 0.4, amp: 1.2 },
  { x: 230, y: 66, scale: 1.6, dur: 5.3, delay: 0.9, amp: 0.9 },
  { x: 380, y: 61, scale: 2, dur: 4.8, delay: 1.5, amp: 1.3 },
  { x: 560, y: 71, scale: 1.4, dur: 5.1, delay: 0.3, amp: 1.1 },
  { x: 700, y: 105, scale: 1.1, dur: 4.4, delay: 1.1, amp: 0.8 },
  { x: 820, y: 85, scale: 1.75, dur: 5.4, delay: 0.7, amp: 1.2 },
  { x: 960, y: 94, scale: 1.25, dur: 4.9, delay: 1.8, amp: 1 },
  { x: 1080, y: 119, scale: 1, dur: 5.2, delay: 0.2, amp: 0.9 },
  { x: 1150, y: 109, scale: 1.4, dur: 4.7, delay: 1.4, amp: 1.1 },
];

/** `animate` off keeps the scene and drops the sway, for machines that cannot composite cheaply. */
export default function PageBackground({ animate = true }: { animate?: boolean }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 -z-10 h-[60vh]">
      {/* "slice" (rather than "meet") scales up to fully COVER the box on both axes instead of
         fitting inside it. */}
      <svg
        className="absolute bottom-0 left-0 h-full w-full"
        viewBox="0 0 1200 400"
        preserveAspectRatio="xMinYMax slice"
      >
        <defs>
          <symbol id="bg-tree" viewBox="0 0 40 60">
            <rect x="17" y="44" width="6" height="16" fill="#232529" />
            <polygon
              points="20,0 13,12 18,12 8,26 14,26 2,44 38,44 26,26 32,26 22,12 27,12"
              fill="#232529"
            />
          </symbol>
          <symbol id="bg-tower" viewBox="0 0 40 90">
            <polygon points="20,0 6,16 34,16" fill="#232529" />
            <rect x="11" y="16" width="18" height="16" fill="#232529" />
            <polygon points="13,32 3,90 9,90 17,32" fill="#232529" />
            <polygon points="27,32 37,90 31,90 23,32" fill="#232529" />
            <rect x="6" y="58" width="28" height="4" fill="#232529" />
          </symbol>
        </defs>
        <polygon
          points="0,190 200,150 400,175 600,140 800,185 1000,155 1200,195 1200,400 0,400"
          fill="#232529"
        />
        <use href="#bg-tower" width="40" height="90" transform="translate(25,90) scale(1.15)" />
        {TREES.map((t, i) => (
          <g key={i} transform={`translate(${t.x},${t.y}) scale(${t.scale})`}>
            <g
              className={`origin-bottom [transform-box:fill-box] ${animate ? 'animate-tree-sway' : ''}`}
              style={
                {
                  animationDuration: `${t.dur}s`,
                  animationDelay: `${t.delay}s`,
                  '--sway-amp': `${t.amp}deg`,
                } as CSSProperties
              }
            >
              <use href="#bg-tree" width="40" height="60" />
            </g>
          </g>
        ))}
      </svg>
    </div>
  );
}
