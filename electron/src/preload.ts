import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  startSession: (config: {
    sourceLang: string
    targetLang: string
    engine: 'deepl' | 'openai'
    sampleRate: number
    mode: 'transcript' | 'translate'
  }) => ipcRenderer.send('session:start', config),

  stopSession: () => ipcRenderer.send('session:stop'),

  setLang: (lang: string) => ipcRenderer.send('session:setLang', lang),

  setMode: (mode: 'transcript' | 'translate') =>
    ipcRenderer.send('session:setMode', mode),

  sendAudio: (buffer: ArrayBuffer, channel: 0 | 1, isFinal = true) =>
    ipcRenderer.send('audio:chunk', buffer, channel, isFinal),

  onTranscript: (
    cb: (data: { channel: string; text: string; final: boolean }) => void,
  ) => ipcRenderer.on('transcript', (_e, data) => cb(data)),

  onStatus: (cb: (state: string) => void) =>
    ipcRenderer.on('status', (_e, state) => cb(state)),

  onSttConfig: (cb: (config: Record<string, unknown>) => void) =>
    ipcRenderer.on('stt-config', (_e, config) => cb(config)),

  onDenoisedAudio: (cb: (data: { channel: string; buffer: ArrayBuffer }) => void) =>
    ipcRenderer.on('denoised-audio', (_e, data) => cb(data)),

  onTranslation: (
    cb: (data: { channel: string; text: string; final: boolean }) => void,
  ) => ipcRenderer.on('translation', (_e, data) => cb(data)),

  getDesktopCapturerSources: () =>
    ipcRenderer.invoke('desktop-capturer:getSources'),

  removeAllListeners: (channel: string) =>
    ipcRenderer.removeAllListeners(channel),
})
