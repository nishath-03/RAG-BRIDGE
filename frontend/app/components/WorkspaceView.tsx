'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { io as socketIO, type Socket } from 'socket.io-client';
import type { RoomState } from '../page';
import DocumentManager from './DocumentManager';
import TerminalLog, { type LogEntry } from './TerminalLog';
import styles from './WorkspaceView.module.css';

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001';

interface Props {
  roomState: RoomState;
}

interface FileRecord {
  name: string;
  chunkCount: number;
  status: 'ready' | 'processing';
}

export default function WorkspaceView({ roomState }: Props) {
  const { roomId } = roomState;
  const socketRef  = useRef<Socket | null>(null);

  const [connected, setConnected]       = useState(false);
  const [voicePaired, setVoicePaired]   = useState(false);
  const [logs, setLogs]                 = useState<LogEntry[]>([]);
  const [files, setFiles]               = useState<FileRecord[]>(
    roomState.files.map((f) => ({ ...f, status: 'ready' as const }))
  );
  const [authError, setAuthError]       = useState<string | null>(null);
  const [hintDismissed, setHintDismissed] = useState(false);

  // ─── Custom Config States ──────────────────────────────────────────────────
  const [activeTab, setActiveTab]       = useState<'docs' | 'config'>('docs');
  const [model, setModel]               = useState('gemini-2.5-flash');
  const [topK, setTopK]                 = useState(3);
  const [systemPrompt, setSystemPrompt] = useState(
    "You are a helpful AI assistant. Use the following document context to answer the user's question."
  );
  const [newGeminiKey, setNewGeminiKey] = useState('');
  const [saving, setSaving]             = useState(false);

  // ─── Web Voice Chat States ────────────────────────────────────────────────
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(false);
  const [voiceChatActive, setVoiceChatActive]       = useState(false);
  const [listening, setListening]                   = useState(false);
  const [waitingForBot, setWaitingForBot]           = useState(false);

  const voiceOutputRef     = useRef(voiceOutputEnabled);
  const voiceChatActiveRef = useRef(voiceChatActive);
  const recognitionRef     = useRef<any>(null);
  const audioRef           = useRef<HTMLAudioElement | null>(null);
  const voicesRef          = useRef<SpeechSynthesisVoice[]>([]);
  const resumeIntervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const speakAloudRef      = useRef<(text: string) => void>(() => {});

  useEffect(() => {
    voiceOutputRef.current = voiceOutputEnabled;
  }, [voiceOutputEnabled]);

  useEffect(() => {
    voiceChatActiveRef.current = voiceChatActive;
    if (voiceChatActive) {
      setVoiceOutputEnabled(true); // Voice chat requires audio output
    }
  }, [voiceChatActive]);

  // Pre-load browser voices — Chrome loads them async
  useEffect(() => {
    const loadVoices = () => {
      const v = window.speechSynthesis.getVoices();
      if (v.length > 0) voicesRef.current = v;
    };
    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
      window.speechSynthesis.cancel();
      if (resumeIntervalRef.current) clearInterval(resumeIntervalRef.current);
      if (recognitionRef.current) try { recognitionRef.current.stop(); } catch {}
    };
  }, []);

  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }

    const rec = new SpeechRecognition();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = 'en-US';

    rec.onstart = () => {
      setListening(true);
      setWaitingForBot(false);
    };

    rec.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      if (transcript.trim() && socketRef.current) {
        socketRef.current.emit('web_query', { roomId, question: transcript.trim() });
      }
    };

    rec.onerror = (err: any) => {
      console.error('[Speech] Error:', err);
      setListening(false);
    };

    rec.onend = () => {
      setListening(false);
    };

    recognitionRef.current = rec;
    try {
      rec.start();
    } catch (e) {
      console.error('[Speech] Start failed:', e);
    }
  }, [roomId]);

  const speakAloud = useCallback((text: string) => {
    const cleanText = text
      .replace(/`{3}[\s\S]*?`{3}/g, '') // remove code blocks
      .replace(/`.*?`/g, '')             // remove inline code
      .replace(/\[Chunk \d+\]/g, '')     // remove citations
      .replace(/[*_`#\-+]/g, '')        // remove markdown tags
      .trim();

    const resumeOnDone = () => {
      if (resumeIntervalRef.current) {
        clearInterval(resumeIntervalRef.current);
        resumeIntervalRef.current = null;
      }
      if (voiceChatActiveRef.current) {
        setTimeout(() => startListening(), 500);
      }
    };

    if (!cleanText) {
      resumeOnDone();
      return;
    }

    // Stop any ongoing speech / resume interval
    window.speechSynthesis.cancel();
    if (resumeIntervalRef.current) {
      clearInterval(resumeIntervalRef.current);
      resumeIntervalRef.current = null;
    }

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'en-US';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    // Use pre-loaded voices (Chrome loads voices async so we cache them)
    const voices = voicesRef.current;
    const bestVoice =
      voices.find((v) => v.lang === 'en-US' && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Online'))) ||
      voices.find((v) => v.lang.startsWith('en-US')) ||
      voices.find((v) => v.lang.startsWith('en'));
    if (bestVoice) utterance.voice = bestVoice;

    // Chrome bug fix: speechSynthesis silently pauses on long text.
    // Keep a "resume" heartbeat while speaking.
    resumeIntervalRef.current = setInterval(() => {
      if (!window.speechSynthesis.speaking) {
        if (resumeIntervalRef.current) clearInterval(resumeIntervalRef.current);
        resumeIntervalRef.current = null;
        return;
      }
      window.speechSynthesis.resume();
    }, 10000);

    utterance.onend = () => {
      resumeOnDone();
    };

    utterance.onerror = (e) => {
      console.warn('[TTS] utterance error:', e.error);
      resumeOnDone();
    };

    try {
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.error('[TTS] speak() threw:', err);
      resumeOnDone();
    }
  }, [startListening]);

  // Keep speakAloudRef up-to-date so the socket handler (which never re-registers)
  // always calls the latest version of speakAloud.
  useEffect(() => {
    speakAloudRef.current = speakAloud;
  }, [speakAloud]);

  const toggleVoiceChat = () => {
    const nextActive = !voiceChatActive;
    setVoiceChatActive(nextActive);
    voiceChatActiveRef.current = nextActive;

    if (nextActive) {
      startListening();
    } else {
      stopVoice();
    }
  };

  // Stop speaking mid-sentence and resume listening if in voice chat mode
  const stopVoice = () => {
    window.speechSynthesis.cancel();
    if (resumeIntervalRef.current) {
      clearInterval(resumeIntervalRef.current);
      resumeIntervalRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
    setListening(false);
    setWaitingForBot(false);
  };

  const getVoiceChatPillClass = () => {
    if (!voiceChatActive) return styles.pillMuted;
    if (listening) return styles.pillGreen;     // Green for active mic
    if (waitingForBot) return styles.pillAmber; // Amber for thinking
    return styles.pillRed;                      // Red/Crimson for bot speaking
  };

  const getVoiceChatPillLabel = () => {
    if (!voiceChatActive) return '🎙️ VOICE CHAT: OFF';
    if (listening) return '🎙️ VOICE: LISTENING';
    if (waitingForBot) return '⚡ VOICE: THINKING';
    return '🔊 VOICE: SPEAKING';
  };

  // Fetch initial room status (files + config) on mount
  useEffect(() => {
    fetch(`${SERVER_URL}/api/room/${roomId}/status`)
      .then((res) => {
        if (!res.ok) throw new Error('Status fetch failed');
        return res.json();
      })
      .then((data) => {
        if (data.config) {
          setModel(data.config.model || 'gemini-2.5-flash');
          setTopK(data.config.topK || 3);
          setSystemPrompt(
            data.config.systemPrompt ||
              "You are a helpful AI assistant. Use the following document context to answer the user's question."
          );
        }
        if (data.files) {
          setFiles(data.files.map((f: any) => ({ ...f, status: 'ready' })));
        }
      })
      .catch((err) => console.error('[Workspace] Fetch status error:', err));
  }, [roomId]);

  // ─── Socket connection ────────────────────────────────────────────────────
  useEffect(() => {
    const socket = socketIO(SERVER_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join_room', roomId);
    });

    socket.on('disconnect', () => setConnected(false));

    socket.on('sys_log', (data: Omit<LogEntry, 'id'>) => {
      addLog(data);
      if (data.message.includes('voice channel')) setVoicePaired(true);
    });

    socket.on('file_processed', (data: { name: string; chunkCount: number }) => {
      setFiles((prev) => {
        const exists = prev.find((f) => f.name === data.name);
        if (exists) return prev.map((f) => f.name === data.name ? { ...f, status: 'ready', chunkCount: data.chunkCount } : f);
        return [...prev, { name: data.name, chunkCount: data.chunkCount, status: 'ready' }];
      });
    });

    socket.on('file_removed', (data: { name: string }) => {
      setFiles((prev) => prev.filter((f) => f.name !== data.name));
    });

    socket.on('config_updated', (data: { config: any }) => {
      if (data.config) {
        setModel(data.config.model);
        setTopK(data.config.topK);
        setSystemPrompt(data.config.systemPrompt);
      }
    });

    socket.on('transcript', (data: Omit<LogEntry, 'id'>) => {
      addLog(data);
      if (data.type === 'USER') {
        setWaitingForBot(true);
        setListening(false);
      }
    });

    socket.on('bot_response', (data: Omit<LogEntry, 'id'>) => {
      addLog(data);
      setWaitingForBot(false);
      if (voiceOutputRef.current || voiceChatActiveRef.current) {
        speakAloudRef.current(data.message);
      }
    });

    socket.on('auth_error', (data: Omit<LogEntry, 'id'>) => {
      setAuthError(data.message);
      addLog({ ...data, type: 'ERR' });
      setWaitingForBot(false);
      if (voiceChatActiveRef.current) {
        setTimeout(() => startListening(), 1000);
      }
    });

    return () => { socket.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const addLog = useCallback((data: Omit<LogEntry, 'id'>) => {
    setLogs((prev) => [
      ...prev,
      { ...data, id: `${Date.now()}-${Math.random()}` },
    ]);
  }, []);

  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${SERVER_URL}/api/room/${roomId}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          topK,
          systemPrompt,
          geminiKey: newGeminiKey.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update configuration.');
      }

      setNewGeminiKey('');
      setActiveTab('docs'); // switch back to docs after successful save
    } catch (err: any) {
      alert(err.message || 'Error saving configuration.');
    } finally {
      setSaving(false);
    }
  };

  const dismissAuthError = () => setAuthError(null);

  return (
    <div className={styles.container}>
      {/* ─── Top Bar ─────────────────────────────────────────────────── */}
      <header className={styles.topBar}>
        <div className={styles.brand}>
          <span className={styles.brandIcon}>⬡</span>
          <span className={styles.brandText}>RAG-BRIDGE</span>
        </div>

        <div className={styles.roomMeta}>
          <span className={styles.roomLabel}>ROOM ID</span>
          <span className={styles.roomId} id="room-id-display">{roomId}</span>
        </div>

        <div className={styles.statusPills}>
          <span className={`${styles.pill} ${connected ? styles.pillGreen : styles.pillRed}`}>
            <span className={`glow-dot ${connected ? '' : 'red'}`} aria-hidden="true" />
            {connected ? 'WS CONNECTED' : 'WS OFFLINE'}
          </span>
          <button
            className={`${styles.pill} ${styles.interactivePill} ${voiceOutputEnabled ? styles.pillGreen : styles.pillMuted}`}
            onClick={() => setVoiceOutputEnabled(!voiceOutputEnabled)}
            title="Read bot responses aloud"
            disabled={voiceChatActive}
          >
            🔊 VOICE OUTPUT: {voiceOutputEnabled ? 'ON' : 'OFF'}
          </button>
          <button
            className={`${styles.pill} ${styles.interactivePill} ${getVoiceChatPillClass()}`}
            onClick={toggleVoiceChat}
            title="Toggle continuous hands-free voice chat mode"
          >
            {getVoiceChatPillLabel()}
          </button>
          {/* Stop voice mid-sentence — appears only when bot is speaking */}
          {voiceChatActive && !listening && !waitingForBot && (
            <button
              className={`${styles.pill} ${styles.interactivePill} ${styles.pillStop}`}
              onClick={() => {
                stopVoice();
                // Resume listening after manual stop
                setTimeout(() => {
                  if (voiceChatActiveRef.current) startListening();
                }, 300);
              }}
              title="Stop speaking and listen again"
              id="stop-voice-btn"
            >
              🛑 STOP
            </button>
          )}
          <span className={`${styles.pill} ${voicePaired ? styles.pillGreen : styles.pillAmber}`}>
            <span className={`glow-dot ${voicePaired ? '' : 'amber'}`} aria-hidden="true" />
            {voicePaired ? 'VOICE PAIRED' : 'BOT OPTIONAL'}
          </span>
          {/* Discord hint — small dismissible badge in top bar */}
          {!voicePaired && !hintDismissed && (
            <span className={styles.discordHint}>
              🎙 <code className={styles.code}>!connect {roomId}</code> to enable voice
              <button
                className={styles.hintClose}
                onClick={() => setHintDismissed(true)}
                aria-label="Dismiss Discord hint"
              >✕</button>
            </span>
          )}
        </div>
      </header>

      {/* ─── Auth Error Banner ────────────────────────────────────────── */}
      {authError && (
        <div className={styles.authBanner} role="alert">
          <span>⚠ {authError}</span>
          <button className={styles.dismissBtn} onClick={dismissAuthError}>✕</button>
        </div>
      )}

      {/* ─── Main Split Pane ─────────────────────────────────────────── */}
      <div className={styles.workspaceGrid}>
        {/* Left: Tabbed Sidebar */}
        <aside className={styles.leftPane}>
          {/* Tabs bar */}
          <div className={styles.tabHeaders}>
            <button
              className={`${styles.tabHeader} ${activeTab === 'docs' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('docs')}
            >
              📄 Documents
            </button>
            <button
              className={`${styles.tabHeader} ${activeTab === 'config' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('config')}
            >
              ⚙ Configuration
            </button>
          </div>

          {activeTab === 'docs' ? (
            <DocumentManager files={files} roomId={roomId} />
          ) : (
            <div className={styles.configContainer}>
              <h2 className={styles.configTitle}>⚙ SETTINGS</h2>
              
              <div className={styles.configField}>
                <label className={styles.configLabel}>Google Gemini API Key</label>
                <input
                  type="password"
                  className="input-field"
                  placeholder="Update key (leave blank to keep current)..."
                  value={newGeminiKey}
                  onChange={(e) => setNewGeminiKey(e.target.value)}
                  autoComplete="off"
                />
              </div>

              <div className={styles.configField}>
                <label className={styles.configLabel}>Generative Model</label>
                <select
                  className="input-field"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  style={{ cursor: 'pointer' }}
                >
                  <option value="gemini-2.5-flash">gemini-2.5-flash (Default)</option>
                  <option value="gemini-1.5-flash">gemini-1.5-flash</option>
                  <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                  <option value="gemini-1.5-pro">gemini-1.5-pro</option>
                </select>
              </div>

              <div className={styles.configField}>
                <div className={styles.sliderLabelRow}>
                  <label className={styles.configLabel}>RAG Context (Top K)</label>
                  <span className={styles.sliderVal}>{topK} chunks</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="5"
                  step="1"
                  className={styles.sliderInput}
                  value={topK}
                  onChange={(e) => setTopK(parseInt(e.target.value, 10))}
                />
              </div>

              <div className={styles.configField}>
                <label className={styles.configLabel}>System Persona Prompt</label>
                <textarea
                  className={styles.textareaInput}
                  rows={6}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="Configure AI system instructions..."
                />
              </div>

              <button
                className={`btn-primary ${styles.applyBtn}`}
                onClick={handleSaveConfig}
                disabled={saving}
              >
                <span className="btn-text">{saving ? 'Applying...' : 'Apply Changes'}</span>
              </button>
            </div>
          )}
        </aside>

        {/* Divider */}
        <div className={styles.verticalDivider} aria-hidden="true" />

        {/* Right: Terminal */}
        <section className={styles.rightPane}>
          <TerminalLog
            logs={logs}
            roomId={roomId}
            socket={socketRef.current}
            voiceChatActive={voiceChatActive}
          />
        </section>
      </div>
    </div>
  );
}
