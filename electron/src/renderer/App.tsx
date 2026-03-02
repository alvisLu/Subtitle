import React, { useState, useRef, useCallback, useEffect } from 'react'
import { nanoid } from 'nanoid'
import { MicVAD } from '@ricky0123/vad-web'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { MicOff, Monitor, Mic, Clock } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SegmentList } from './SegmentList'
import type { Segment } from './SegmentList'
import { Progress } from './components/ui/progress'
import { Separator } from './components/ui/separator'

const SAMPLE_RATE = 16000
// Silero v5: 512 samples/frame @ 16kHz = 32ms; 16 frames = 512ms ≈ 0.5s
const STREAMING_FRAMES = 16

type Mode = 'transcript' | 'translate'
type TargetLang = 'en-US' | 'zh-HANT'
type SourceLang = 'en' | 'zh'

const SOURCE_LANGUAGES: { code: SourceLang; label: string }[] = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
]
const TARGET_LANGUAGES: { code: TargetLang; label: string }[] = [
  { code: 'zh-HANT', label: '中文' },
  { code: 'en-US', label: 'English' },
]

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
  segId: string,
  setPlaying: React.Dispatch<React.SetStateAction<string | null>>,
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
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Mic: unified segments (transcript + denoised + raw recording per utterance)
  const [micSegments, setMicSegments] = useState<Segment[]>([])
  const [micInterimSegment, setMicInterimSegment] = useState<Segment | null>(null)
  const [playingRawSegId, setPlayingRawSegId] = useState<string | null>(null)
  const [playingDenoisedSegId, setPlayingDenoisedSegId] = useState<
    string | null
  >(null)

  // System audio
  const [sysSegments, setSysSegments] = useState<Segment[]>([])
  const [sysInterimSegment, setSysInterimSegment] = useState<Segment | null>(null)

  const [mode, setMode] = useState<Mode>('translate')
  const [sourceLang, setSourceLang] = useState<SourceLang>('en')
  const [targetLang, setTargetLang] = useState<TargetLang>('zh-HANT')
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('')
  const [systemCapture, setSystemCapture] = useState(false)
  const [sysVolume, setSysVolume] = useState(0)

  // Mic VAD
  const vadRef = useRef<MicVAD | null>(null)
  const streamingFramesRef = useRef<Float32Array[]>([])
  const isSpeakingRef = useRef(false)

  // Per-channel current segment ID (nanoid)
  const currentMicSegIdRef = useRef('')
  const currentSysSegIdRef = useRef('')

  // System VAD
  const sysVadRef = useRef<MicVAD | null>(null)
  const sysStreamRef = useRef<MediaStream | null>(null)
  const sysStreamingFramesRef = useRef<Float32Array[]>([])
  const isSysSpeakingRef = useRef(false)

  // Audio playback
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null)
  const denoisedSourceNodeRef = useRef<AudioBufferSourceNode | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    console.log(sysSegments)
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
    window.electron.onTranscript(({ channel, id, text, final }) => {
      if (channel === 'loopback') {
        if (final) {
          setSysSegments((prev) =>
            prev.map((s) =>
              s.id === id ? { ...s, text, timestamp: new Date() } : s,
            ),
          )
          setSysInterimSegment(null)
        } else {
          setSysInterimSegment((prev) => (prev ? { ...prev, text } : null))
        }
      } else {
        if (final) {
          setMicSegments((prev) =>
            prev.map((s) =>
              s.id === id ? { ...s, text, timestamp: new Date() } : s,
            ),
          )
          setMicInterimSegment(null)
        } else {
          setMicInterimSegment((prev) => (prev ? { ...prev, text } : null))
        }
      }
    })
    window.electron.onTranslation(({ channel, id, text, final }) => {
      if (channel === 'loopback') {
        if (final) {
          setSysSegments((prev) =>
            prev.map((s) => (s.id === id ? { ...s, translation: text } : s)),
          )
        } else {
          setSysInterimSegment((prev) => (prev ? { ...prev, translation: text } : null))
        }
      } else {
        if (final) {
          setMicSegments((prev) =>
            prev.map((s) => (s.id === id ? { ...s, translation: text } : s)),
          )
        } else {
          setMicInterimSegment((prev) => (prev ? { ...prev, translation: text } : null))
        }
      }
    })
    window.electron.onSttConfig((config) => {
      console.log('[STT] STT_BASE_CONFIG', config)
    })
    window.electron.onDenoisedAudio(({ channel, id, buffer }) => {
      const audio = new Float32Array(buffer)
      if (channel === 'loopback') {
        setSysSegments((prev) =>
          prev.map((s) =>
            s.id === id
              ? {
                  ...s,
                  denoisedAudio: {
                    audio,
                    duration: audio.length / SAMPLE_RATE,
                  },
                }
              : s,
          ),
        )
      } else {
        setMicSegments((prev) =>
          prev.map((s) =>
            s.id === id
              ? {
                  ...s,
                  denoisedAudio: {
                    audio,
                    duration: audio.length / SAMPLE_RATE,
                  },
                }
              : s,
          ),
        )
      }
    })
    return () => {
      window.electron.removeAllListeners('transcript')
      window.electron.removeAllListeners('translation')
      window.electron.removeAllListeners('stt-config')
      window.electron.removeAllListeners('denoised-audio')
    }
  }, [])

  const stopRawPlayback = useCallback(() => {
    sourceNodeRef.current?.stop()
    sourceNodeRef.current = null
    setPlayingRawSegId(null)
  }, [])

  const stopDenoisedPlayback = useCallback(() => {
    denoisedSourceNodeRef.current?.stop()
    denoisedSourceNodeRef.current = null
    setPlayingDenoisedSegId(null)
  }, [])

  const playRawAudio = useCallback(
    (segId: string, audio: Float32Array) => {
      playAudio(
        audio,
        audioCtxRef,
        sourceNodeRef,
        segId,
        setPlayingRawSegId,
        stopRawPlayback,
      )
    },
    [stopRawPlayback],
  )

  const playDenoisedAudio = useCallback(
    (segId: string, audio: Float32Array) => {
      playAudio(
        audio,
        audioCtxRef,
        denoisedSourceNodeRef,
        segId,
        setPlayingDenoisedSegId,
        stopDenoisedPlayback,
      )
    },
    [stopDenoisedPlayback],
  )

  function mergeFrames(frames: Float32Array[]): Float32Array {
    const total = frames.reduce((s, f) => s + f.length, 0)
    const out = new Float32Array(total)
    let offset = 0
    for (const f of frames) {
      out.set(f, offset)
      offset += f.length
    }
    return out
  }

  const startMicAudio = useCallback(async () => {
    const myvad = await MicVAD.new({
      baseAssetPath: '/',
      onnxWASMBasePath: '/',
      model: 'v5',
      redemptionMs: 400,
      // negativeSpeechThreshold: 0.15,
      getStream: () =>
        navigator.mediaDevices.getUserMedia({
          audio: selectedDeviceId
            ? { deviceId: { exact: selectedDeviceId } }
            : true,
        }),
      onSpeechStart: () => {
        isSpeakingRef.current = true
        streamingFramesRef.current = []
        currentMicSegIdRef.current = nanoid()
        setMicInterimSegment({ id: currentMicSegIdRef.current, channel: 'mic', timestamp: new Date(), text: '' })
        setVolume(1)
      },
      onSpeechEnd: (audio: Float32Array) => {
        isSpeakingRef.current = false
        const segId = currentMicSegIdRef.current
        if (streamingFramesRef.current.length > 0) {
          const merged = mergeFrames(streamingFramesRef.current)
          streamingFramesRef.current = []
          window.electron?.sendAudio(
            merged.buffer as ArrayBuffer,
            0,
            false,
            segId,
          )
        }
        window.electron?.sendAudio(audio.buffer as ArrayBuffer, 0, true, segId)
        setVolume(0)
        setMicSegments((prev) => [
          {
            id: segId,
            channel: 'mic',
            timestamp: new Date(),
            text: '',
            micAudio: {
              audio: audio.slice(),
              duration: audio.length / SAMPLE_RATE,
            },
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
        if (streamingFramesRef.current.length >= STREAMING_FRAMES) {
          const chunks = streamingFramesRef.current.splice(0, STREAMING_FRAMES)
          window.electron?.sendAudio(
            mergeFrames(chunks).buffer as ArrayBuffer,
            0,
            false,
            currentMicSegIdRef.current,
          )
        }
      },
    })

    await myvad.start()
    vadRef.current = myvad
    setRecording(true)
    setElapsed(0)
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000)

    window.electron?.startSession({
      sourceLang,
      targetLang,
      engine: 'deepl',
      sampleRate: 16000,
      mode,
    })
  }, [sourceLang, targetLang, mode, selectedDeviceId])

  const stopMicAudio = useCallback(async () => {
    await vadRef.current?.destroy()
    vadRef.current = null
    setRecording(false)
    setVolume(0)
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    window.electron?.stopSession()
    currentMicSegIdRef.current = ''
  }, [])

  const startSysAudio = useCallback(async () => {
    const sources = await window.electron.getDesktopCapturerSources()
    const screen = sources[0]
    if (!screen) return

    const sysVad = await MicVAD.new({
      baseAssetPath: '/',
      onnxWASMBasePath: '/',
      model: 'v5',
      redemptionMs: 600,
      // negativeSpeechThreshold: 0.15,
      getStream: async () => {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: screen.id,
            },
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
        currentSysSegIdRef.current = nanoid()
        setSysInterimSegment({ id: currentSysSegIdRef.current, channel: 'loopback', timestamp: new Date(), text: '' })
        setSysVolume(1)
      },
      onSpeechEnd: (audio: Float32Array) => {
        isSysSpeakingRef.current = false
        const segId = currentSysSegIdRef.current
        if (sysStreamingFramesRef.current.length > 0) {
          const merged = mergeFrames(sysStreamingFramesRef.current)
          sysStreamingFramesRef.current = []
          window.electron?.sendAudio(
            merged.buffer as ArrayBuffer,
            1,
            false,
            segId,
          )
        }
        window.electron?.sendAudio(audio.buffer as ArrayBuffer, 1, true, segId)
        setSysVolume(0)
        setSysSegments((prev) => [
          {
            id: segId,
            channel: 'loopback',
            timestamp: new Date(),
            text: '',
            micAudio: {
              audio: audio.slice(),
              duration: audio.length / SAMPLE_RATE,
            },
          },
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
          const chunks = sysStreamingFramesRef.current.splice(
            0,
            STREAMING_FRAMES,
          )
          window.electron?.sendAudio(
            mergeFrames(chunks).buffer as ArrayBuffer,
            1,
            false,
            currentSysSegIdRef.current,
          )
        }
      },
    })

    await sysVad.start()
    sysVadRef.current = sysVad
    setSystemCapture(true)

    window.electron?.startSession({
      sourceLang,
      targetLang,
      engine: 'deepl',
      sampleRate: 16000,
      mode,
    })
  }, [sourceLang, targetLang, mode])

  const stopSysAudio = useCallback(async () => {
    await sysVadRef.current?.destroy()
    sysVadRef.current = null
    sysStreamRef.current?.getTracks().forEach((t) => t.stop())
    sysStreamRef.current = null
    sysStreamingFramesRef.current = []
    isSysSpeakingRef.current = false
    setSystemCapture(false)
    setSysVolume(0)
    currentSysSegIdRef.current = ''
  }, [])

  return (
    <div className="h-screen bg-background flex flex-col">
      <div className="w-full flex items-center justify-between p-6 border-b border-border">
        <div className="flex items-center justify-between gap-8">
          <h1 className="text-3xl font-semibold">TranBot</h1>

          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between select-none gap-4">
                <div className="flex flex-row items-center gap-2 w-50">
                  <Checkbox
                    checked={systemCapture}
                    onCheckedChange={(checked) =>
                      checked ? startSysAudio() : stopSysAudio()
                    }
                  />
                  <Monitor className="w-4 text-muted-foreground" />
                  <span className="text-m">System Audio</span>
                </div>

                <div className="w-40">
                  {systemCapture && <Progress value={sysVolume * 100} />}
                </div>
              </div>
              <p className="text-xs text-muted-foreground ml-6">
                若要即時翻譯會議其他人發言，請選擇。
              </p>
            </div>

            <div className="flex flex-row items-center justify-between gap-4">
              <div className="w-50">
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
                        {device.label ||
                          `Microphone ${device.deviceId.slice(0, 8)}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-40">
                <Progress value={volume * 100} />
              </div>
            </div>
          </div>
        </div>

        <Button
          className="w-50"
          variant={recording ? 'destructive' : 'default'}
          onClick={recording ? stopMicAudio : startMicAudio}
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

        <p className="flex items-center text-2xl text-muted-foreground">
          <Clock className="mr-2 h-6 w-6" />{' '}
          {String(Math.floor(elapsed / 3600)).padStart(2, '0')}:
          {String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0')}:
          {String(elapsed % 60).padStart(2, '0')}
        </p>
      </div>

      <div className="h-full flex items-start justify-center p-8 overflow-y-auto">
        <Card className="w-full h-full flex flex-col">
          <CardHeader className="">
            <div className="flex flex-row justify-start items-center gap-2">
              {/* Mode selector */}
              <div className="flex rounded-md overflow-hidden border border-border w-50">
                {(['transcript', 'translate'] as Mode[]).map((m) => (
                  <button
                    key={m}
                    className={`flex-1 py-1.5 text-sm font-medium transition-colors ${
                      mode === m
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background text-muted-foreground hover:bg-muted'
                    }`}
                    disabled={recording}
                    onClick={() => setMode(m)}
                  >
                    {m === 'transcript' ? 'Transcript' : 'Translation'}
                  </button>
                ))}
              </div>

              {/* Language selectors */}
              <div className="flex items-center gap-2">
                <Select
                  value={sourceLang}
                  onValueChange={(v) => setSourceLang(v as SourceLang)}
                  disabled={recording}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOURCE_LANGUAGES.map((lang) => (
                      <SelectItem key={lang.code} value={lang.code}>
                        {lang.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-muted-foreground text-sm">→</span>
                <Select
                  value={targetLang}
                  onValueChange={(v) => setTargetLang(v as TargetLang)}
                  disabled={recording}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TARGET_LANGUAGES.map((lang) => (
                      <SelectItem key={lang.code} value={lang.code}>
                        {lang.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <Separator />
          <CardContent className="flex-1 overflow-y-auto space-y-4">
            <SegmentList
              segments={[...micSegments, ...sysSegments].sort(
                (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
              )}
              micInterimSegment={micInterimSegment}
              sysInterimSegment={sysInterimSegment}
              mode={mode}
              playingRawSegId={playingRawSegId}
              playingDenoisedSegId={playingDenoisedSegId}
              onClear={() => {
                stopRawPlayback()
                stopDenoisedPlayback()
                setMicSegments([])
                setSysSegments([])
                setMicInterimSegment(null)
                setSysInterimSegment(null)
              }}
              onPlayRaw={playRawAudio}
              onStopRaw={stopRawPlayback}
              onPlayDenoised={playDenoisedAudio}
              onStopDenoised={stopDenoisedPlayback}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
