'use client';

import { useState, useEffect } from 'react';
import styles from './LandingView.module.css';

interface Props {
  onInit: () => void;
}

const ASCII_LOGO = `
  ██████╗  █████╗  ██████╗     ██████╗ ██████╗ ██╗██████╗  ██████╗ ███████╗
  ██╔══██╗██╔══██╗██╔════╝    ██╔══██╗██╔══██╗██║██╔══██╗██╔════╝ ██╔════╝
  ██████╔╝███████║██║  ███╗   ██████╔╝██████╔╝██║██║  ██║██║  ███╗█████╗  
  ██╔══██╗██╔══██║██║   ██║   ██╔══██╗██╔══██╗██║██║  ██║██║   ██║██╔══╝  
  ██║  ██║██║  ██║╚██████╔╝   ██████╔╝██║  ██║██║██████╔╝╚██████╔╝███████╗
  ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝    ╚═════╝ ╚═╝  ╚═╝╚═╝╚═════╝  ╚═════╝ ╚══════╝`;

const TAGLINES = [
  'RAG-powered voice intelligence.',
  'Your docs. Your key. Your channel.',
  'In-memory. Zero latency. Full control.',
  'Speak the question. Hear the answer.',
];

export default function LandingView({ onInit }: Props) {
  const [taglineIndex, setTaglineIndex] = useState(0);
  const [displayText, setDisplayText] = useState('');
  const [isTyping, setIsTyping] = useState(true);

  // Typewriter effect for taglines
  useEffect(() => {
    const target = TAGLINES[taglineIndex];
    if (isTyping) {
      if (displayText.length < target.length) {
        const t = setTimeout(() => setDisplayText(target.slice(0, displayText.length + 1)), 45);
        return () => clearTimeout(t);
      } else {
        const t = setTimeout(() => setIsTyping(false), 2200);
        return () => clearTimeout(t);
      }
    } else {
      if (displayText.length > 0) {
        const t = setTimeout(() => setDisplayText(displayText.slice(0, -1)), 20);
        return () => clearTimeout(t);
      } else {
        setTaglineIndex((i) => (i + 1) % TAGLINES.length);
        setIsTyping(true);
      }
    }
  }, [displayText, isTyping, taglineIndex]);

  return (
    <div className={styles.container}>
      {/* Scanline overlay */}
      <div className={styles.scanline} aria-hidden="true" />

      {/* Grid pattern background */}
      <div className={styles.grid} aria-hidden="true" />

      <div className={styles.content}>
        {/* ASCII Logo */}
        <pre className={styles.asciiLogo} aria-label="RAG Bridge logo">
          {ASCII_LOGO}
        </pre>

        {/* Sub-brand */}
        <div className={styles.subBrand}>
          <span className={styles.rag}>RAG-BRIDGE</span>
          <span className={styles.version}>v1.0</span>
        </div>

        {/* Typewriter tagline */}
        <div className={styles.tagline}>
          <span className="mono">{displayText}</span>
          <span className="cursor-blink" aria-hidden="true" />
        </div>

        {/* Separator */}
        <div className={styles.separator}>
          <div className={styles.line} />
          <span className={styles.sepLabel}>RAG-BRIDGE</span>
          <div className={styles.line} />
        </div>

        {/* Feature pills */}
        <div className={styles.features}>
          {['BYOK Architecture', 'In-Memory RAG', 'Discord Voice', 'Real-Time STT', 'Edge-TTS'].map((f) => (
            <span key={f} className={styles.pill}>{f}</span>
          ))}
        </div>

        {/* CTA Button */}
        <button
          id="init-workspace-btn"
          className={`btn-primary ${styles.ctaBtn}`}
          onClick={onInit}
        >
          <span className="btn-text">⬡ Initialize Workspace</span>
        </button>

        {/* System status bar */}
        <div className={styles.statusBar}>
          <span className={styles.statusItem}>
            <span className="glow-dot" aria-hidden="true" />
            SYSTEM ONLINE
          </span>
          <span className={styles.statusDivider}>|</span>
          <span className={styles.statusItem} style={{ color: 'var(--text-dim)' }}>
            MEMORY: IN-PROCESS
          </span>
          <span className={styles.statusDivider}>|</span>
          <span className={styles.statusItem} style={{ color: 'var(--text-dim)' }}>
            DB: NONE REQUIRED
          </span>
        </div>
      </div>
    </div>
  );
}
