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

  sendAudio: (buffer: ArrayBuffer, channel: 0 | 1, isFinal = true, id = '') =>
    ipcRenderer.send('audio:chunk', buffer, channel, isFinal, id),

  onTranscript: (
    cb: (data: {
      channel: string
      id: string
      text: string
      final: boolean
    }) => void,
  ) => ipcRenderer.on('transcript', (_e, data) => cb(data)),

  onSttConfig: (cb: (config: Record<string, unknown>) => void) =>
    ipcRenderer.on('stt-config', (_e, config) => cb(config)),

  onDenoisedAudio: (
    cb: (data: { channel: string; id: string; buffer: ArrayBuffer }) => void,
  ) => ipcRenderer.on('denoised-audio', (_e, data) => cb(data)),

  onTranslation: (
    cb: (data: {
      channel: string
      id: string
      text: string
      final: boolean
    }) => void,
  ) => ipcRenderer.on('translation', (_e, data) => cb(data)),

  getDesktopCapturerSources: () =>
    ipcRenderer.invoke('desktop-capturer:getSources'),

  removeAllListeners: (channel: string) =>
    ipcRenderer.removeAllListeners(channel),
})
