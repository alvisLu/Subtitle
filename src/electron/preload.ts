import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  startSession: (config: { sourceLang: string; targetLang: string; engine: 'deepl' | 'openai'; sampleRate: number }) =>
    ipcRenderer.send('session:start', config),

  stopSession: () =>
    ipcRenderer.send('session:stop'),

  sendAudio: (buffer: ArrayBuffer, channel: 0 | 1) =>
    ipcRenderer.send('audio:chunk', buffer, channel),

  onTranscript: (cb: (data: { channel: string; text: string; final: boolean }) => void) =>
    ipcRenderer.on('transcript', (_e, data) => cb(data)),

  onStatus: (cb: (state: string) => void) =>
    ipcRenderer.on('status', (_e, state) => cb(state)),

  removeAllListeners: (channel: string) =>
    ipcRenderer.removeAllListeners(channel),
})
