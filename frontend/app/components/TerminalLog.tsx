'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import styles from './TerminalLog.module.css';

export interface LogEntry {
  id: string;
  type: 'SYS' | 'BOT' | 'USER' | 'ERR';
  message: string;
  timestamp: string;
}

interface Props {
  logs: LogEntry[];
  roomId: string;
  socket: Socket | null;
  voiceChatActive: boolean;
}

const TYPE_CONFIG: Record<LogEntry['type'], { label: string; color: string }> = {
  SYS:  { label: 'SYS', color: '#9ca3af' },
  BOT:  { label: 'BOT', color: '#60a5fa' },
  USER: { label: 'USR', color: '#ffffff' },
  ERR:  { label: 'ERR', color: '#ff0033' },
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch { return '--:--:--'; }
}

// ─── Rich Markdown Card for BOT responses ──────────────────────────────────
function RichBotMessage({ message }: { message: string }) {
  return (
    <div className={styles.richCard}>
      <ReactMarkdown
        components={{
          h1: ({ children }) => <h1 className={styles.mdH1}>{children}</h1>,
          h2: ({ children }) => <h2 className={styles.mdH2}>{children}</h2>,
          h3: ({ children }) => <h3 className={styles.mdH3}>{children}</h3>,
          p:  ({ children }) => <p  className={styles.mdPara}>{children}</p>,
          ul: ({ children }) => <ul className={styles.mdUl}>{children}</ul>,
          ol: ({ children }) => <ol className={styles.mdOl}>{children}</ol>,
          li: ({ children }) => <li className={styles.mdLi}>{children}</li>,
          hr: () => <hr className={styles.mdHr} />,
          strong: ({ children }) => <strong className={styles.mdStrong}>{children}</strong>,
          em:     ({ children }) => <em     className={styles.mdEm}>{children}</em>,
          blockquote: ({ children }) => (
            <blockquote className={styles.mdBlockquote}>{children}</blockquote>
          ),
          table: ({ children }) => (
            <div className={styles.tableWrapper}>
              <table className={styles.mdTable}>{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className={styles.mdThead}>{children}</thead>,
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr:    ({ children }) => <tr className={styles.mdTr}>{children}</tr>,
          th:    ({ children }) => <th className={styles.mdTh}>{children}</th>,
          td:    ({ children }) => <td className={styles.mdTd}>{children}</td>,
          code({ inline, className, children, ...props }: {
            inline?: boolean; className?: string; children?: React.ReactNode;
          }) {
            const match = /language-(\w+)/.exec(className || '');
            if (!inline && match) {
              return (
                <div className={styles.codeBlockWrap}>
                  <div className={styles.codeBlockHeader}>
                    <span className={styles.codeLang}>{match[1]}</span>
                  </div>
                  <SyntaxHighlighter
                    style={vscDarkPlus as Record<string, React.CSSProperties>}
                    language={match[1]}
                    PreTag="div"
                    customStyle={{
                      background: '#0d1117',
                      border: 'none',
                      borderRadius: '0 0 8px 8px',
                      margin: 0,
                      padding: '14px 16px',
                      fontSize: '12.5px',
                    }}
                    {...props}
                  >
                    {String(children).replace(/\n$/, '')}
                  </SyntaxHighlighter>
                </div>
              );
            }
            return <code className={styles.mdInlineCode} {...props}>{children}</code>;
          },
        }}
      >
        {message}
      </ReactMarkdown>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────
export default function TerminalLog({ logs, roomId, socket, voiceChatActive }: Props) {
  const bottomRef      = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);

  const [query,     setQuery]     = useState('');
  const [pending,   setPending]   = useState(false);
  const [listening, setListening] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    if (logs.length > 0) {
      const last = logs[logs.length - 1];
      if (last.type === 'BOT' || last.type === 'ERR') setPending(false);
    }
  }, [logs]);

  useEffect(() => {
    return () => { if (recognitionRef.current) recognitionRef.current.stop(); };
  }, []);

  const handleSend = useCallback(() => {
    const q = query.trim();
    if (!q || !socket || pending) return;
    setPending(true);
    socket.emit('web_query', { roomId, question: q });
    setQuery('');
    inputRef.current?.focus();
  }, [query, socket, roomId, pending]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const toggleListening = () => {
    if (listening) { recognitionRef.current?.stop(); return; }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert('Use Chrome or Edge for voice input.'); return; }
    try {
      const rec = new SR();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = 'en-US';
      rec.onstart  = () => setListening(true);
      rec.onresult = (e: any) => {
        const t = e.results[0][0].transcript;
        if (t.trim()) { setPending(true); socket?.emit('web_query', { roomId, question: t.trim() }); setQuery(''); }
      };
      rec.onerror = () => setListening(false);
      rec.onend   = () => setListening(false);
      recognitionRef.current = rec;
      rec.start();
    } catch { setListening(false); }
  };

  return (
    <div className={styles.container}>
      {/* ── Title Bar ─────────────────────────────────────────────── */}
      <div className={styles.titleBar}>
        <div className={styles.windowBtns} aria-hidden="true">
          <span className={`${styles.dot} ${styles.dotRed}`} />
          <span className={`${styles.dot} ${styles.dotAmber}`} />
          <span className={`${styles.dot} ${styles.dotGreen}`} />
        </div>
        <span className={styles.titleText}>antigravity-rag — room:{roomId} — live terminal</span>
        <span className={styles.logCount}>{logs.length} entries</span>
      </div>

      {/* ── Boot Banner ───────────────────────────────────────────── */}
      <div className={styles.bootBanner}>
        <pre className={styles.bootPre}>{`  ██████╗  █████╗  ██████╗     ██████╗ ██╗██████╗  ██████╗ ███████╗\n  ██╔══██╗██╔══██╗██╔════╝    ██╔══██╗██║██╔══██╗██╔════╝ ██╔════╝\n  ██████╔╝███████║██║  ███╗   ██████╔╝██║██║  ██║██║  ███╗█████╗  \n  ██╔══██╗██╔══██║██║   ██║   ██╔══██╗██║██║  ██║██║   ██║██╔══╝  \n  ██║  ██║██║  ██║╚██████╔╝   ██████╔╝██║██████╔╝╚██████╔╝███████╗\n  ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝    ╚═════╝ ╚═╝╚═════╝  ╚═════╝ ╚══════╝`}</pre>
        <div className={styles.bootMeta}>
          <span>RAG-BRIDGE v1.0 · ROOM: <strong style={{ color: 'var(--accent)' }}>{roomId}</strong></span>
          <span>IN-MEMORY RAG · GEMINI-2.5-FLASH · WEB CHAT + WEB VOICE</span>
        </div>
      </div>

      {/* ── Log Body ──────────────────────────────────────────────── */}
      <div className={styles.logBody} id="terminal-log-body" role="log" aria-live="polite">
        {logs.length === 0 && (
          <div className={styles.waiting}>
            <span className="cursor-blink" aria-hidden="true" />
            <span style={{ marginLeft: 8 }}>Type a question or click the mic button below...</span>
          </div>
        )}

        {logs.map((entry) => {
          const cfg = TYPE_CONFIG[entry.type];

          // BOT → rich card
          if (entry.type === 'BOT') {
            return (
              <div key={entry.id} className={styles.botBlock}>
                <div className={styles.botBlockHeader}>
                  <span className={styles.botAvatar}>⬡</span>
                  <span className={styles.botLabel}>RAG-BRIDGE</span>
                  <span className={styles.botTimestamp}>{formatTime(entry.timestamp)}</span>
                </div>
                <RichBotMessage message={entry.message} />
              </div>
            );
          }

          // USER / SYS / ERR → compact terminal row
          return (
            <div
              key={entry.id}
              className={`${styles.logEntry} ${entry.type === 'ERR' ? styles.entryError : ''} ${entry.type === 'USER' ? styles.entryUser : ''}`}
            >
              <div className={styles.entryMeta}>
                <span className={styles.timestamp}>{formatTime(entry.timestamp)}</span>
                <span className={styles.typeTag} style={{ color: cfg.color }}>[{cfg.label}]</span>
              </div>
              <div className={styles.entryContent}>{entry.message}</div>
            </div>
          );
        })}

        {/* Pending (typing) indicator */}
        {pending && (
          <div className={styles.botBlock}>
            <div className={styles.botBlockHeader}>
              <span className={styles.botAvatar}>⬡</span>
              <span className={styles.botLabel}>RAG-BRIDGE</span>
              <span className={styles.botTimestamp}>{formatTime(new Date().toISOString())}</span>
            </div>
            <div className={`${styles.richCard} ${styles.pendingCard}`}>
              <div className={styles.pendingDots}><span /><span /><span /></div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Chat Input Bar ────────────────────────────────────────── */}
      <div className={styles.chatBar}>
        <span className={styles.chatPrompt} aria-hidden="true">
          <span style={{ color: 'var(--accent)' }}>▸</span>
          <span style={{ color: 'var(--text-dim)', marginLeft: 4 }}>room@{roomId.toLowerCase()}:~$</span>
        </span>
        <input
          ref={inputRef}
          id="chat-input"
          className={styles.chatInput}
          type="text"
          placeholder={listening ? 'Listening… Speak now.' : socket ? 'Ask a question or click 🎙️…' : 'Connecting…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!socket || pending || listening}
          autoComplete="off"
          spellCheck={false}
          aria-label="Chat input"
        />
        <button
          id="chat-mic-btn"
          className={`${styles.micBtn} ${listening ? styles.micBtnListening : ''}`}
          onClick={toggleListening}
          disabled={!socket || pending || voiceChatActive}
          title={voiceChatActive ? 'Voice Chat mode is active' : listening ? 'Stop listening' : 'Start voice recognition'}
          aria-label="Toggle voice input"
        >
          {listening ? <span className={styles.pulsingRedDot} /> : '🎙️'}
        </button>
        <button
          id="chat-send-btn"
          className={`${styles.sendBtn} ${pending ? styles.sendBtnPending : ''}`}
          onClick={handleSend}
          disabled={!socket || !query.trim() || pending || listening}
          aria-label="Send message"
        >
          {pending ? <span className={styles.sendSpinner} /> : '⏎'}
        </button>
      </div>
    </div>
  );
}
