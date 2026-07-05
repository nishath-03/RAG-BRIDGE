'use client';

import { useState, useCallback } from 'react';
import LandingView from './components/LandingView';
import SetupView from './components/SetupView';
import WorkspaceView from './components/WorkspaceView';

export type AppView = 'landing' | 'setup' | 'workspace';

export interface RoomState {
  roomId: string;
  files: Array<{ name: string; chunkCount: number }>;
}

export default function HomePage() {
  const [view, setView] = useState<AppView>('landing');
  const [roomState, setRoomState] = useState<RoomState | null>(null);

  const handleInit = useCallback(() => setView('setup'), []);

  const handleDeploy = useCallback((state: RoomState) => {
    setRoomState(state);
    setView('workspace');
  }, []);

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--bg-canvas)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {view === 'landing' && <LandingView onInit={handleInit} />}
      {view === 'setup'   && <SetupView onDeploy={handleDeploy} onBack={() => setView('landing')} />}
      {view === 'workspace' && roomState && (
        <WorkspaceView roomState={roomState} />
      )}
    </main>
  );
}
