import { Button } from '@/components/ui/button'
import { Mic, Monitor, Play, Square, Trash2 } from 'lucide-react'
import { Badge } from './components/ui/badge'

export type AudioClip = { audio: Float32Array; duration: number }
export type Channel = 'mic' | 'loopback'

export type MicSegment = {
  id: string
  timestamp: Date
  channel: Channel
  text: string
  translation?: string
  micAudio?: AudioClip
  denoisedAudio?: AudioClip
}

type Props = {
  segments: MicSegment[]
  micInterim?: string
  micTranslationInterim?: string
  sysInterim?: string
  sysTranslationInterim?: string
  mode: 'transcript' | 'translate'
  playingRawSegId: string | null
  playingDenoisedSegId: string | null
  onClear: () => void
  onPlayRaw: (segId: string, audio: Float32Array) => void
  onStopRaw: () => void
  onPlayDenoised: (segId: string, audio: Float32Array) => void
  onStopDenoised: () => void
}

export function MicSegmentList({
  segments,
  micInterim,
  micTranslationInterim,
  sysInterim,
  sysTranslationInterim,
  mode,
  playingRawSegId,
  playingDenoisedSegId,
  onClear,
  onPlayRaw,
  onStopRaw,
  onPlayDenoised,
  onStopDenoised,
}: Props) {
  if (segments.length === 0 && !micInterim && !sysInterim) {
    return <p className="text-muted-foreground">Original / Translation</p>
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
          Segments ({segments.length})
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onClear}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      <div className="space-y-1 overflow-y-auto">
        {micInterim && (
          <div className="rounded-md bg-muted p-3 text-sm break-words italic opacity-60">
            <div className="flex items-center gap-1 mb-1 text-xs text-muted-foreground">
              <Mic className="h-3 w-3" />
            </div>
            <div>
              {micInterim}
              <span className="animate-pulse"> ···</span>
            </div>
            {mode === 'translate' && micTranslationInterim && (
              <div className="mt-1 pt-1 border-t border-border/40">
                {micTranslationInterim}
                <span className="animate-pulse"> ···</span>
              </div>
            )}
          </div>
        )}
        {sysInterim && (
          <div className="rounded-md bg-muted p-3 text-sm break-words italic opacity-60">
            <div className="flex items-center gap-1 mb-1 text-xs text-muted-foreground">
              <Monitor className="h-3 w-3" />
            </div>
            <div>
              {sysInterim}
              <span className="animate-pulse"> ···</span>
            </div>
            {mode === 'translate' && sysTranslationInterim && (
              <div className="mt-1 pt-1 border-t border-border/40">
                {sysTranslationInterim}
                <span className="animate-pulse"> ···</span>
              </div>
            )}
          </div>
        )}
        {segments.map((seg) => (
          <div
            key={`${seg.channel}-${seg.id}`}
            className="rounded-md bg-muted p-3 text-sm break-words text-muted-foreground"
          >
            <div className="flex flex-row items-center justify-between gap-1">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                {seg.channel === 'mic' ? (
                  <Mic className="h-3 w-3" />
                ) : (
                  <Monitor className="h-3 w-3" />
                )}
                <span className="opacity-50">
                  {seg.timestamp.toLocaleTimeString()}
                </span>
                <Badge
                  variant="secondary"
                  className="bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
                >
                  {seg.id}
                </Badge>
              </div>
              <div>
                {(seg.denoisedAudio || seg.micAudio) && (
                  <div className="flex gap-2 flex-wrap">
                    {seg.denoisedAudio && (
                      <button
                        className="flex items-center gap-1 text-xs rounded px-1.5 py-0.5 bg-background border border-border hover:bg-muted-foreground/10"
                        onClick={() =>
                          playingDenoisedSegId === seg.id
                            ? onStopDenoised()
                            : onPlayDenoised(seg.id, seg.denoisedAudio!.audio)
                        }
                      >
                        {playingDenoisedSegId === seg.id ? (
                          <Square className="h-2.5 w-2.5" />
                        ) : (
                          <Play className="h-2.5 w-2.5" />
                        )}
                        Denoised {seg.denoisedAudio.duration.toFixed(1)}s
                      </button>
                    )}
                    {seg.micAudio && (
                      <button
                        className="flex items-center gap-1 text-xs rounded px-1.5 py-0.5 bg-background border border-border hover:bg-muted-foreground/10"
                        onClick={() =>
                          playingRawSegId === seg.id
                            ? onStopRaw()
                            : onPlayRaw(seg.id, seg.micAudio!.audio)
                        }
                      >
                        {playingRawSegId === seg.id ? (
                          <Square className="h-2.5 w-2.5" />
                        ) : (
                          <Play className="h-2.5 w-2.5" />
                        )}
                        Raw {seg.micAudio.duration.toFixed(1)}s
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div>{seg.text}</div>
            {mode === 'translate' && seg.translation && (
              <div className="mt-1 pt-1 border-t border-border/40">
                {seg.translation}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
