import { useEffect, useMemo, useRef, useState } from 'react';
import type { SelectOption } from './Select';

/**
 * A dropdown you can either scroll or type into, for lists long enough that scrolling alone is
 * tedious — the Minecraft version list runs to hundreds of entries, so finding 1.21.1 by eye means
 * a lot of wheel spinning.
 *
 * Deliberately not built on Radix Select like the plain <Select> is: that component owns keyboard
 * input for its own single-letter typeahead, so a real text field can't live inside its content.
 * This is a hand-rolled combobox instead — a button that swaps to a filter input when open, over a
 * list that narrows as you type.
 */

/** Ranks matches so the most likely intent floats up: an exact hit first, then prefix matches
 *  ("1.21" surfaces 1.21 before 11.21.x), then anything merely containing the text. Non-matches are
 *  dropped. Ordering within a tier is preserved from the original list, which for versions means
 *  newest-first stays intact. */
function rankOptions(options: SelectOption[], query: string): SelectOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;

  const exact: SelectOption[] = [];
  const prefix: SelectOption[] = [];
  const contains: SelectOption[] = [];

  for (const option of options) {
    const label = option.label.toLowerCase();
    if (label === q) exact.push(option);
    else if (label.startsWith(q)) prefix.push(option);
    else if (label.includes(q)) contains.push(option);
  }
  return [...exact, ...prefix, ...contains];
}

export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[] | string[];
  placeholder?: string;
  id?: string;
}) {
  const normalized: SelectOption[] = useMemo(
    () => options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o)),
    [options],
  );

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => rankOptions(normalized, query), [normalized, query]);
  const selectedLabel = normalized.find((o) => o.value === value)?.label ?? '';

  // Opening always starts from a clean, unfiltered list — carrying the previous query over would
  // hide most options with no obvious reason why.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setHighlight(Math.max(0, normalized.findIndex((o) => o.value === value)));
    inputRef.current?.focus();
  }, [open, normalized, value]);

  // Typing changes what's in the list, so the old index would point somewhere arbitrary.
  useEffect(() => setHighlight(0), [query]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  // Keeps the keyboard-highlighted row visible when arrowing past the edge of the scroll area.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${highlight}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const commit = (option: SelectOption) => {
    onChange(option.value);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const option = filtered[highlight];
      if (option) commit(option);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      {open ? (
        <input
          ref={inputRef}
          id={id}
          className="input"
          value={query}
          placeholder={selectedLabel || placeholder || 'Type to filter…'}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded
          aria-controls={id ? `${id}-listbox` : undefined}
          autoComplete="off"
        />
      ) : (
        <button
          id={id}
          type="button"
          className="input flex items-center justify-between gap-2 text-left"
          onClick={() => setOpen(true)}
        >
          <span className={selectedLabel ? '' : 'text-base-500'}>{selectedLabel || placeholder}</span>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-base-500">
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {open && (
        <div
          ref={listRef}
          id={id ? `${id}-listbox` : undefined}
          role="listbox"
          className="absolute z-50 mt-1.5 max-h-72 w-full overflow-y-auto rounded-xl border border-base-700 bg-base-800 p-1 shadow-xl"
        >
          {filtered.map((option, index) => (
            <div
              key={option.value}
              data-index={index}
              role="option"
              aria-selected={option.value === value}
              className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${
                index === highlight ? 'bg-accent-500/15 text-accent-400' : 'text-base-100'
              } ${option.value === value ? 'text-accent-400' : ''}`}
              // mousedown rather than click: the click-outside handler also listens for mousedown,
              // and a plain onClick would fire after the panel had already closed.
              onMouseDown={(e) => {
                e.preventDefault();
                commit(option);
              }}
              onMouseEnter={() => setHighlight(index)}
            >
              <span>{option.label}</span>
              {option.value === value && (
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
          ))}
          {filtered.length === 0 && <p className="px-3 py-4 text-center text-sm text-base-500">No matches for "{query.trim()}".</p>}
        </div>
      )}
    </div>
  );
}
