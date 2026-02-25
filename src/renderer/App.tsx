import React, { useState, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Mic, MicOff } from 'lucide-react'

const PROCESSOR_CODE = `
class MicProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0]
    if (ch) this.port.postMessage(ch.slice())
    return true
  }
}
registerProcessor('mic-processor', MicProcessor)
`

function createProcessorUrl() {
  const blob = new Blob([PROCESSOR_CODE], { type: 'application/javascript' })
  return URL.createObjectURL(blob)
}

export default function App() {
  const [recording, setRecording] = useState(false)
  const [sampleRate, setSampleRate] = useState(0)
  const [volume, setVolume] = useState(0)

  const ctxRef = useRef<AudioContext | null>(null)
  const processorUrlRef = useRef<string | null>(null)

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    const ctx = new AudioContext()

    const processorUrl = createProcessorUrl()
    processorUrlRef.current = processorUrl
    await ctx.audioWorklet.addModule(processorUrl)

    const source = ctx.createMediaStreamSource(stream)
    const worklet = new AudioWorkletNode(ctx, 'mic-processor')

    worklet.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const pcm = e.data
      const rms = Math.sqrt(pcm.reduce((s, v) => s + v * v, 0) / pcm.length)
      setVolume(Math.min(1, rms * 8))
    }

    const silencer = ctx.createGain()
    silencer.gain.value = 0
    source.connect(worklet)
    worklet.connect(silencer)
    silencer.connect(ctx.destination)

    ctxRef.current = ctx
    setSampleRate(ctx.sampleRate)
    setRecording(true)
  }, [])

  const stop = useCallback(() => {
    ctxRef.current?.close()
    ctxRef.current = null
    if (processorUrlRef.current) {
      URL.revokeObjectURL(processorUrlRef.current)
      processorUrlRef.current = null
    }
    setRecording(false)
    setVolume(0)
    setSampleRate(0)
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
            Sample rate: {sampleRate ? `${sampleRate} Hz` : '—'}
          </p>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Volume bar */}
          <div className="h-3 w-full rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-75"
              style={{
                width: `${volume * 100}%`,
                backgroundColor: recording ? 'var(--color-primary)' : 'var(--color-muted-foreground)',
              }}
            />
          </div>

          <Button
            className="w-full"
            variant={recording ? 'destructive' : 'default'}
            onClick={recording ? stop : start}
          >
            {recording ? (
              <><MicOff className="mr-2 h-4 w-4" /> Stop</>
            ) : (
              <><Mic className="mr-2 h-4 w-4" /> Start Mic</>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
