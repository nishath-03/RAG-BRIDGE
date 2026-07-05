'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import type { RoomState } from '../page';
import styles from './SetupView.module.css';

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001';

const ACCEPTED_EXTENSIONS: Record<string, string[]> = {
  'text/plain':            ['.txt', '.md'],
  'application/pdf':       ['.pdf'],
  'text/javascript':       ['.js', '.jsx'],
  'application/javascript':['.js', '.jsx'],
  'text/x-python':         ['.py'],
  'text/x-java-source':    ['.java'],
  'text/typescript':       ['.ts', '.tsx'],
  'application/octet-stream': ['.js', '.py', '.java', '.ts', '.tsx'],
};

interface Props {
  onDeploy: (state: RoomState) => void;
  onBack: () => void;
}

type Phase = 'idle' | 'creating' | 'uploading' | 'done' | 'error';

export default function SetupView({ onDeploy, onBack }: Props) {
  const [geminiKey, setGeminiKey] = useState('');
  const [files, setFiles]         = useState<File[]>([]);
  const [phase, setPhase]         = useState<Phase>('idle');
  const [error, setError]         = useState<string | null>(null);
  const [showKey, setShowKey]     = useState(false);

  const onDrop = useCallback((accepted: File[]) => {
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      return [...prev, ...accepted.filter((f) => !names.has(f.name))];
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_EXTENSIONS,
    multiple: true,
  });

  const removeFile = (name: string) => setFiles((f) => f.filter((x) => x.name !== name));

  const handleDeploy = async () => {
    setError(null);

    if (!geminiKey.trim() || geminiKey.trim().length < 10) {
      setError('Please enter a valid Google Gemini API key.');
      return;
    }

    setPhase('creating');

    try {
      // 1. Create session
      const createRes = await fetch(`${SERVER_URL}/api/room/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geminiKey: geminiKey.trim() }),
      });

      if (!createRes.ok) {
        const err = await createRes.json();
        throw new Error(err.error || 'Failed to create room.');
      }

      const { roomId } = await createRes.json();

      // 2. Upload files (if any)
      let processedFiles: Array<{ name: string; chunkCount: number }> = [];

      if (files.length > 0) {
        setPhase('uploading');
        const formData = new FormData();
        files.forEach((f) => formData.append('files', f));

        const uploadRes = await fetch(`${SERVER_URL}/api/room/${roomId}/upload`, {
          method: 'POST',
          body: formData,
        });

        if (!uploadRes.ok) {
          const err = await uploadRes.json();
          throw new Error(err.error || 'File upload failed.');
        }

        const result = await uploadRes.json();
        processedFiles = result.files;
      }

      setPhase('done');
      onDeploy({ roomId, files: processedFiles });
    } catch (err: unknown) {
      setPhase('error');
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    }
  };

  const isLoading = phase === 'creating' || phase === 'uploading';

  const phaseLabel: Record<Phase, string> = {
    idle:      'Deploy Room',
    creating:  'Initializing Room...',
    uploading: 'Vectorizing Documents...',
    done:      'Launching Workspace...',
    error:     'Deploy Room',
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        {/* Header */}
        <div className={styles.header}>
          <button className="btn-secondary" onClick={onBack} id="back-btn">
            ← Back
          </button>
          <div>
            <h1 className={styles.title}>Workspace Configuration</h1>
            <p className={styles.subtitle}>Deploy a secured, isolated AI workspace</p>
          </div>
        </div>

        <div className="divider" />

        <div className={styles.body}>
          {/* File Uploader */}
          <section className={styles.section}>
            <label className={styles.sectionLabel}>
              <span className={styles.labelIcon}>⬡</span>
              Document Upload
              <span className="badge badge-muted" style={{ marginLeft: 8 }}>
                .txt .js .py .java .ts .pdf .md
              </span>
            </label>

            <div
              {...getRootProps()}
              className={`${styles.dropzone} ${isDragActive ? styles.dragActive : ''}`}
              id="file-dropzone"
            >
              <input {...getInputProps()} />
              <div className={styles.dropzoneInner}>
                <span className={styles.dropIcon}>⬆</span>
                <p className={styles.dropText}>
                  {isDragActive ? 'Release to drop files' : 'Drag files here or click to browse'}
                </p>
                <p className={styles.dropHint}>Max 20 MB per file · Up to 10 files</p>
              </div>
            </div>

            {/* File list */}
            {files.length > 0 && (
              <ul className={styles.fileList}>
                {files.map((f) => (
                  <li key={f.name} className={styles.fileItem}>
                    <span className={styles.fileIcon}>▸</span>
                    <span className={styles.fileName}>{f.name}</span>
                    <span className={styles.fileSize}>
                      {(f.size / 1024).toFixed(1)} KB
                    </span>
                    <button
                      className={styles.removeBtn}
                      onClick={() => removeFile(f.name)}
                      aria-label={`Remove ${f.name}`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Gemini API Key */}
          <section className={styles.section}>
            <label className={styles.sectionLabel} htmlFor="gemini-key-input">
              <span className={styles.labelIcon}>🔑</span>
              Google Gemini API Key
            </label>
            <div className={styles.keyInputWrap}>
              <input
                id="gemini-key-input"
                type={showKey ? 'text' : 'password'}
                className="input-field"
                placeholder="AIza..."
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                className={styles.toggleKey}
                onClick={() => setShowKey((v) => !v)}
                aria-label="Toggle key visibility"
                tabIndex={-1}
              >
                {showKey ? '🙈' : '👁'}
              </button>
            </div>
            <p className={styles.hint}>
              Your key is sent directly to the isolated room memory — never logged or stored.
            </p>
          </section>

          {/* Error display */}
          {error && (
            <div className={styles.errorBanner} role="alert">
              <span>⚠</span>
              <span>{error}</span>
            </div>
          )}

          {/* Deploy Button */}
          <button
            id="deploy-room-btn"
            className={`btn-primary ${styles.deployBtn}`}
            onClick={handleDeploy}
            disabled={isLoading}
          >
            <span className="btn-text">
              {isLoading ? (
                <span className={styles.spinner} aria-label="Loading" />
              ) : '⬡'}{' '}
              {phaseLabel[phase]}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
