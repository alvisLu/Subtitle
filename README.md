# Subtitle

Real-time speech transcription and translation for video calls. Captures microphone and system audio simultaneously, transcribes with Whisper, and translates with DeepL.

## Features

- **Dual audio capture** — mic (channel 0) and system audio/loopback (channel 1) via ScreenCaptureKit
- **Voice Activity Detection** — Silero v5 model at 16 kHz, streaming 512-sample frames (~32 ms)
- **Speech-to-text** — OpenAI Whisper via HuggingFace Transformers (runs locally)
- **Translation** — DeepL API, Chinese ↔ English
- **Two modes** — Transcript (STT only) or Translate (STT + translation)
- **Audio playback** — play back raw or denoised segments from the UI

## Architecture

```
Renderer (React + MicVAD)
  └─ binary frames: [isFinal: u8][channel: u8][id: 21 bytes ASCII][Float32 PCM]
       ↓ IPC
Main process (Electron)
  └─ WebSocket client
       ↓
Sidecar (Node.js, port 8765)
  ├─ DSP: denoise, frame parsing
  ├─ STT: Whisper transcription
  └─ Translation: DeepL API
```

## Prerequisites

- Node.js 22+ (via nvm)
- pnpm
- macOS (ScreenCaptureKit required for system audio)
- Screen Recording permission granted to the app

## Setup

```bash
# Install dependencies
pnpm install

# Configure environment variables
cp electron/.env.example electron/.env
cp sidecar/.env.example sidecar/.env
# Edit sidecar/.env and set your DEEPL_API_KEY
```

## Development

Run the sidecar and Electron app in separate terminals:

```bash
# Terminal 1 — start the sidecar (WebSocket server)
pnpm sidecar

# Terminal 2 — start the Electron dev server
pnpm dev
```

## Project Structure

```
subtitle/
├── electron/               # Electron frontend (React + TypeScript)
│   └── src/
│       ├── main.ts         # Main process, IPC handlers, WS client
│       ├── preload.ts      # contextBridge IPC bridge
│       └── renderer/       # React UI (Home/, components/)
└── sidecar/                # Node.js backend (WebSocket server)
    └── src/
        ├── server.ts       # Session management, WS server
        ├── stt.ts          # Whisper transcription
        ├── deepl.ts        # DeepL translation
        └── dsp.ts          # Audio denoising and frame handling
```

## Tech Stack

| Layer       | Technology                              |
| ----------- | --------------------------------------- |
| Frontend    | Electron 40, React 19, TypeScript, Vite |
| Styling     | Tailwind CSS 4, Radix UI                |
| VAD         | @ricky0123/vad-web (Silero v5)          |
| STT         | HuggingFace Transformers 3 (Whisper)    |
| Translation | DeepL Node SDK                          |
| Transport   | WebSocket (ws)                          |

## Demo
