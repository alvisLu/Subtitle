import React, { useState, useRef, useCallback, useEffect } from 'react'
import { nanoid } from 'nanoid'
import { MicVAD } from '@ricky0123/vad-web'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { AArrowDown, AArrowUp, Clock, Pin } from 'lucide-react'
import { RecordControls } from './components/RecordControls'
import { AudioCaptureSettings } from './components/AudioCaptureSettings'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SegmentList } from './components/SegmentList'
import type { Segment } from './components/SegmentList'
import { Separator } from '../components/ui/separator'
import { Toaster } from '../components/ui/sonner'
import { toast } from 'sonner'

const SAMPLE_RATE = 16000
// Silero v5: 512 samples/frame @ 16kHz = 32ms; 16 frames = 512ms ≈ 0.5s
const STREAMING_FRAMES = 16

import type { Mode, TargetLang, SourceLang, Status } from './types'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

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
  const [status, setStatus] = useState<Status>('stop')
  const [micVolume, setMicVolume] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Mic: unified segments (transcript + denoised + raw recording per utterance)
  const [micSegments, setMicSegments] = useState<Segment[]>([])
  const [micInterimSegment, setMicInterimSegment] = useState<Segment | null>(
    null,
  )
  const [playingRawSegId, setPlayingRawSegId] = useState<string | null>(null)
  const [playingDenoisedSegId, setPlayingDenoisedSegId] = useState<
    string | null
  >(null)

  // System audio
  const [sysSegments, setSysSegments] = useState<Segment[]>([])
  const [sysInterimSegment, setSysInterimSegment] = useState<Segment | null>(
    null,
  )

  const [mode, setMode] = useState<Mode>('translate')
  const [sourceLang, setSourceLang] = useState<SourceLang>('en')
  const [targetLang, setTargetLang] = useState<TargetLang>('zh-HANT')

  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('')
  const [isSysCapture, setIsSysCapture] = useState(false)
  const [isMicCapture, setIsMicChpture] = useState(false)
  const [sysVolume, setSysVolume] = useState(0)
  const [isDenoiseEnabled, setIsDenoiseEnabled] = useState(false)
  const [fontSize, setFontSize] = useState(20)
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)

  // Mic VAD
  const vadRef = useRef<MicVAD | null>(null)
  const micStreamingFramesRef = useRef<Float32Array[]>([])
  const isMicSpeakingRef = useRef(false)

  // Per-channel current segment ID (nanoid)
  const currentMicSegIdRef = useRef('')
  const currentSysSegIdRef = useRef('')

  const micInterimTextRef = useRef('')
  const micInterimTranslationTextRef = useRef('')
  const sysInterimTextRef = useRef('')
  const sysInterimTranslationTextRef = useRef('')

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
          setSysInterimSegment((prev) => (prev?.id === id ? null : prev))
        } else {
          sysInterimTextRef.current = text
          setSysInterimSegment((prev) =>
            prev?.id === id ? { ...prev, text } : prev,
          )
        }
      } else {
        if (final) {
          setMicSegments((prev) =>
            prev.map((s) =>
              s.id === id ? { ...s, text, timestamp: new Date() } : s,
            ),
          )
          setMicInterimSegment((prev) => (prev?.id === id ? null : prev))
        } else {
          micInterimTextRef.current = text
          setMicInterimSegment((prev) =>
            prev?.id === id ? { ...prev, text } : prev,
          )
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
          sysInterimTranslationTextRef.current = text
          setSysInterimSegment((prev) =>
            prev?.id === id ? { ...prev, translation: text } : prev,
          )
        }
      } else {
        if (final) {
          setMicSegments((prev) =>
            prev.map((s) => (s.id === id ? { ...s, translation: text } : s)),
          )
        } else {
          micInterimTranslationTextRef.current = text
          setMicInterimSegment((prev) =>
            prev?.id === id ? { ...prev, translation: text } : prev,
          )
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
        isMicSpeakingRef.current = true
        micStreamingFramesRef.current = []
        currentMicSegIdRef.current = nanoid()
        micInterimTextRef.current = ''
        micInterimTranslationTextRef.current = ''
        setMicInterimSegment({
          id: currentMicSegIdRef.current,
          channel: 'mic',
          timestamp: new Date(),
          text: '',
        })
        setMicVolume(1)
      },
      onSpeechEnd: (audio: Float32Array) => {
        isMicSpeakingRef.current = false
        const segId = currentMicSegIdRef.current
        if (!segId) return
        const interimText = micInterimTextRef.current
        micInterimTextRef.current = ''
        const micInterimTranslation = micInterimTranslationTextRef.current
        micInterimTranslationTextRef.current = ''
        if (micStreamingFramesRef.current.length > 0) {
          const merged = mergeFrames(micStreamingFramesRef.current)
          micStreamingFramesRef.current = []
          window.electron?.sendAudio(
            merged.buffer as ArrayBuffer,
            0,
            false,
            segId,
          )
        }
        window.electron?.sendAudio(audio.buffer as ArrayBuffer, 0, true, segId)
        setMicVolume(0)
        setMicSegments((prev) => [
          {
            id: segId,
            channel: 'mic',
            timestamp: new Date(),
            text: interimText,
            translation: micInterimTranslation,
            rawAudio: {
              audio: audio.slice(),
              duration: audio.length / SAMPLE_RATE,
            },
          },
          ...prev,
        ])
        setMicInterimSegment(null)
      },
      onVADMisfire: () => {
        isMicSpeakingRef.current = false
        micStreamingFramesRef.current = []
        micInterimTextRef.current = ''
        micInterimTranslationTextRef.current = ''
        setMicInterimSegment(null)
        setMicVolume(0)
      },
      onFrameProcessed: (prob, frame) => {
        if (!vadRef.current?.listening) return
        setMicVolume(prob.isSpeech)
        if (!isMicSpeakingRef.current) return
        micStreamingFramesRef.current.push(new Float32Array(frame))
        if (micStreamingFramesRef.current.length >= STREAMING_FRAMES) {
          const chunks = micStreamingFramesRef.current.splice(
            0,
            STREAMING_FRAMES,
          )
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
  }, [selectedDeviceId])

  const stopMicAudio = useCallback(async () => {
    // 若正在說話，將緩衝 frames 當作 final segment 送出
    if (isMicSpeakingRef.current && micStreamingFramesRef.current.length > 0) {
      const segId = currentMicSegIdRef.current
      const merged = mergeFrames(micStreamingFramesRef.current)
      window.electron?.sendAudio(merged.buffer as ArrayBuffer, 0, true, segId)
      setMicSegments((prev) => [
        {
          id: segId,
          channel: 'mic',
          timestamp: new Date(),
          text: micInterimTextRef.current,
          translation: micInterimTranslationTextRef.current,
          rawAudio: {
            audio: merged.slice(),
            duration: merged.length / SAMPLE_RATE,
          },
        },
        ...prev,
      ])
      micInterimTextRef.current = ''
      setMicInterimSegment(null)
    }
    currentMicSegIdRef.current = ''
    await vadRef.current?.destroy()
    vadRef.current = null
    micStreamingFramesRef.current = []
    isMicSpeakingRef.current = false
    setMicVolume(0)
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
      redemptionMs: 200,
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
        // desktopCapturer 必須同時要求 video 才能拿到系統音訊，但 VAD 只需要音訊，立即釋放 video track
        stream.getVideoTracks().forEach((t) => t.stop())
        // 保留 stream reference，讓 stopSysAudio 能主動 stop 所有 tracks 並釋放擷取權限
        sysStreamRef.current = stream
        return stream
      },
      onSpeechStart: () => {
        isSysSpeakingRef.current = true
        sysStreamingFramesRef.current = []
        currentSysSegIdRef.current = nanoid()
        sysInterimTextRef.current = ''
        sysInterimTranslationTextRef.current = ''
        setSysInterimSegment({
          id: currentSysSegIdRef.current,
          channel: 'loopback',
          timestamp: new Date(),
          text: '',
        })
        setSysVolume(1)
      },
      onSpeechEnd: (audio: Float32Array) => {
        isSysSpeakingRef.current = false
        const segId = currentSysSegIdRef.current
        if (!segId) return
        const interimText = sysInterimTextRef.current
        sysInterimTextRef.current = ''
        const interimTranslationText = sysInterimTranslationTextRef.current
        sysInterimTranslationTextRef.current = ''
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
        setSysSegments((prev) => [
          {
            id: segId,
            channel: 'loopback',
            timestamp: new Date(),
            text: interimText,
            translation: interimTranslationText,
            rawAudio: {
              audio: audio.slice(),
              duration: audio.length / SAMPLE_RATE,
            },
          },
          ...prev,
        ])
        setSysInterimSegment(null)
        setSysVolume(0)
      },
      onVADMisfire: () => {
        isSysSpeakingRef.current = false
        sysStreamingFramesRef.current = []
        sysInterimTextRef.current = ''
        sysInterimTranslationTextRef.current = ''
        setSysInterimSegment(null)
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
  }, [])

  const stopSysAudio = useCallback(async () => {
    // 若正在說話，將緩衝 frames 當作 final segment 送出
    if (isSysSpeakingRef.current && sysStreamingFramesRef.current.length > 0) {
      const segId = currentSysSegIdRef.current
      const merged = mergeFrames(sysStreamingFramesRef.current)
      window.electron?.sendAudio(merged.buffer as ArrayBuffer, 1, true, segId)
      setSysSegments((prev) => [
        {
          id: segId,
          channel: 'loopback',
          timestamp: new Date(),
          text: sysInterimTextRef.current,
          translation: sysInterimTranslationTextRef.current,
          rawAudio: {
            audio: merged.slice(),
            duration: merged.length / SAMPLE_RATE,
          },
        },
        ...prev,
      ])
      sysInterimTextRef.current = ''
      sysInterimTranslationTextRef.current = ''
      setSysInterimSegment(null)
    }
    currentSysSegIdRef.current = ''
    await sysVadRef.current?.destroy()
    sysVadRef.current = null

    // 主動 stop 所有 tracks，確保桌面擷取權限完全釋放（MicVAD destroy 不保證會釋放）
    sysStreamRef.current?.getTracks().forEach((t) => t.stop())
    sysStreamRef.current = null

    sysStreamingFramesRef.current = []
    isSysSpeakingRef.current = false
    setSysVolume(0)
    currentSysSegIdRef.current = ''
  }, [])

  const startRecord = async () => {
    if (targetLang.split('-')[0] === sourceLang) {
      toast.error('The source and target languages must be different.')
      return
    }
    window.electron?.startSession({
      sourceLang,
      targetLang,
      engine: 'deepl',
      sampleRate: 16000,
      denoise: isDenoiseEnabled,
    })
    setStatus('recording')
    setElapsed(0)
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000)
    if (isMicCapture) await startMicAudio()
    if (isSysCapture) await startSysAudio()
    toast.success('Start Translation')
  }

  const handlePauseRecord = async () => {
    setStatus('pause')
    if (isMicCapture) await stopMicAudio()
    if (isSysCapture) await stopSysAudio()
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const pauseRecord = async () => {
    handlePauseRecord()
    toast.success('Pause Translation')
  }

  const resumeRecord = async () => {
    setStatus('recording')
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000)
    if (isMicCapture) await startMicAudio()
    if (isSysCapture) await startSysAudio()
    toast.success('Resume Translation')
  }

  const stopRecord = async () => {
    handlePauseRecord()
    window.electron?.stopSession()
    setStatus('stop')
    toast.warning('Finish Translation')
  }

  return (
    <div className="h-screen bg-background flex flex-col">
      <Toaster />
      <div className="relative w-full flex items-start px-4 py-3 border-b border-border md:items-center md:px-6 md:py-4">
        {/* Left: title */}
        <div className="flex flex-col gap-1 lg:flex-row lg:items-center lg:gap-4">
          <h1 className="font-semibold text-3xl">Subtitle</h1>
          <div className="flex items-center gap-2">
            <AudioCaptureSettings
              isSysCapture={isSysCapture}
              onSysCaptureChange={(v) => {
                setIsSysCapture(v)
                if (v) {
                  toast.success('Enable System Audio Capture')
                } else {
                  toast.success('Disable System Audio Capture')
                }
              }}
              sysVolume={sysVolume}
              isMicCapture={isMicCapture}
              onMicCaptureChange={(v) => {
                setIsMicChpture(v)
                if (v) {
                  toast.success('Enable Microphone Audio Capture')
                } else {
                  toast.success('Disable Microphone Audio Capture')
                }
              }}
              micVolume={micVolume}
              selectedDeviceId={selectedDeviceId}
              onDeviceChange={setSelectedDeviceId}
              audioDevices={audioDevices}
              disabled={status !== 'stop'}
              isDenoise={isDenoiseEnabled}
              onDenoiseChange={(v) => {
                setIsDenoiseEnabled(v)
                toast.success(v ? 'Enable Denoise' : 'Disable Denoise')
              }}
            />
            <RecordControls
              status={status}
              onStart={startRecord}
              onPause={pauseRecord}
              onResume={resumeRecord}
              onStop={stopRecord}
            />
          </div>
        </div>

        {/* Center: clock */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center justify-center gap-4">
          <p className="flex items-center text-xl text-muted-foreground md:text-2xl lg:text-2xl">
            <Clock className="mr-1 h-5 w-5 md:mr-1.5 md:h-6 md:w-6 lg:mr-2 lg:h-6 lg:w-6" />
            {String(Math.floor(elapsed / 3600)).padStart(2, '0')}:
            {String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0')}:
            {String(elapsed % 60).padStart(2, '0')}
          </p>
        </div>

        {/* Right: pin */}
        <div className="ml-auto flex items-center justify-end gap-4">
          <Button
            variant={alwaysOnTop ? 'default' : 'outline'}
            size="icon"
            onClick={() => {
              const next = !alwaysOnTop
              setAlwaysOnTop(next)
              window.electron.setAlwaysOnTop(next)
            }}
          >
            <Pin />
          </Button>
        </div>
      </div>

      <div className="h-full flex items-start justify-center p-8 overflow-y-auto">
        <Card className="w-full h-full flex flex-col">
          <CardHeader className="">
            {/* <div className="flex flex-row justify-between"> */}
            <div className="w-full grid grid-cols-2 items-start md:items-center ">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                {/* Mode selector */}
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer select-none">
                  <Switch
                    checked={mode === 'translate'}
                    onCheckedChange={(v: boolean) =>
                      setMode(v ? 'translate' : 'transcript')
                    }
                    disabled={status !== 'stop'}
                  />
                  <span
                    className={
                      mode === 'translate'
                        ? 'text-foreground'
                        : 'text-muted-foreground'
                    }
                  >
                    Show Translation
                  </span>
                </label>

                {/* Language selectors */}
                <div className="flex items-center gap-2">
                  <Select
                    value={sourceLang}
                    onValueChange={(v) => setSourceLang(v as SourceLang)}
                    disabled={status !== 'stop'}
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
                    disabled={status !== 'stop'}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TARGET_LANGUAGES.map((lang) => (
                        <SelectItem
                          key={lang.code}
                          value={lang.code}
                          disabled={lang.code.split('-')[0] === sourceLang}
                        >
                          {lang.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Text size controls */}
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setFontSize((s) => Math.max(14, s - 2))}
                  disabled={fontSize <= 14}
                >
                  <AArrowDown />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setFontSize((s) => Math.min(32, s + 2))}
                  disabled={fontSize >= 32}
                >
                  <AArrowUp />
                </Button>
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
              fontSize={fontSize}
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
