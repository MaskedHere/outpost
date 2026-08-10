import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { openConsoleSocket } from '../../lib/ws';
import '@xterm/xterm/css/xterm.css';

const BACKSPACE = String.fromCharCode(127);

export default function ConsoleTab({ serverId }: { serverId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputBuffer = useRef('');

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      convertEol: true,
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: 13,
      theme: { background: '#10151d', foreground: '#dbe1ea', cursor: '#2dd4bf' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    term.writeln('Connecting to console...\r\n');

    const socket = openConsoleSocket(serverId);
    socket.onmessage = (event) => term.write(event.data);
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

    const resizeObserver = new ResizeObserver(() => fit.fit());
    resizeObserver.observe(containerRef.current);

    return () => {
      dataDisposable.dispose();
      resizeObserver.disconnect();
      socket.close();
      term.dispose();
    };
  }, [serverId]);

  return (
    <div className="card overflow-hidden p-3">
      <div ref={containerRef} className="h-[60vh]" />
    </div>
  );
}
