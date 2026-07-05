'use client';

import { useState, useRef } from 'react';
import styles from './DocumentManager.module.css';

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001';

interface FileRecord {
  name: string;
  chunkCount: number;
  status: 'ready' | 'processing';
}

interface Props {
  files: FileRecord[];
  roomId: string;
}

export default function DocumentManager({ files, roomId }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const toggle = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const handleDelete = async (e: React.MouseEvent, fileName: string) => {
    e.stopPropagation(); // Don't trigger the card collapse toggle
    if (!confirm(`Are you sure you want to remove "${fileName}" from the RAG index?`)) return;

    try {
      const res = await fetch(`${SERVER_URL}/api/room/${roomId}/file`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Failed to remove file.');
      }
    } catch (err) {
      console.error(err);
      alert('Failed to delete file due to network error.');
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    setUploading(true);
    const formData = new FormData();
    for (let i = 0; i < selectedFiles.length; i++) {
      formData.append('files', selectedFiles[i]);
    }

    try {
      const res = await fetch(`${SERVER_URL}/api/room/${roomId}/upload`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Upload failed');
      }
    } catch (err) {
      console.error(err);
      alert('Upload failed due to network error.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const totalChunks = files.reduce((s, f) => s + f.chunkCount, 0);

  return (
    <div className={styles.container}>
      {/* Panel header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.panelIcon}>◈</span>
          <span className={styles.panelTitle}>DOCUMENT MANAGER</span>
        </div>
        <div className={styles.headerRight}>
          <button
            className={styles.addBtn}
            onClick={handleUploadClick}
            disabled={uploading}
            title="Upload new document"
          >
            {uploading ? '...' : '+ Upload'}
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            multiple
            style={{ display: 'none' }}
            accept=".txt,.md,.pdf,.js,.jsx,.ts,.tsx,.py,.java"
          />
        </div>
      </div>

      {/* Stats row */}
      <div className={styles.statsRow}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{totalChunks}</span>
          <span className={styles.statLabel}>Vectors</span>
        </div>
        <div className={styles.statDivider} />
        <div className={styles.stat}>
          <span className={styles.statValue}>{files.length}</span>
          <span className={styles.statLabel}>Files</span>
        </div>
        <div className={styles.statDivider} />
        <div className={styles.stat}>
          <span className={styles.statValue} style={{ color: 'var(--success)' }}>
            {files.filter((f) => f.status === 'ready').length}
          </span>
          <span className={styles.statLabel}>Ready</span>
        </div>
      </div>

      <div className="divider" />

      {/* File list */}
      {files.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>◯</span>
          <p>No documents indexed.</p>
          <p style={{ marginTop: 4 }}>Click upload above to add documents.</p>
        </div>
      ) : (
        <ul className={styles.fileList}>
          {files.map((file) => (
            <li
              key={file.name}
              className={`${styles.fileItem} ${expanded.has(file.name) ? styles.expanded : ''}`}
              onClick={() => toggle(file.name)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && toggle(file.name)}
              id={`doc-${file.name.replace(/[^a-zA-Z0-9]/g, '-')}`}
            >
              <div className={styles.fileRow}>
                {/* Status indicator */}
                <span
                  className={styles.statusDot}
                  style={{
                    background: file.status === 'ready' ? 'var(--success)' : 'var(--warning)',
                    boxShadow: `0 0 5px ${file.status === 'ready' ? 'var(--success)' : 'var(--warning)'}`,
                  }}
                  aria-label={file.status}
                />

                {/* File name */}
                <span className={styles.fileName} title={file.name}>
                  {file.name}
                </span>

                {/* Chunk count badge */}
                <span className={styles.chunkBadge}>{file.chunkCount}</span>

                {/* Delete button */}
                <button
                  className={styles.deleteBtn}
                  onClick={(e) => handleDelete(e, file.name)}
                  title="Remove document from index"
                >
                  ✕
                </button>

                {/* Chevron */}
                <span className={`${styles.chevron} ${expanded.has(file.name) ? styles.chevronOpen : ''}`}>
                  ›
                </span>
              </div>

              {/* Expanded detail */}
              {expanded.has(file.name) && (
                <div className={styles.detail}>
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Status</span>
                    <span
                      className={`badge ${file.status === 'ready' ? 'badge-success' : 'badge-muted'}`}
                    >
                      {file.status === 'ready' ? '● INDEXED' : '○ PROCESSING'}
                    </span>
                  </div>
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Chunks</span>
                    <span className={styles.detailValue}>{file.chunkCount} vectors</span>
                  </div>
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Strategy</span>
                    <span className={styles.detailValue}>TF-IDF · 500 token windows</span>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Footer instruction */}
      <div className={styles.footer}>
        <span className={styles.footerText}>
          Type <code className={styles.code}>!connect {roomId}</code> in Discord
        </span>
      </div>
    </div>
  );
}
