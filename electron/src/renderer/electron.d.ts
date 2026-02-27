interface ElectronAPI {
  startSession(config: {
    sourceLang: string
    targetLang: string
    engine: 'deepl' | 'openai'
    sampleRate: number
    mode: 'transcript' | 'translate'
  }): void
  stopSession(): void
  setLang(lang: string): void
  setMode(mode: 'transcript' | 'translate'): void
  sendAudio(buffer: ArrayBuffer, channel: 0 | 1, isFinal?: boolean): void
  onTranscript(
    cb: (data: { channel: string; text: string; final: boolean }) => void,
  ): void
  onStatus(cb: (state: string) => void): void
  onSttConfig(cb: (config: Record<string, unknown>) => void): void
  onDenoisedAudio(cb: (buffer: ArrayBuffer) => void): void
  onTranslation(
    cb: (data: { channel: string; text: string; final: boolean }) => void,
  ): void
  removeAllListeners(channel: string): void
}

declare global {
  interface Window {
    electron: ElectronAPI
  }
}

export {}
