import React, { useState, useRef, useCallback, useEffect } from 'react'
import { MicVAD } from '@ricky0123/vad-web'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Mic, MicOff } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const LANGUAGES = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
  // { code: 'ja', label: '日本語' },
  // { code: 'ko', label: '한국어' },
  // { code: 'fr', label: 'Français' },
  // { code: 'de', label: 'Deutsch' },
]

export default function App() {
  const [recording, setRecording] = useState(false)
  const [volume, setVolume] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [sourceLang, setSourceLang] = useState('zh')

  const vadRef = useRef<MicVAD | null>(null)

  useEffect(() => {
    if (!window.electron) return
    window.electron.onTranscript(({ text }) => {
      setTranscript(text)
    })
    return () => {
      window.electron.removeAllListeners('transcript')
    }
  }, [])

  const start = useCallback(async () => {
    const myvad = await MicVAD.new({
      // Static assets served from renderer publicDir (src/renderer/public/)
      baseAssetPath: '/',
      onnxWASMBasePath: '/',
      model: 'v5',
      onSpeechStart: () => setVolume(1),
      onSpeechEnd: (audio: Float32Array) => {
        // audio is Float32Array at 16kHz — send complete speech segment
        window.electron?.sendAudio(audio.buffer as ArrayBuffer, 0)
        setVolume(0)
      },
      onVADMisfire: () => setVolume(0),
      onFrameProcessed: (prob) => {
        if (!vadRef.current?.listening) return
        setVolume(prob.isSpeech)
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
    })
  }, [sourceLang])

  const stop = useCallback(async () => {
    await vadRef.current?.destroy()
    vadRef.current = null
    setRecording(false)
    setVolume(0)
    window.electron?.stopSession()
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
          <p className="text-sm text-muted-foreground">VAD: Silero v5 @ 16kHz</p>
        </CardHeader>

        <CardContent className="space-y-4">
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
                <MicOff className="mr-2 h-4 w-4" /> Stop
              </>
            ) : (
              <>
                <Mic className="mr-2 h-4 w-4" /> Start Mic
              </>
            )}
          </Button>

          {transcript && (
            <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground break-words">
              {transcript}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
