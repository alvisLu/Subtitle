import React, { useState, useRef, useCallback } from 'react'

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

    // Connect: source → worklet → silent gain (keeps graph alive without playback)
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
    <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif' }}>
      <h2 style={{ marginTop: 0 }}>TranBot — Mic Test</h2>

      <p style={{ color: '#666', fontSize: 14 }}>
        Sample rate: {sampleRate ? `${sampleRate} Hz` : '—'}
      </p>

      {/* Volume bar */}
      <div style={{
        width: 300,
        height: 16,
        background: '#e5e7eb',
        borderRadius: 8,
        overflow: 'hidden',
        marginBottom: 20,
      }}>
        <div style={{
          width: `${volume * 100}%`,
          height: '100%',
          background: recording ? '#22c55e' : '#9ca3af',
          transition: 'width 80ms linear',
        }} />
      </div>

      <button
        onClick={recording ? stop : start}
        style={{
          padding: '8px 20px',
          fontSize: 14,
          borderRadius: 6,
          border: 'none',
          background: recording ? '#ef4444' : '#3b82f6',
          color: '#fff',
          cursor: 'pointer',
        }}
      >
        {recording ? 'Stop' : 'Start Mic'}
      </button>
    </div>
  )
}
