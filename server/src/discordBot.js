'use strict';

const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
} = require('discord.js');

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');

const { createClient: createDeepgramClient, LiveTranscriptionEvents } = require('@deepgram/sdk');

const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const { PassThrough } = require('stream');
const prism = require('prism-media');

const { sessionExists, getSession, updateSessionVoiceChannel } = require('./sessionStore');
const { query: ragQuery } = require('./ragEngine');
const { generateResponse, AuthError } = require('./geminiClient');

// ─── TTS Helper ──────────────────────────────────────────────────────────────
const tts = new MsEdgeTTS();
let ttsReady = false;

async function initTTS() {
  try {
    await tts.setMetadata('en-US-AriaNeural', OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS);
    ttsReady = true;
    console.log('[TTS] Edge-TTS initialized.');
  } catch (err) {
    console.warn('[TTS] Edge-TTS init failed:', err.message);
  }
}

/**
 * Convert text to an audio resource playable in Discord.
 * msedge-tts v2: toStream() is synchronous, returns { audioStream }
 */
function textToAudioResource(text) {
  const { audioStream } = tts.toStream(text);
  const resource = createAudioResource(audioStream);
  return resource;
}

// ─── Deepgram Helper ─────────────────────────────────────────────────────────
function createDeepgramLiveSession(onTranscript, onError) {
  const { createClient } = require('@deepgram/sdk');
  const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

  const live = deepgram.listen.live({
    model: 'nova-2',
    language: 'en-US',
    smart_format: true,
    interim_results: false,
    endpointing: 300,
  });

  live.on(LiveTranscriptionEvents.Open, () => {
    console.log('[Deepgram] Connection opened.');
  });

  live.on(LiveTranscriptionEvents.Transcript, (data) => {
    const transcript = data?.channel?.alternatives?.[0]?.transcript;
    if (transcript && transcript.trim().length > 0 && data.is_final) {
      onTranscript(transcript.trim());
    }
  });

  live.on(LiveTranscriptionEvents.Error, onError);

  live.on(LiveTranscriptionEvents.Close, () => {
    console.log('[Deepgram] Connection closed.');
  });

  return live;
}

// ─── Per-Room Voice State ─────────────────────────────────────────────────────
// roomVoiceState[roomId] = { connection, player, receiver, isPlaying }
const roomVoiceState = {};

// ─── Process Transcript ──────────────────────────────────────────────────────
async function processTranscript(roomId, transcript, textChannel) {
  const session = getSession(roomId);
  if (!session) return;

  const io = global.io;

  // Emit transcript to web terminal
  if (io) {
    io.to(roomId).emit('transcript', {
      type: 'USER',
      message: transcript,
      timestamp: new Date().toISOString(),
    });
  }

  try {
    // 1. RAG lookup
    const contextChunks = ragQuery(roomId, transcript, 3);

    // 2. Gemini generation
    const answer = await generateResponse({
      apiKey: session.geminiKey,
      question: transcript,
      contextChunks,
      modelName: session.config?.model,
      systemPrompt: session.config?.systemPrompt,
    });

    // 3. Stream answer to web terminal
    if (io) {
      io.to(roomId).emit('bot_response', {
        type: 'BOT',
        message: answer,
        timestamp: new Date().toISOString(),
      });
    }

    // 4. Text-to-speech → Discord voice channel
    const voiceState = roomVoiceState[roomId];
    if (voiceState && ttsReady) {
      try {
        const resource = textToAudioResource(answer);
        voiceState.isPlaying = true;
        voiceState.player.play(resource);
      } catch (ttsErr) {
        console.warn('[TTS] Could not play audio:', ttsErr.message);
      }
    }

    // 5. Also send clean text to Discord text channel
    if (textChannel) {
      const preview = answer.length > 1800 ? answer.slice(0, 1800) + '…' : answer;
      await textChannel.send(`**Bot:** ${preview}`).catch(() => {});
    }
  } catch (err) {
    if (err instanceof AuthError) {
      const alertMsg =
        '⚠️ Authentication Failure: Please refresh your Gemini API key inside the room settings console.';

      if (io) {
        io.to(roomId).emit('auth_error', {
          type: 'ERR',
          message: alertMsg,
          timestamp: new Date().toISOString(),
        });
      }
      if (textChannel) {
        await textChannel.send(`🔴 ${alertMsg}`).catch(() => {});
      }
    } else {
      console.error('[Discord] processTranscript error:', err);
      if (io) {
        io.to(roomId).emit('sys_log', {
          type: 'ERR',
          message: `Internal error: ${err.message}`,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }
}

// ─── Join Voice Channel & Set Up Listening Loop ───────────────────────────────
async function connectToVoiceChannel(voiceChannel, textChannel, roomId) {
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });

  // Wait for Ready state
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
  } catch {
    connection.destroy();
    throw new Error('Could not connect to voice channel within 15 seconds.');
  }

  updateSessionVoiceChannel(roomId, voiceChannel.id, voiceChannel.guild.id);

  // Audio player for TTS output
  const player = createAudioPlayer();
  connection.subscribe(player);

  const voiceState = { connection, player, isPlaying: false };
  roomVoiceState[roomId] = voiceState;

  player.on(AudioPlayerStatus.Idle, () => {
    voiceState.isPlaying = false;
  });

  // Notify web terminal
  if (global.io) {
    global.io.to(roomId).emit('sys_log', {
      type: 'SYS',
      message: `Bot connected to voice channel: #${voiceChannel.name}`,
      timestamp: new Date().toISOString(),
    });
  }

  console.log(`[Discord] Connected to #${voiceChannel.name} for room ${roomId}`);

  // ─── Listening Loop ─────────────────────────────────────────────────────
  const receiver = connection.receiver;

  // Listen for new speakers
  receiver.speaking.on('start', (userId) => {
    // If bot is playing TTS and a user starts speaking → interrupt
    if (voiceState.isPlaying) {
      console.log('[Discord] Interruption detected — stopping TTS playback.');
      player.stop();
    }

    // Don't subscribe twice to the same user
    if (receiver.subscriptions.has(userId)) return;

    console.log(`[Discord] User ${userId} started speaking.`);

    const audioStream = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
    });

    // Open Deepgram live session
    let deepgramLive;
    try {
      deepgramLive = createDeepgramLiveSession(
        (transcript) => processTranscript(roomId, transcript, textChannel),
        (err) => console.error('[Deepgram] Error:', err)
      );
    } catch (err) {
      console.error('[Deepgram] Failed to create session:', err.message);
      return;
    }

    // Pipe PCM audio → Deepgram
    audioStream.on('data', (chunk) => {
      if (deepgramLive && deepgramLive.getReadyState() === 1 /* OPEN */) {
        deepgramLive.send(chunk);
      }
    });

    audioStream.on('end', () => {
      console.log(`[Discord] User ${userId} stopped speaking.`);
      if (deepgramLive) {
        try { deepgramLive.requestClose(); } catch {}
      }
    });

    audioStream.on('error', (err) => {
      console.error(`[Discord] Audio stream error for ${userId}:`, err.message);
    });
  });

  // Handle disconnects
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      connection.destroy();
      delete roomVoiceState[roomId];
      console.log(`[Discord] Disconnected from voice for room ${roomId}`);
    }
  });
}

// ─── Discord Client ──────────────────────────────────────────────────────────
async function initDiscordBot() {
  await initTTS();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`[Discord] Bot ready as ${c.user.tag}`);
  });

  // ─── !connect <roomId> command ───────────────────────────────────────────
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    const content = message.content.trim();
    if (!content.startsWith('!connect')) return;

    const parts = content.split(/\s+/);
    const roomId = parts[1]?.toUpperCase();

    if (!roomId || roomId.length !== 6) {
      return message.reply('❌ Usage: `!connect <6-digit-Room-ID>`');
    }

    if (!sessionExists(roomId)) {
      return message.reply(
        `❌ Room **${roomId}** does not exist. Please create a room in the web app first.`
      );
    }

    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      return message.reply('❌ You must be in a voice channel to use this command.');
    }

    // Already connected to this room
    if (roomVoiceState[roomId]) {
      return message.reply(`⚠️ Bot is already connected for room **${roomId}**.`);
    }

    await message.reply(
      `🔴 Connecting to **#${voiceChannel.name}** for room **${roomId}**...`
    );

    try {
      await connectToVoiceChannel(voiceChannel, message.channel, roomId);
      await message.channel.send(
        `✅ Connected! Room **${roomId}** is now live. Speak and your questions will be answered.`
      );
    } catch (err) {
      console.error('[Discord] Connect error:', err);
      await message.channel.send(`❌ Failed to connect: ${err.message}`);
    }
  });

  await client.login(process.env.DISCORD_TOKEN);
  return client;
}

module.exports = { initDiscordBot };
