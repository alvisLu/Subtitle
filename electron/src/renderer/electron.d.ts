interface ElectronAPI {
  startSession(config: {
    sourceLang: string
    targetLang: string
    engine: 'deepl' | 'openai'
    sampleRate: number
    denoise?: boolean
  }): void
  stopSession(): void
  sendAudio(
    buffer: ArrayBuffer,
    channel: 0 | 1,
    isFinal?: boolean,
    id?: string,
  ): void
  onTranscript(
    cb: (data: {
      channel: string
      id: string
      text: string
      final: boolean
    }) => void,
  ): void
  onSttConfig(cb: (config: Record<string, unknown>) => void): void
  onDenoisedAudio(
    cb: (data: { channel: string; id: string; buffer: ArrayBuffer }) => void,
  ): void
  onTranslation(
    cb: (data: {
      channel: string
      id: string
      text: string
      final: boolean
    }) => void,
  ): void
  setAlwaysOnTop(flag: boolean): Promise<void>
  getDesktopCapturerSources(): Promise<{ id: string; name: string }[]>
  removeAllListeners(channel: string): void
}

declare global {
  interface Window {
    electron: ElectronAPI
  }
}

export {}
