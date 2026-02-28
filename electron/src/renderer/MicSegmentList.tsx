import { Button } from '@/components/ui/button'
import { Mic, Monitor, Play, Square, Trash2 } from 'lucide-react'

export type AudioClip = { audio: Float32Array; duration: number }
export type Channel = 'mic' | 'loopback'

export type MicSegment = {
  id: number
  timestamp: Date
  channel: Channel
  text?: string
  translation?: string
  micAudio?: AudioClip
  denoisedAudio?: AudioClip
}

type Props = {
  segments: MicSegment[]
  interim: string
  translationInterim: string
  mode: 'transcript' | 'translate'
  playingMicSegId: number | null
  playingDenoisedSegId: number | null
  onClear: () => void
  onPlayMic: (segId: number, audio: Float32Array) => void
  onStopMic: () => void
  onPlayDenoised: (segId: number, audio: Float32Array) => void
  onStopDenoised: () => void
}

export function MicSegmentList({
  segments,
  interim,
  translationInterim,
  mode,
  playingMicSegId,
  playingDenoisedSegId,
  onClear,
  onPlayMic,
  onStopMic,
  onPlayDenoised,
  onStopDenoised,
}: Props) {
  if (segments.length === 0 && !interim) return null

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
          Auto list ({segments.length})
        </span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClear}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
      <div className="space-y-1 max-h-60 overflow-y-auto">
        {(interim || translationInterim) && (
          <div className="rounded-md bg-muted p-3 text-sm break-words italic opacity-60">
            {/* <div className="rounded-md bg-blue-50 dark:bg-blue-950 p-3 text-sm break-words italic opacity-60"> */}
            <div>{interim}<span className="animate-pulse"> ···</span></div>
            {mode === 'translate' && translationInterim && (
              <div className="mt-1 pt-1 border-t border-border/40">
                {translationInterim}<span className="animate-pulse"> ···</span>
              </div>
            )}
          </div>
        )}
        {segments.filter(seg => seg.text).map(seg => (
          <div key={seg.id} className="rounded-md bg-muted p-3 text-sm break-words text-muted-foreground">
            {/* <div key={seg.id} className="rounded-md bg-blue-50 dark:bg-blue-950 p-3 text-sm break-words text-muted-foreground"> */}
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              {
                seg.channel === 'mic' ? < Mic className="h-3 w-3" /> :
                  <Monitor className="h-3 w-3" />
              }
            </span>
            < div className="text-xs opacity-50 mb-1">{seg.timestamp.toLocaleTimeString()}</div>
            {seg.text && <div>{seg.text}</div>}
            {mode === 'translate' && seg.translation && (
              <div className="mt-1 pt-1 border-t border-border/40">{seg.translation}</div>
            )}
            {seg.text && (seg.denoisedAudio || seg.micAudio) && (
              <div className="flex gap-2 mt-2 flex-wrap">
                {seg.denoisedAudio && (
                  <button
                    className="flex items-center gap-1 text-xs rounded px-1.5 py-0.5 bg-background border border-border hover:bg-muted-foreground/10"
                    onClick={() =>
                      playingDenoisedSegId === seg.id
                        ? onStopDenoised()
                        : onPlayDenoised(seg.id, seg.denoisedAudio!.audio)
                    }
                  >
                    {playingDenoisedSegId === seg.id
                      ? <Square className="h-2.5 w-2.5" />
                      : <Play className="h-2.5 w-2.5" />
                    }
                    Denoised {seg.denoisedAudio.duration.toFixed(1)}s
                  </button>
                )}
                {seg.micAudio && (
                  <button
                    className="flex items-center gap-1 text-xs rounded px-1.5 py-0.5 bg-background border border-border hover:bg-muted-foreground/10"
                    onClick={() =>
                      playingMicSegId === seg.id
                        ? onStopMic()
                        : onPlayMic(seg.id, seg.micAudio!.audio)
                    }
                  >
                    {playingMicSegId === seg.id
                      ? <Square className="h-2.5 w-2.5" />
                      : <Play className="h-2.5 w-2.5" />
                    }
                    Raw {seg.micAudio.duration.toFixed(1)}s
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div >
  )
}
