import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { FiCopy } from 'react-icons/fi';
import { openConsoleSocket } from '../../lib/ws';
import '@xterm/xterm/css/xterm.css';

const BACKSPACE = String.fromCharCode(127);

// Keeps memory bounded on a long-running open console tab — plenty for "copy the log" / switching
// filters, without holding an ever-growing session's worth of output.
const MAX_LINES = 5000;

type LogFilter = 'all' | 'warn' | 'error';

// Strips ANSI CSI sequences (color codes etc., e.g. "\x1b[39m") — these logs are full of them, and
// they'd otherwise pollute both the warn/error regex matching and the copied clipboard text.
// no-control-regex fires on the \x1b here; matching that escape byte is the entire point.
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = new RegExp('\\x1b\\[[0-9;]*[a-zA-Z]', 'g');

function stripAnsi(line: string): string {
  return line.replace(ANSI_PATTERN, '');
}

const ERROR_RE = /\b(error|exception|fatal|severe|caused by)\b/i;
const WARN_RE = /\bwarn(ing)?\b/i;

/** A stack-trace/detail line hanging off the error above it — "\tat com.foo.Bar(...)",
 *  "Caused by: ...", "... 26 more". None of these contain the word "error", so a naive
 *  line-by-line filter showed the one-line exception header and silently dropped the entire trace
 *  underneath it, which is the part that actually says what broke. */
function isContinuationLine(plainLine: string): boolean {
  return /^\s+at\s/.test(plainLine) || /^\s*(caused by|suppressed):/i.test(plainLine) || /^\s*\.\.\.\s*\d+\s*more/.test(plainLine);
}

function isErrorLine(plainLine: string): boolean {
  return ERROR_RE.test(plainLine);
}

function isWarnLine(plainLine: string): boolean {
  return WARN_RE.test(plainLine);
}

/** Selects the lines a filter should show, keeping each match's trailing stack trace with it. */
function selectLines(rawLines: string[], filter: LogFilter): string[] {
  if (filter === 'all') return rawLines;
  const wanted = filter === 'warn' ? isWarnLine : isErrorLine;
  const out: string[] = [];
  let inBlock = false;
  for (const line of rawLines) {
    const plain = stripAnsi(line);
    if (wanted(plain)) {
      out.push(line);
      inBlock = true;
    } else if (inBlock && (isContinuationLine(plain) || plain.trim() === '')) {
      // Blank lines inside a Java trace are common; keep them so the block stays readable.
      out.push(line);
    } else {
      inBlock = false;
    }
  }
  return out;
}

// xterm renders ANSI, so colouring is just a matter of wrapping the line. Existing codes are
// stripped first so ours actually wins — a mid-line reset in the original would otherwise drop the
// colour partway through. This is what makes a crash visibly red instead of the same grey as
// everything else, which is how a stack trace scrolled past unnoticed.
const RED = '\x1b[91m';
const YELLOW = '\x1b[93m';
const RESET = '\x1b[0m';

function colorize(line: string): string {
  const plain = stripAnsi(line);
  if (isErrorLine(plain) || isContinuationLine(plain)) return `${RED}${plain}${RESET}`;
  if (isWarnLine(plain)) return `${YELLOW}${plain}${RESET}`;
  return line;
}

const FILTERS: { value: LogFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'warn', label: 'Warnings' },
  { value: 'error', label: 'Errors' },
];

export default function ConsoleTab({ serverId }: { serverId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputBuffer = useRef('');
  const termRef = useRef<Terminal | null>(null);
  // Raw (ANSI intact) completed lines received this session — the source of truth for "Copy log"
  // and for replaying a filtered view without needing to ask the server for history again.
  const rawLinesRef = useRef<string[]>([]);
  const partialRef = useRef('');
  const filterRef = useRef<LogFilter>('all');
  const [filter, setFilter] = useState<LogFilter>('all');
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      convertEol: true,
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: 13,
      theme: {
        // Uses this app's own base/accent tokens (tailwind.config.js) rather than xterm's defaults.
        // Deliberately a step darker than the surrounding .card (base-900) so the console reads as
        // a recessed terminal surface instead of loose text floating on the panel.
        background: '#16181c', // base-950
        foreground: '#dbe4ec', // base-100
        cursor: '#09de78', // accent-500
        cursorAccent: '#16181c', // base-950
        selectionBackground: 'rgba(9, 222, 120, 0.25)', // accent-500 @ 25%
        black: '#16181c',
        brightBlack: '#5c6472',
        red: '#f87171',
        brightRed: '#fca5a5',
        green: '#09de78',
        brightGreen: '#33f598',
        yellow: '#f97316',
        brightYellow: '#fb923c',
        blue: '#60a5fa',
        brightBlue: '#93c5fd',
        magenta: '#c084fc',
        brightMagenta: '#d8b4fe',
        cyan: '#22d3ee',
        brightCyan: '#67e8f9',
        white: '#dbe4ec',
        brightWhite: '#ecf9fb',
      },
    });
    termRef.current = term;
    rawLinesRef.current = [];
    partialRef.current = '';
    filterRef.current = 'all';
    setFilter('all');

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    term.writeln('Connecting to console...\r\n');

    const socket = openConsoleSocket(serverId);
    socket.onmessage = (event) => {
      const data: string = event.data;

      // Always record complete lines (ANSI intact) for copy/filter-switch, buffering any trailing
      // partial line across chunks.
      const combined = partialRef.current + data;
      const parts = combined.split('\n');
      partialRef.current = parts.pop() ?? '';
      for (const line of parts) {
        rawLinesRef.current.push(line);
      }
      if (rawLinesRef.current.length > MAX_LINES) {
        rawLinesRef.current.splice(0, rawLinesRef.current.length - MAX_LINES);
      }

      // Colouring needs a whole line to classify, so output is written line-by-line rather than
      // passing the raw chunk straight through. A trailing partial line waits for its newline —
      // server logs are newline-terminated, so in practice this isn't perceptible.
      for (const line of selectLines(parts, filterRef.current)) {
        term.write(colorize(line) + '\r\n');
      }
    };
    socket.onclose = () => term.writeln('\r\n[outpost] console disconnected');
    socket.onerror = () => term.writeln('\r\n[outpost] console error');

    const dataDisposable = term.onData((data) => {
      // Local line-editing: echo characters, only send a full line to the server on Enter.
      if (data === '\r') {
        term.write('\r\n');
        if (inputBuffer.current.length > 0 && socket.readyState === WebSocket.OPEN) {
          socket.send(inputBuffer.current);
        }
        inputBuffer.current = '';
      } else if (data === BACKSPACE) {
        if (inputBuffer.current.length > 0) {
          inputBuffer.current = inputBuffer.current.slice(0, -1);
          term.write('\b \b');
        }
      } else {
        inputBuffer.current += data;
        term.write(data);
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      // A ResizeObserver callback already queued when this tab unmounts can still fire once after
      // `disconnect()` (a known browser-level race, not a React bug) — by then xterm's internal
      // renderer is gone, so fit() throws "Cannot read properties of undefined (reading
      // 'dimensions')". Uncaught, that error was wedging the tab-switch entirely: AnimatePresence's
      // exit transition never completed, leaving Console's content stuck on screen no matter what
      // tab you clicked next. Harmless to swallow — there's nothing left to fit anyway.
      try {
        fit.fit();
      } catch {
        // ignore
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      dataDisposable.dispose();
      resizeObserver.disconnect();
      socket.close();
      term.dispose();
      termRef.current = null;
    };
  }, [serverId]);

  const applyFilter = (next: LogFilter) => {
    filterRef.current = next;
    setFilter(next);
    const term = termRef.current;
    if (!term) return;

    term.reset();
    const matched = selectLines(rawLinesRef.current, next);
    if (matched.length === 0) {
      term.writeln(next === 'all' ? '(no output yet)' : `[outpost] no ${next === 'warn' ? 'warning' : 'error'} lines yet.`);
    } else {
      term.write(matched.map((line) => colorize(line) + '\r\n').join(''));
    }
  };

  /** navigator.clipboard only exists in a "secure context" — HTTPS or localhost. Outpost on a NAS
   *  is reached over plain http://<nas-ip>:7420, so the entire API is undefined there and "Copy
   *  log" could never work, which is exactly how it failed in practice. This falls back to the old
   *  execCommand path, which has no such restriction. Deprecated, but it's the only thing that
   *  works over plain HTTP, and it degrades to a visible "Copy failed" if even that is blocked. */
  const writeToClipboard = async (text: string): Promise<boolean> => {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // fall through to the execCommand path below
      }
    }
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      // Kept off-screen but still focusable — execCommand('copy') only copies a live selection.
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '-1000px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  };

  const copyLog = async () => {
    // Copies the full session log, not just the filtered view — "copy the log" to paste somewhere
    // for help is the whole point, and a filtered excerpt usually leaves out the useful context.
    const text = rawLinesRef.current.map(stripAnsi).join('\n');
    const ok = await writeToClipboard(text);
    if (ok) {
      setCopied(true);
      setCopyFailed(false);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 2000);
    }
  };

  return (
    <div className="card overflow-hidden p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex gap-1 rounded-lg bg-base-800 p-1 text-xs">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                filter === f.value ? 'bg-base-700 text-base-50' : 'text-base-500 hover:text-base-200'
              }`}
              onClick={() => applyFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button className={`btn-secondary !px-2.5 !py-1 !text-xs ${copyFailed ? '!text-red-400' : ''}`} onClick={copyLog}>
          <FiCopy className="h-3.5 w-3.5" />
          {copyFailed ? 'Copy failed' : copied ? 'Copied ✓' : 'Copy log'}
        </button>
      </div>
      {/* Inset well around the terminal: the darker fill plus an inner ring gives the console a
          recessed edge, so output reads as being *inside* something rather than printed onto the
          card. p-2 keeps the first column and top line off the border. */}
      <div className="rounded-lg bg-base-950 p-2 ring-1 ring-inset ring-base-800/80">
        <div ref={containerRef} className="h-[60vh]" />
      </div>
    </div>
  );
}
