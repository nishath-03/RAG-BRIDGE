@echo off
setlocal EnableDelayedExpansion
title RAG-BRIDGE — Launcher

:: ═══════════════════════════════════════════════════════════════════
::  RAG-BRIDGE — ONE-CLICK LAUNCHER
::  Double-click this file from y:\RAG_AGENT to start everything.
:: ═══════════════════════════════════════════════════════════════════

cd /d "%~dp0"

echo.
echo  ██████╗  █████╗  ██████╗     ██████╗ ██████╗ ██╗██████╗  ██████╗ ███████╗
echo  ██╔══██╗██╔══██╗██╔════╝    ██╔══██╗██╔══██╗██║██╔══██╗██╔════╝ ██╔════╝
echo  ██████╔╝███████║██║  ███╗   ██████╔╝██████╔╝██║██║  ██║██║  ███╗█████╗
echo  ██╔══██╗██╔══██║██║   ██║   ██╔══██╗██╔══██╗██║██║  ██║██║   ██║██╔══╝
echo  ██║  ██║██║  ██║╚██████╔╝   ██████╔╝██║  ██║██║██████╔╝╚██████╔╝███████╗
echo  ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝    ╚═════╝ ╚═╝  ╚═╝╚═╝╚═════╝  ╚═════╝ ╚══════╝
echo.
echo  RAG-BRIDGE v1.0  ^|  BYOK Architecture  ^|  In-Memory RAG
echo  ════════════════════════════════════════════════════════════════
echo.

:: ── Check Node.js ──────────────────────────────────────────────────
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo  [ERROR] Node.js is not installed or not in PATH.
    echo          Download it from: https://nodejs.org
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo  [OK] Node.js %NODE_VER% detected
echo.

:: ── Fix PowerShell execution policy (needed for npm) ──────────────
powershell -NoProfile -Command "Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force" >nul 2>&1

:: ── Check / copy server .env ────────────────────────────────────────
if not exist "server\.env" (
    if exist "server\.env.example" (
        copy "server\.env.example" "server\.env" >nul
        echo  [WARN] server\.env was missing — copied from .env.example
        echo         Please edit server\.env with your API keys before continuing.
        echo.
        echo  Keys required:
        echo    DISCORD_TOKEN       — https://discord.com/developers/applications
        echo    DISCORD_CLIENT_ID   — Same page, General Information
        echo    DEEPGRAM_API_KEY    — https://console.deepgram.com
        echo.
        set /p CONTINUE="  Press ENTER to continue anyway, or Ctrl+C to abort and edit .env first: "
    ) else (
        echo  [WARN] No server\.env found. Server will start without Discord/Deepgram.
    )
)

:: ── Install server dependencies ────────────────────────────────────
if not exist "server\node_modules" (
    echo  [INSTALL] server\node_modules not found — installing server dependencies...
    echo           This may take 1-2 minutes on first run.
    echo.
    cd server
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo.
        echo  [ERROR] Server npm install failed. Check the output above.
        cd ..
        pause
        exit /b 1
    )
    :: Approve msedge-tts preinstall script (required for Edge TTS)
    call npm approve-scripts msedge-tts >nul 2>&1
    cd ..
    echo.
    echo  [OK] Server dependencies installed.
    echo.
) else (
    echo  [OK] Server dependencies already installed.
)

:: ── Install frontend dependencies ──────────────────────────────────
if not exist "frontend\node_modules" (
    echo  [INSTALL] frontend\node_modules not found — installing frontend dependencies...
    echo           This may take 1-2 minutes on first run.
    echo.
    cd frontend
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo.
        echo  [ERROR] Frontend npm install failed. Check the output above.
        cd ..
        pause
        exit /b 1
    )
    cd ..
    echo.
    echo  [OK] Frontend dependencies installed.
    echo.
) else (
    echo  [OK] Frontend dependencies already installed.
)

:: ── Launch server in a new window ──────────────────────────────────
echo  [START] Launching backend server on http://localhost:3001 ...
start "RAG-BRIDGE: Server" cmd /k "cd /d "%~dp0server" && echo. && echo  [SERVER] Starting on http://localhost:3001 && echo. && npm run dev"

:: ── Wait 3 seconds for server to boot ──────────────────────────────
timeout /t 3 /nobreak >nul

:: ── Launch frontend in a new window ────────────────────────────────
echo  [START] Launching frontend on http://localhost:3000 ...
start "RAG-BRIDGE: Frontend" cmd /k "cd /d "%~dp0frontend" && echo. && echo  [FRONTEND] Starting on http://localhost:3000 && echo. && npm run dev"

:: ── Wait 5 seconds then open browser ───────────────────────────────
echo  [WAIT]  Waiting 5s for frontend to compile...
timeout /t 5 /nobreak >nul

echo  [OPEN]  Opening http://localhost:3000 in your browser...
start "" "http://localhost:3000"

echo.
echo  ════════════════════════════════════════════════════════════════
echo   All systems launched!
echo.
echo   Web App  →  http://localhost:3000
echo   Server   →  http://localhost:3001
echo   Health   →  http://localhost:3001/health
echo.
echo   Tip: Type  !connect ^<ROOM-ID^>  in Discord to pair the bot.
echo  ════════════════════════════════════════════════════════════════
echo.
echo  This window can be closed. The server and frontend
echo  are running in their own terminal windows.
echo.
pause
