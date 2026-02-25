interface ElectronAPI {
  startSession(config: { sourceLang: string; targetLang: string; engine: 'deepl' | 'openai' }): void
  stopSession(): void
  sendAudio(buffer: ArrayBuffer, channel: 0 | 1): void
  onTranscript(cb: (data: { channel: string; text: string; final: boolean }) => void): void
  onStatus(cb: (state: string) => void): void
  removeAllListeners(channel: string): void
}

declare global {
  interface Window {
    electron: ElectronAPI
  }
}

export {}
