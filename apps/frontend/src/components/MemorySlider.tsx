import InfoTip from './InfoTip';

function formatMb(mb: number): string {
  return mb >= 1024 ? `${mb % 1024 === 0 ? mb / 1024 : (mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

/** The highest value the sliders offer, given the host's total RAM. Caps at 75% of the machine so
 *  there's always headroom for the OS, Outpost itself, and any other servers already running —
 *  handing a single container 100% of physical RAM is a reliable way to get it OOM-killed. Rounded
 *  down to a whole GB, and never below 2GB so the control stays usable on a small box. */
export function maxMemoryMb(hostMemoryMb: number | undefined): number {
  if (!hostMemoryMb || hostMemoryMb <= 0) return 16384;
  return Math.max(2048, Math.floor((hostMemoryMb * 0.75) / 1024) * 1024);
}

export default function MemorySlider({
  value,
  onChange,
  min = 512,
  max = 8192,
  step = 512,
  disabled = false,
}: {
  value: number;
  onChange: (mb: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  const percent = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="label !mb-0 flex items-center gap-1.5">
          Memory
          <InfoTip text="How much RAM the container is allowed to use — this becomes the game's max heap size, not just a soft limit. More isn't always better: a heavily modded pack genuinely needs more (4-8 GB), but a vanilla/lightly-modded server rarely benefits past 2-3 GB and you're better off leaving the rest for your machine." />
        </span>
        <span className="text-sm font-semibold text-accent-400">{formatMb(value)}</span>
      </div>
      <input
        type="range"
        className="slider"
        style={{ background: `linear-gradient(to right, #09de78 ${percent}%, #42444a ${percent}%)` }}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="mt-1 flex justify-between text-xs text-base-500">
        <span>{formatMb(min)}</span>
        <span>{formatMb(max)}</span>
      </div>
    </div>
  );
}
