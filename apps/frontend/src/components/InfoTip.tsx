import { FiInfo } from 'react-icons/fi';

/** A small hover-for-explanation (i) icon — the plain-language "what does this actually do and why
 *  would I want it" that a setting's own short label never has room for. Named group (group/tip)
 *  so it doesn't fight with an outer hover-group a setting row might already use. */
export default function InfoTip({ text }: { text: string }) {
  return (
    <span className="group/tip relative inline-flex align-middle">
      <FiInfo className="h-3.5 w-3.5 cursor-help text-base-500 hover:text-accent-400" />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-56 -translate-x-1/2 rounded-lg border border-base-700 bg-base-900 px-2.5 py-1.5 text-xs font-normal normal-case leading-snug text-base-200 opacity-0 shadow-lg transition-opacity group-hover/tip:opacity-100">
        {text}
      </span>
    </span>
  );
}
