import React, { useState, useRef, useCallback, useEffect } from 'react'
import { MicVAD } from '@ricky0123/vad-web'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Mic, MicOff, Monitor, MonitorOff, Play, Square, Trash2 } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const SAMPLE_RATE = 16000

type Recording = {
  id: number
  audio: Float32Array<ArrayBuffer>
  duration: number
  timestamp: Date
}

const LANGUAGES = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
  // { code: 'ja', label: '日本語' },
  // { code: 'ko', label: '한국어' },
  // { code: 'fr', label: 'Français' },
  // { code: 'de', label: 'Deutsch' },
]

type Mode = 'transcript' | 'translate'

export default function App() {
  const [recording, setRecording] = useState(false)
  const [volume, setVolume] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [transcriptInterim, setTranscriptInterim] = useState(false)
  const [translation, setTranslation] = useState('')
  const [translationInterim, setTranslationInterim] = useState(false)
  const [mode, setMode] = useState<Mode>('transcript')
  const [sourceLang, setSourceLang] = useState('zh')
  const [recordings, setRecordings] = useState<Recording[]>([])
  const [playingId, setPlayingId] = useState<number | null>(null)
  const [denoisedRecordings, setDenoisedRecordings] = useState<Recording[]>([])
  const [playingDenoisedId, setPlayingDenoisedId] = useState<number | null>(
    null,
  )
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('')
  const [systemCapture, setSystemCapture] = useState(false)
  const [sysVolume, setSysVolume] = useState(0)

  const vadRef = useRef<MicVAD | null>(null)
  const streamingFramesRef = useRef<Float32Array[]>([])
  const isSpeakingRef = useRef(false)
  const sysVadRef = useRef<MicVAD | null>(null)
  const sysStreamRef = useRef<MediaStream | null>(null)
  const sysStreamingFramesRef = useRef<Float32Array[]>([])
  const isSysSpeakingRef = useRef(false)
  const nextIdRef = useRef(0)
  const nextDenoisedIdRef = useRef(0)
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null)
  const denoisedSourceNodeRef = useRef<AudioBufferSourceNode | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    let cancelled = false

    async function refreshAudioDevices() {
      const all = await navigator.mediaDevices.enumerateDevices()
      if (cancelled) return
      const inputs = all.filter((d) => d.kind === 'audioinput')
      setAudioDevices(inputs)
      setSelectedDeviceId((prev) => {
        if (prev && inputs.some((d) => d.deviceId === prev)) return prev
        return inputs[0]?.deviceId ?? ''
      })
    }

    refreshAudioDevices()
    navigator.mediaDevices.addEventListener('devicechange', refreshAudioDevices)
    return () => {
      cancelled = true
      navigator.mediaDevices.removeEventListener(
        'devicechange',
        refreshAudioDevices,
      )
    }
  }, [])

  useEffect(() => {
    if (!window.electron) return
    window.electron.onTranscript(({ text, final }) => {
      setTranscript(text)
      setTranscriptInterim(!final)
    })
    window.electron.onTranslation(({ text, final }) => {
      setTranslation(text)
      setTranslationInterim(!final)
    })
    window.electron.onSttConfig((config) => {
      console.log('[STT] STT_BASE_CONFIG', config)
    })
    window.electron.onDenoisedAudio((buffer) => {
      const audio = new Float32Array(buffer)
      const id = nextDenoisedIdRef.current++
      setDenoisedRecordings((prev) => [
        {
          id,
          audio,
          duration: audio.length / SAMPLE_RATE,
          timestamp: new Date(),
        },
        ...prev,
      ])
    })
    return () => {
      window.electron.removeAllListeners('transcript')
      window.electron.removeAllListeners('translation')
      window.electron.removeAllListeners('stt-config')
      window.electron.removeAllListeners('denoised-audio')
    }
  }, [])

  const stopPlayback = useCallback(() => {
    sourceNodeRef.current?.stop()
    sourceNodeRef.current = null
    setPlayingId(null)
  }, [])

  const stopDenoisedPlayback = useCallback(() => {
    denoisedSourceNodeRef.current?.stop()
    denoisedSourceNodeRef.current = null
    setPlayingDenoisedId(null)
  }, [])

  const playDenoisedRecording = useCallback(
    (rec: Recording) => {
      stopDenoisedPlayback()
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioContext({ sampleRate: SAMPLE_RATE })
      }
      const ctx = audioCtxRef.current
      const buffer = ctx.createBuffer(1, rec.audio.length, SAMPLE_RATE)
      buffer.copyToChannel(rec.audio, 0)
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(ctx.destination)
      source.onended = () => {
        setPlayingDenoisedId((id) => (id === rec.id ? null : id))
        denoisedSourceNodeRef.current = null
      }
      source.start()
      denoisedSourceNodeRef.current = source
      setPlayingDenoisedId(rec.id)
    },
    [stopDenoisedPlayback],
  )

  const playRecording = useCallback(
    (rec: Recording) => {
      stopPlayback()
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioContext({ sampleRate: SAMPLE_RATE })
      }
      const ctx = audioCtxRef.current
      const buffer = ctx.createBuffer(1, rec.audio.length, SAMPLE_RATE)
      buffer.copyToChannel(rec.audio, 0)
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(ctx.destination)
      source.onended = () => {
        setPlayingId((id) => (id === rec.id ? null : id))
        sourceNodeRef.current = null
      }
      source.start()
      sourceNodeRef.current = source
      setPlayingId(rec.id)
    },
    [stopPlayback],
  )

  function mergeFrames(frames: Float32Array[]): Float32Array {
    const total = frames.reduce((s, f) => s + f.length, 0)
    const out = new Float32Array(total)
    let offset = 0
    for (const f of frames) { out.set(f, offset); offset += f.length }
    return out
  }

  const start = useCallback(async () => {
    const myvad = await MicVAD.new({
      // Static assets served from renderer publicDir (src/renderer/public/)
      baseAssetPath: '/',
      onnxWASMBasePath: '/',
      model: 'v5',
      getStream: () =>
        navigator.mediaDevices.getUserMedia({
          audio: selectedDeviceId
            ? { deviceId: { exact: selectedDeviceId } }
            : true,
        }),
      // Silero v5: 512 samples/frame @ 16kHz = 32ms; 16 frames ≈ 0.5s
      onSpeechStart: () => {
        isSpeakingRef.current = true
        streamingFramesRef.current = []
        setVolume(1)
      },
      onSpeechEnd: (audio: Float32Array) => {
        isSpeakingRef.current = false
        // Send any remaining buffered frames as a last interim chunk
        if (streamingFramesRef.current.length > 0) {
          const merged = mergeFrames(streamingFramesRef.current)
          streamingFramesRef.current = []
          window.electron?.sendAudio(merged.buffer as ArrayBuffer, 0, false)
        }
        // Send the complete VAD segment as the final authoritative chunk
        window.electron?.sendAudio(audio.buffer as ArrayBuffer, 0, true)
        setVolume(0)
        // save for playback
        const id = nextIdRef.current++
        setRecordings((prev) => [
          {
            id,
            audio: audio.slice(),
            duration: audio.length / SAMPLE_RATE,
            timestamp: new Date(),
          },
          ...prev,
        ])
      },
      onVADMisfire: () => {
        isSpeakingRef.current = false
        streamingFramesRef.current = []
        setVolume(0)
      },
      onFrameProcessed: (prob, frame) => {
        if (!vadRef.current?.listening) return
        setVolume(prob.isSpeech)
        if (!isSpeakingRef.current) return
        streamingFramesRef.current.push(new Float32Array(frame))
        if (streamingFramesRef.current.length >= 16) {
          const chunks = streamingFramesRef.current.splice(0, 16)
          window.electron?.sendAudio(mergeFrames(chunks).buffer as ArrayBuffer, 0, false)
        }
      },
    })

    await myvad.start()
    vadRef.current = myvad
    setRecording(true)

    // MicVAD outputs 16kHz — inform sidecar
    window.electron?.startSession({
      sourceLang,
      targetLang: 'en',
      engine: 'deepl',
      sampleRate: 16000,
      mode,
    })
  }, [sourceLang, mode, selectedDeviceId])

  const stop = useCallback(async () => {
    await vadRef.current?.destroy()
    vadRef.current = null
    setRecording(false)
    setVolume(0)
    window.electron?.stopSession()
  }, [])

  const startSysAudio = useCallback(async () => {
    const sources = await window.electron.getDesktopCapturerSources()
    const screen = sources[0]
    if (!screen) return

    const sysVad = await MicVAD.new({
      baseAssetPath: '/',
      onnxWASMBasePath: '/',
      model: 'v5',
      getStream: async () => {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: screen.id },
          } as unknown as MediaTrackConstraints,
          video: {
            mandatory: { chromeMediaSource: 'desktop' },
          } as unknown as MediaTrackConstraints,
        })
        // Stop video tracks — only audio is needed
        stream.getVideoTracks().forEach((t) => t.stop())
        sysStreamRef.current = stream
        return stream
      },
      onSpeechStart: () => {
        isSysSpeakingRef.current = true
        sysStreamingFramesRef.current = []
        setSysVolume(1)
      },
      onSpeechEnd: (audio: Float32Array) => {
        isSysSpeakingRef.current = false
        if (sysStreamingFramesRef.current.length > 0) {
          const merged = mergeFrames(sysStreamingFramesRef.current)
          sysStreamingFramesRef.current = []
          window.electron?.sendAudio(merged.buffer as ArrayBuffer, 1, false)
        }
        window.electron?.sendAudio(audio.buffer as ArrayBuffer, 1, true)
        setSysVolume(0)
      },
      onVADMisfire: () => {
        isSysSpeakingRef.current = false
        sysStreamingFramesRef.current = []
        setSysVolume(0)
      },
      onFrameProcessed: (prob, frame) => {
        if (!sysVadRef.current?.listening) return
        setSysVolume(prob.isSpeech)
        if (!isSysSpeakingRef.current) return
        sysStreamingFramesRef.current.push(new Float32Array(frame))
        if (sysStreamingFramesRef.current.length >= 16) {
          const chunks = sysStreamingFramesRef.current.splice(0, 16)
          window.electron?.sendAudio(mergeFrames(chunks).buffer as ArrayBuffer, 1, false)
        }
      },
    })

    await sysVad.start()
    sysVadRef.current = sysVad
    setSystemCapture(true)

    // Ensure sidecar session is running
    window.electron?.startSession({
      sourceLang,
      targetLang: 'en',
      engine: 'deepl',
      sampleRate: 16000,
      mode,
    })
  }, [sourceLang, mode])

  const stopSysAudio = useCallback(async () => {
    await sysVadRef.current?.destroy()
    sysVadRef.current = null
    sysStreamRef.current?.getTracks().forEach((t) => t.stop())
    sysStreamRef.current = null
    sysStreamingFramesRef.current = []
    isSysSpeakingRef.current = false
    setSystemCapture(false)
    setSysVolume(0)
  }, [])

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-8">
      <Card className="w-80">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">TranBot — Mic Test</CardTitle>
            <Badge variant={recording ? 'default' : 'secondary'}>
              {recording ? 'Recording' : 'Idle'}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            VAD: Silero v5 @ 16kHz
          </p>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Mode selector */}
          <div className="flex rounded-md overflow-hidden border border-border">
            {(['transcript', 'translate'] as Mode[]).map((m) => (
              <button
                key={m}
                className={`flex-1 py-1.5 text-sm font-medium transition-colors ${
                  mode === m
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:bg-muted'
                }`}
                disabled={recording}
                onClick={() => {
                  setMode(m)
                  if (recording) window.electron?.setMode(m)
                }}
              >
                {m === 'transcript' ? 'Transcript' : 'Translation'}
              </button>
            ))}
          </div>

          {/* Language selector */}
          <Select
            value={sourceLang}
            onValueChange={(val) => {
              setSourceLang(val)
              if (recording) window.electron?.setLang(val)
            }}
            disabled={recording}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((lang) => (
                <SelectItem key={lang.code} value={lang.code}>
                  {lang.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Device selector */}
          <Select
            value={selectedDeviceId}
            onValueChange={setSelectedDeviceId}
            disabled={recording}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select microphone" />
            </SelectTrigger>
            <SelectContent>
              {audioDevices.map((device) => (
                <SelectItem key={device.deviceId} value={device.deviceId}>
                  {device.label || `Microphone ${device.deviceId.slice(0, 8)}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Volume bar */}
          <div className="h-3 w-full rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-75"
              style={{
                width: `${volume * 100}%`,
                backgroundColor: recording
                  ? 'var(--color-primary)'
                  : 'var(--color-muted-foreground)',
              }}
            />
          </div>

          <Button
            className="w-full"
            variant={recording ? 'destructive' : 'default'}
            onClick={recording ? stop : start}
          >
            {recording ? (
              <>
                <MicOff className="mr-2 h-4 w-4" /> Stop Mic
              </>
            ) : (
              <>
                <Mic className="mr-2 h-4 w-4" /> Start Mic
              </>
            )}
          </Button>

          {/* System audio volume bar */}
          {systemCapture && (
            <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full rounded-full transition-[width] duration-75 bg-blue-500"
                style={{ width: `${sysVolume * 100}%` }}
              />
            </div>
          )}

          <Button
            className="w-full"
            variant={systemCapture ? 'destructive' : 'outline'}
            onClick={systemCapture ? stopSysAudio : startSysAudio}
          >
            {systemCapture ? (
              <>
                <MonitorOff className="mr-2 h-4 w-4" /> Stop System Audio
              </>
            ) : (
              <>
                <Monitor className="mr-2 h-4 w-4" /> Start System Audio
              </>
            )}
          </Button>

          {mode === 'transcript' && transcript && (
            <div className={`rounded-md bg-muted p-3 text-sm break-words transition-opacity ${transcriptInterim ? 'italic opacity-60' : 'text-muted-foreground'}`}>
              {transcript}
              {transcriptInterim && <span className="animate-pulse"> ···</span>}
            </div>
          )}

          {mode === 'translate' && transcript && (
            <div className={`rounded-md bg-muted p-3 text-sm break-words transition-opacity ${transcriptInterim ? 'italic opacity-60' : 'text-muted-foreground'}`}>
              <div className="text-xs font-medium text-foreground mb-1">
                原文
              </div>
              {transcript}
              {transcriptInterim && <span className="animate-pulse"> ···</span>}
            </div>
          )}

          {mode === 'translate' && translation && (
            <div className={`rounded-md bg-muted p-3 text-sm break-words transition-opacity ${translationInterim ? 'italic opacity-60' : 'text-muted-foreground'}`}>
              <div className="text-xs font-medium text-foreground mb-1">
                翻譯
              </div>
              {translation}
              {translationInterim && <span className="animate-pulse"> ···</span>}
            </div>
          )}

          {/* Denoised segments returned from sidecar */}
          {denoisedRecordings.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  Denoised ({denoisedRecordings.length})
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => {
                    stopDenoisedPlayback()
                    setDenoisedRecordings([])
                  }}
                  title="Clear all"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {denoisedRecordings.map((rec) => (
                  <div
                    key={rec.id}
                    className="flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs"
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={() =>
                        playingDenoisedId === rec.id
                          ? stopDenoisedPlayback()
                          : playDenoisedRecording(rec)
                      }
                    >
                      {playingDenoisedId === rec.id ? (
                        <Square className="h-3 w-3" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                    </Button>
                    <span className="flex-1 text-muted-foreground">
                      {rec.timestamp.toLocaleTimeString()}
                    </span>
                    <span className="text-muted-foreground">
                      {rec.duration.toFixed(1)}s
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {recordings.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  Raw Recordings ({recordings.length})
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => {
                    stopPlayback()
                    setRecordings([])
                  }}
                  title="Clear all"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {recordings.map((rec) => (
                  <div
                    key={rec.id}
                    className="flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs"
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={() =>
                        playingId === rec.id
                          ? stopPlayback()
                          : playRecording(rec)
                      }
                    >
                      {playingId === rec.id ? (
                        <Square className="h-3 w-3" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                    </Button>
                    <span className="flex-1 text-muted-foreground">
                      {rec.timestamp.toLocaleTimeString()}
                    </span>
                    <span className="text-muted-foreground">
                      {rec.duration.toFixed(1)}s
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
