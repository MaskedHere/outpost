import { KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { FiCopy } from 'react-icons/fi';
import { openConsoleSocket } from '../../lib/ws';

/** The server console. */

// Keeps memory bounded on a long-running open console.
const MAX_LINES = 5000;

// How many lines are in the DOM at once.
const RENDER_LIMIT = 600;

// Incoming output is batched to one render per frame.
const FLUSH_MS = 60;

type LogFilter = 'all' | 'warn' | 'error';

type Level = 'error' | 'warn' | 'info' | 'debug' | 'chat' | 'join' | 'leave' | 'rcon' | 'outpost';

interface LogLine {
  id: number;
  /** ANSI intact - what "Copy log" reproduces. */
  raw: string;
  plain: string;
  time: string | null;
  level: Level | null;
  message: string;
  /** A stack-trace line hanging off the error above it, kept with its parent by the filters. */
  continuation: boolean;
}

// Strips ANSI CSI sequences (colour codes etc., e.g. "\x1b[39m")
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = new RegExp('\\x1b\\[[0-9;]*[a-zA-Z]', 'g');

function stripAnsi(line: string): string {
  return line.replace(ANSI_PATTERN, '');
}

const ERROR_RE = /\b(error|exception|fatal|severe|caused by)\b/i;
const WARN_RE = /\bwarn(ing)?\b/i;

/**
 * "\tat com.foo.Bar(...)", "Caused by: ...", "... 26 more": trace lines that don't contain "error"
 * but belong with the exception above them.
 */
function isContinuationLine(plain: string): boolean {
  return (
    /^\s+at\s/.test(plain) ||
    /^\s*(caused by|suppressed):/i.test(plain) ||
    /^\s*\.\.\.\s*\d+\s*more/.test(plain)
  );
}

/**
 * Pulls the timestamp and level out of a log line so they can be shown as their own elements
 * instead of as noise repeated at the head of every line.
 */
function parseLine(id: number, raw: string): LogLine {
  const plain = stripAnsi(raw);
  const continuation = isContinuationLine(plain);

  let rest = plain;
  let time: string | null = null;
  let level: Level | null = null;

  const stamped = rest.match(/^\[(\d{1,2}:\d{2}:\d{2})\]\s*/);
  if (stamped) {
    time = stamped[1]!;
    rest = rest.slice(stamped[0].length);
  }

  const tagged = rest.match(/^\[([^\]]*?)[/|]([A-Z]+)\]:?\s*/);
  if (tagged) {
    const named = tagged[2]!.toLowerCase();
    if (named === 'error' || named === 'fatal' || named === 'severe') level = 'error';
    else if (named === 'warn' || named === 'warning') level = 'warn';
    else if (named === 'debug' || named === 'trace') level = 'debug';
    else if (named === 'info') level = 'info';
    if (/rcon/i.test(tagged[1]!)) level = 'rcon';
    rest = rest.slice(tagged[0].length);
  }

  // Outpost's own notices ("[outpost] console disconnected") are ours, not the game's.
  if (/^\[outpost\]/.test(rest)) {
    level = 'outpost';
    rest = rest.replace(/^\[outpost\]\s*/, '');
  }

  // Keyword classification runs after the structured pass so a line tagged INFO that is reporting
  // an exception still reads as an error.
  if (continuation || ERROR_RE.test(rest)) level = 'error';
  else if (level !== 'error' && WARN_RE.test(rest)) level = 'warn';
  else if (level === 'info' || level === null) {
    if (/\bjoined the game\b/i.test(rest)) level = 'join';
    else if (/\bleft the game\b/i.test(rest)) level = 'leave';
    else if (/^<[^>]+>\s/.test(rest)) level = 'chat';
  }

  return { id, raw, plain, time, level, message: rest, continuation };
}

/** Badge appearance per level. */
const BADGE: Record<Level, { label: string; className: string }> = {
  error: { label: 'ERROR', className: 'bg-red-500/15 text-red-300 ring-red-500/30' },
  warn: { label: 'WARN', className: 'bg-ember-500/15 text-ember-400 ring-ember-500/30' },
  info: { label: 'INFO', className: 'bg-base-800 text-base-500 ring-base-700' },
  debug: { label: 'DEBUG', className: 'bg-base-800 text-base-600 ring-base-700' },
  chat: { label: 'CHAT', className: 'bg-blue-500/15 text-blue-300 ring-blue-500/30' },
  join: { label: 'JOIN', className: 'bg-accent-500/15 text-accent-400 ring-accent-500/30' },
  leave: { label: 'LEAVE', className: 'bg-base-800 text-base-400 ring-base-700' },
  rcon: { label: 'RCON', className: 'bg-purple-500/15 text-purple-300 ring-purple-500/30' },
  outpost: { label: 'OUTPOST', className: 'bg-accent-500/15 text-accent-400 ring-accent-500/30' },
};

const MESSAGE_TONE: Record<Level, string> = {
  error: 'text-red-200',
  // Ember only defines 400/500 in the theme.
  warn: 'text-ember-400',
  info: 'text-base-200',
  debug: 'text-base-500',
  chat: 'text-blue-100',
  join: 'text-base-200',
  leave: 'text-base-400',
  rcon: 'text-base-200',
  outpost: 'text-accent-300',
};

/** Selects the lines a filter should show, keeping each match's trailing stack trace with it. */
function selectLines(lines: LogLine[], filter: LogFilter): LogLine[] {
  if (filter === 'all') return lines;
  const out: LogLine[] = [];
  let inBlock = false;
  for (const line of lines) {
    const matches = filter === 'warn' ? line.level === 'warn' : line.level === 'error';
    if (matches) {
      out.push(line);
      inBlock = true;
    } else if (inBlock && (line.continuation || line.plain.trim() === '')) {
      // Blank lines inside a Java trace are common; keep them so the block stays readable.
      out.push(line);
    } else {
      inBlock = false;
    }
  }
  return out;
}

const FILTERS: { value: LogFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'warn', label: 'Warnings' },
  { value: 'error', label: 'Errors' },
];

export default function ConsoleTab({ serverId }: { serverId: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const linesRef = useRef<LogLine[]>([]);
  const pendingRef = useRef<LogLine[]>([]);
  const partialRef = useRef('');
  const nextIdRef = useRef(0);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  // Whether the view is pinned to the newest output.
  const stickRef = useRef(true);

  const [visible, setVisible] = useState<LogLine[]>([]);
  const [filter, setFilter] = useState<LogFilter>('all');
  // Only lines at or after this id animate in.
  const [animateFrom, setAnimateFrom] = useState(0);
  const [connected, setConnected] = useState(false);
  const [command, setCommand] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const historyRef = useRef<string[]>([]);
  const historyPos = useRef(-1);

  const filterRef = useRef<LogFilter>('all');

  const recompute = useCallback((nextFilter: LogFilter) => {
    const matched = selectLines(linesRef.current, nextFilter);
    setVisible(matched.slice(-RENDER_LIMIT));
  }, []);

  const flush = useCallback(() => {
    flushTimer.current = null;
    if (pendingRef.current.length === 0) return;
    linesRef.current.push(...pendingRef.current);
    pendingRef.current = [];
    if (linesRef.current.length > MAX_LINES) {
      linesRef.current.splice(0, linesRef.current.length - MAX_LINES);
    }
    recompute(filterRef.current);
  }, [recompute]);

  const push = useCallback(
    (raw: string) => {
      pendingRef.current.push(parseLine(nextIdRef.current++, raw));
      if (flushTimer.current === null) flushTimer.current = setTimeout(flush, FLUSH_MS);
    },
    [flush],
  );

  useEffect(() => {
    linesRef.current = [];
    pendingRef.current = [];
    partialRef.current = '';
    nextIdRef.current = 0;
    stickRef.current = true;
    setVisible([]);
    setFilter('all');
    filterRef.current = 'all';

    const socket = openConsoleSocket(serverId);
    socketRef.current = socket;
    socket.onopen = () => setConnected(true);
    socket.onmessage = (event) => {
      const combined = partialRef.current + (event.data as string);
      const parts = combined.split('\n');
      // A trailing partial line waits for its newline.
      partialRef.current = parts.pop() ?? '';
      for (const line of parts) push(line.replace(/\r$/, ''));
    };
    socket.onclose = () => {
      setConnected(false);
      push('[outpost] console disconnected');
    };
    socket.onerror = () => push('[outpost] console error');

    return () => {
      if (flushTimer.current !== null) clearTimeout(flushTimer.current);
      flushTimer.current = null;
      socket.close();
      socketRef.current = null;
    };
  }, [serverId, push]);

  // Pin to the bottom after each batch, unless the reader has scrolled up.
  useEffect(() => {
    if (!stickRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    // A small tolerance: "close enough to the bottom" counts as following along, so a stray pixel
    // of momentum scrolling doesn't silently unpin the view.
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  const applyFilter = (next: LogFilter) => {
    filterRef.current = next;
    setFilter(next);
    setAnimateFrom(nextIdRef.current);
    stickRef.current = true;
    recompute(next);
  };

  const sendCommand = () => {
    const socket = socketRef.current;
    const text = command.trim();
    if (!text || socket?.readyState !== WebSocket.OPEN) return;
    socket.send(text);
    historyRef.current.push(text);
    historyPos.current = -1;
    setCommand('');
    stickRef.current = true;
  };

  const onCommandKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendCommand();
      return;
    }
    // Command history, the one terminal affordance worth keeping.
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const history = historyRef.current;
      if (history.length === 0) return;
      e.preventDefault();
      if (e.key === 'ArrowUp') {
        historyPos.current =
          historyPos.current < 0 ? history.length - 1 : Math.max(0, historyPos.current - 1);
        setCommand(history[historyPos.current] ?? '');
      } else if (historyPos.current >= 0) {
        historyPos.current += 1;
        if (historyPos.current >= history.length) {
          historyPos.current = -1;
          setCommand('');
        } else {
          setCommand(history[historyPos.current] ?? '');
        }
      }
    }
  };

  /** navigator.clipboard only exists in a "secure context". */
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
      // Kept off-screen but still focusable.
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
    // Copies the full session log, not just the filtered view.
    const text = linesRef.current.map((l) => l.plain).join('\n');
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
                filter === f.value
                  ? 'bg-base-700 text-base-50'
                  : 'text-base-500 hover:text-base-200'
              }`}
              onClick={() => applyFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          className={`btn-secondary !px-2.5 !py-1 !text-xs ${copyFailed ? '!text-red-400' : ''}`}
          onClick={copyLog}
        >
          <FiCopy className="h-3.5 w-3.5" />
          {copyFailed ? 'Copy failed' : copied ? 'Copied ✓' : 'Copy log'}
        </button>
      </div>

      {/* Inset well: a darker fill plus an inner ring gives the console a recessed look. */}
      <div className="rounded-lg bg-base-950 ring-1 ring-inset ring-base-800/80">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="h-[60vh] overflow-y-auto overflow-x-hidden p-2 font-mono text-[13px] leading-[1.45]"
        >
          {visible.length === 0 ? (
            <p className="px-1 py-2 text-base-600">
              {connected ? 'Waiting for output…' : 'Connecting to console…'}
            </p>
          ) : (
            visible.map((line) => (
              <div
                key={line.id}
                className={`flex gap-2 px-1 ${line.id >= animateFrom ? 'animate-log-in' : ''}`}
              >
                {line.time && (
                  <span className="shrink-0 select-none text-base-600">{line.time}</span>
                )}
                {line.level && !line.continuation && (
                  <span
                    className={`mt-[2px] h-fit shrink-0 select-none rounded px-1.5 text-[10px] font-semibold leading-[1.4] tracking-wide ring-1 ring-inset ${BADGE[line.level].className}`}
                  >
                    {BADGE[line.level].label}
                  </span>
                )}
                <span
                  className={`min-w-0 whitespace-pre-wrap break-words ${line.level ? MESSAGE_TONE[line.level] : 'text-base-200'}`}
                >
                  {line.message}
                </span>
              </div>
            ))
          )}
        </div>

        {/* A real input, rather than echoing keystrokes into the log by hand the way the terminal
            emulator had to. */}
        <div className="flex items-center gap-2 border-t border-base-800/80 px-3 py-2">
          <span className="select-none font-mono text-sm text-accent-500">&gt;</span>
          <input
            className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-base-100 outline-none placeholder:text-base-600"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={onCommandKey}
            placeholder={connected ? 'Type a command and press Enter' : 'Console disconnected'}
            disabled={!connected}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      </div>
    </div>
  );
}
