import React, { useState, useRef, useCallback, useEffect } from 'react'
import { MicVAD } from '@ricky0123/vad-web'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MicOff, Monitor, MonitorOff, Play, Square, Mic, Trash2 } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MicSegmentList } from './MicSegmentList'
import type { MicSegment } from './MicSegmentList'

const SAMPLE_RATE = 16000
// Silero v5: 512 samples/frame @ 16kHz = 32ms; 16 frames = 512ms ≈ 0.5s
const STREAMING_FRAMES = 16

type SysRecording = {
  id: number
  audio: Float32Array
  duration: number
  timestamp: Date
}

type TextEntry = { id: number; text: string; translation?: string; timestamp: Date }

const LANGUAGES = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
  // { code: 'ja', label: '日本語' },
  // { code: 'ko', label: '한국어' },
  // { code: 'fr', label: 'Français' },
  // { code: 'de', label: 'Deutsch' },
]

type Mode = 'transcript' | 'translate'

function getOrCreateAudioCtx(audioCtxRef: { current: AudioContext | null }) {
  if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
    audioCtxRef.current = new AudioContext({ sampleRate: SAMPLE_RATE })
  }
  return audioCtxRef.current
}

function playAudio(
  audio: Float32Array,
  audioCtxRef: { current: AudioContext | null },
  nodeRef: { current: AudioBufferSourceNode | null },
  segId: number,
  setPlaying: React.Dispatch<React.SetStateAction<number | null>>,
  stopFn: () => void,
) {
  stopFn()
  const ctx = getOrCreateAudioCtx(audioCtxRef)
  const buffer = ctx.createBuffer(1, audio.length, SAMPLE_RATE)
  buffer.copyToChannel(audio as Float32Array<ArrayBuffer>, 0)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)
  source.onended = () => {
    setPlaying(null)
    nodeRef.current = null
  }
  source.start()
  nodeRef.current = source
  setPlaying(segId)
}

export default function App() {
  const [recording, setRecording] = useState(false)
  const [volume, setVolume] = useState(0)

  // Mic: unified segments (transcript + denoised + raw recording per utterance)
  const [micSegments, setMicSegments] = useState<MicSegment[]>([])
  const [micTranscriptInterim, setMicTranscriptInterim] = useState('')
  const [micTranslationInterim, setMicTranslationInterim] = useState('')
  const [playingMicSegId, setPlayingMicSegId] = useState<number | null>(null)
  const [playingDenoisedSegId, setPlayingDenoisedSegId] = useState<number | null>(null)

  // System audio
  const [sysSegments, sysMicSegments] = useState<MicSegment[]>([])
  const [sysTranscripts, setSysTranscripts] = useState<TextEntry[]>([])
  const [sysTranscriptInterim, setSysTranscriptInterim] = useState('')
  const [sysTranslationInterim, setSysTranslationInterim] = useState('')
  const [sysRecordings, setSysRecordings] = useState<SysRecording[]>([])
  const [playingSysId, setPlayingSysId] = useState<number | null>(null)

  const [mode, setMode] = useState<Mode>('transcript')
  const [sourceLang, setSourceLang] = useState('zh')
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('')
  const [systemCapture, setSystemCapture] = useState(false)
  const [sysVolume, setSysVolume] = useState(0)

  // Mic VAD
  const vadRef = useRef<MicVAD | null>(null)
  const streamingFramesRef = useRef<Float32Array[]>([])
  const isSpeakingRef = useRef(false)

  // Mic segment counters (FIFO correlation with sidecar responses)
  const nextMicSegIdRef = useRef(0)
  const nextDenoisedSegIdRef = useRef(0)
  const nextTranscriptSegIdRef = useRef(0)
  const nextTranslationSegIdRef = useRef(0)

  // System VAD
  const sysVadRef = useRef<MicVAD | null>(null)
  const sysStreamRef = useRef<MediaStream | null>(null)
  const sysStreamingFramesRef = useRef<Float32Array[]>([])
  const isSysSpeakingRef = useRef(false)
  const nextSysIdRef = useRef(0)
  const nextSysTranscriptIdRef = useRef(0)

  // Audio playback
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null)
  const denoisedSourceNodeRef = useRef<AudioBufferSourceNode | null>(null)
  const sysSourceNodeRef = useRef<AudioBufferSourceNode | null>(null)
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
      navigator.mediaDevices.removeEventListener('devicechange', refreshAudioDevices)
    }
  }, [])

  useEffect(() => {
    if (!window.electron) return
    window.electron.onTranscript(({ channel, text, final }) => {
      if (channel === 'loopback') {
        if (final) {
          setSysTranscripts(prev => [{ id: nextSysTranscriptIdRef.current++, text, timestamp: new Date() }, ...prev])
          setSysTranscriptInterim('')
        } else {
          setSysTranscriptInterim(text)
        }
      } else {
        if (final) {
          const segId = nextTranscriptSegIdRef.current++
          setMicSegments(prev => prev.map(s =>
            s.id === segId ? { ...s, text, timestamp: new Date() } : s
          ))
          setMicTranscriptInterim('')
        } else {
          setMicTranscriptInterim(text)
        }
      }
    })
    window.electron.onTranslation(({ channel, text, final }) => {
      if (channel === 'loopback') {
        if (final) {
          setSysTranscripts(prev => prev.length === 0 ? prev : [{ ...prev[0], translation: text }, ...prev.slice(1)])
          setSysTranslationInterim('')
        } else {
          setSysTranslationInterim(text)
        }
      } else {
        if (final) {
          const segId = nextTranslationSegIdRef.current++
          setMicSegments(prev => prev.map(s =>
            s.id === segId ? { ...s, translation: text } : s
          ))
          setMicTranslationInterim('')
        } else {
          setMicTranslationInterim(text)
        }
      }
    })
    window.electron.onSttConfig((config) => {
      console.log('[STT] STT_BASE_CONFIG', config)
    })
    window.electron.onDenoisedAudio((buffer) => {
      const audio = new Float32Array(buffer)
      const segId = nextDenoisedSegIdRef.current++
      setMicSegments(prev => prev.map(s =>
        s.id === segId
          ? { ...s, denoisedAudio: { audio, duration: audio.length / SAMPLE_RATE } }
          : s
      ))
    })
    return () => {
      window.electron.removeAllListeners('transcript')
      window.electron.removeAllListeners('translation')
      window.electron.removeAllListeners('stt-config')
      window.electron.removeAllListeners('denoised-audio')
    }
  }, [])

  const stopMicPlayback = useCallback(() => {
    sourceNodeRef.current?.stop()
    sourceNodeRef.current = null
    setPlayingMicSegId(null)
  }, [])

  const stopDenoisedPlayback = useCallback(() => {
    denoisedSourceNodeRef.current?.stop()
    denoisedSourceNodeRef.current = null
    setPlayingDenoisedSegId(null)
  }, [])

  const stopSysPlayback = useCallback(() => {
    sysSourceNodeRef.current?.stop()
    sysSourceNodeRef.current = null
    setPlayingSysId(null)
  }, [])

  const playMicAudio = useCallback((segId: number, audio: Float32Array) => {
    playAudio(audio, audioCtxRef, sourceNodeRef, segId, setPlayingMicSegId, stopMicPlayback)
  }, [stopMicPlayback])

  const playDenoisedAudio = useCallback((segId: number, audio: Float32Array) => {
    playAudio(audio, audioCtxRef, denoisedSourceNodeRef, segId, setPlayingDenoisedSegId, stopDenoisedPlayback)
  }, [stopDenoisedPlayback])

  const playSysRecording = useCallback((rec: SysRecording) => {
    playAudio(rec.audio, audioCtxRef, sysSourceNodeRef, rec.id, setPlayingSysId, stopSysPlayback)
  }, [stopSysPlayback])

  function mergeFrames(frames: Float32Array[]): Float32Array {
    const total = frames.reduce((s, f) => s + f.length, 0)
    const out = new Float32Array(total)
    let offset = 0
    for (const f of frames) { out.set(f, offset); offset += f.length }
    return out
  }

  const startMicAudio = useCallback(async () => {
    const myvad = await MicVAD.new({
      baseAssetPath: '/',
      onnxWASMBasePath: '/',
      model: 'v5',
      getStream: () =>
        navigator.mediaDevices.getUserMedia({
          audio: selectedDeviceId
            ? { deviceId: { exact: selectedDeviceId } }
            : true,
        }),
      onSpeechStart: () => {
        isSpeakingRef.current = true
        streamingFramesRef.current = []
        setVolume(1)
      },
      onSpeechEnd: (audio: Float32Array) => {
        isSpeakingRef.current = false
        if (streamingFramesRef.current.length > 0) {
          const merged = mergeFrames(streamingFramesRef.current)
          streamingFramesRef.current = []
          window.electron?.sendAudio(merged.buffer as ArrayBuffer, 0, false)
        }
        window.electron?.sendAudio(audio.buffer as ArrayBuffer, 0, true)
        setVolume(0)
        const segId = nextMicSegIdRef.current++
        setMicSegments(prev => [{
          id: segId,
          timestamp: new Date(),
          micAudio: { audio: audio.slice(), duration: audio.length / SAMPLE_RATE },
        }, ...prev])
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
        if (streamingFramesRef.current.length >= STREAMING_FRAMES) {
          const chunks = streamingFramesRef.current.splice(0, STREAMING_FRAMES)
          window.electron?.sendAudio(mergeFrames(chunks).buffer as ArrayBuffer, 0, false)
        }
      },
    })

    await myvad.start()
    vadRef.current = myvad
    setRecording(true)

    window.electron?.startSession({
      sourceLang,
      targetLang: 'en',
      engine: 'deepl',
      sampleRate: 16000,
      mode,
    })
  }, [sourceLang, mode, selectedDeviceId])

  const stopMicAudio = useCallback(async () => {
    await vadRef.current?.destroy()
    vadRef.current = null
    setRecording(false)
    setVolume(0)
    window.electron?.stopSession()
    // Reset counters so next session's responses correlate correctly
    nextMicSegIdRef.current = 0
    nextDenoisedSegIdRef.current = 0
    nextTranscriptSegIdRef.current = 0
    nextTranslationSegIdRef.current = 0
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
        const id = nextSysIdRef.current++
        setSysRecordings((prev) => [
          { id, audio: audio.slice(), duration: audio.length / SAMPLE_RATE, timestamp: new Date() },
          ...prev,
        ])
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
        if (sysStreamingFramesRef.current.length >= STREAMING_FRAMES) {
          const chunks = sysStreamingFramesRef.current.splice(0, STREAMING_FRAMES)
          window.electron?.sendAudio(mergeFrames(chunks).buffer as ArrayBuffer, 1, false)
        }
      },
    })

    await sysVad.start()
    sysVadRef.current = sysVad
    setSystemCapture(true)

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
                className={`flex-1 py-1.5 text-sm font-medium transition-colors ${mode === m
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

          {/* Mic volume bar */}
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
            onClick={recording ? stopMicAudio : startMicAudio}
          >
            {recording ? (
              <><MicOff className="mr-2 h-4 w-4" /> Stop Mic</>
            ) : (
              <><Mic className="mr-2 h-4 w-4" /> Start Mic</>
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
              <><MonitorOff className="mr-2 h-4 w-4" /> Stop System Audio</>
            ) : (
              <><Monitor className="mr-2 h-4 w-4" /> Start System Audio</>
            )}
          </Button>

          {/* Mic segments: transcript + audio clips per utterance */}
          <MicSegmentList
            segments={micSegments}
            interim={micTranscriptInterim}
            translationInterim={micTranslationInterim}
            mode={mode}
            playingMicSegId={playingMicSegId}
            playingDenoisedSegId={playingDenoisedSegId}
            onClear={() => {
              stopMicPlayback()
              stopDenoisedPlayback()
              setMicSegments([])
              setMicTranscriptInterim('')
              setMicTranslationInterim('')
            }}
            onPlayMic={playMicAudio}
            onStopMic={stopMicPlayback}
            onPlayDenoised={playDenoisedAudio}
            onStopDenoised={stopDenoisedPlayback}
          />

          {/* System transcript list */}
          {(sysTranscripts.length > 0 || sysTranscriptInterim) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Monitor className="h-3 w-3" /> 系統音訊 ({sysTranscripts.length})
                </span>
                <Button variant="ghost" size="icon" className="h-6 w-6"
                  onClick={() => { setSysTranscripts([]); setSysTranscriptInterim(''); setSysTranslationInterim('') }}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {(sysTranscriptInterim || sysTranslationInterim) && (
                  <div className="rounded-md bg-blue-50 dark:bg-blue-950 p-3 text-sm break-words italic opacity-60">
                    <div>{sysTranscriptInterim}<span className="animate-pulse"> ···</span></div>
                    {mode === 'translate' && sysTranslationInterim && (
                      <div className="mt-1 pt-1 border-t border-border/40">{sysTranslationInterim}<span className="animate-pulse"> ···</span></div>
                    )}
                  </div>
                )}
                {sysTranscripts.map(entry => (
                  <div key={entry.id} className="rounded-md bg-blue-50 dark:bg-blue-950 p-3 text-sm break-words text-muted-foreground">
                    <div className="text-xs opacity-50 mb-1">{entry.timestamp.toLocaleTimeString()}</div>
                    <div>{entry.text}</div>
                    {mode === 'translate' && entry.translation && (
                      <div className="mt-1 pt-1 border-t border-border/40">{entry.translation}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* System audio recordings */}
          {sysRecordings.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  System Audio ({sysRecordings.length})
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => { stopSysPlayback(); setSysRecordings([]) }}
                  title="Clear all"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {sysRecordings.map((rec) => (
                  <div
                    key={rec.id}
                    className="flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs"
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={() =>
                        playingSysId === rec.id
                          ? stopSysPlayback()
                          : playSysRecording(rec)
                      }
                    >
                      {playingSysId === rec.id ? (
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
