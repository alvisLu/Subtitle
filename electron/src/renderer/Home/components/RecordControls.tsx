import { Button } from '@/components/ui/button'
import { PlayIcon, PauseIcon, Square } from 'lucide-react'
import type { Status } from '../../types'

interface RecordControlsProps {
  status: Status
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
}

export function RecordControls({
  status,
  onStart,
  onPause,
  onResume,
  onStop,
}: RecordControlsProps) {
  if (status === 'stop') {
    return (
      <Button className="w-30" variant="default" onClick={onStart}>
        <PlayIcon className="mr-2 h-4 w-4" /> Start
      </Button>
    )
  }

  if (status === 'recording') {
    return (
      <div className="flex items-center gap-2">
        <Button className="w-30" variant="ghost" onClick={onPause}>
          <PauseIcon className="mr-2 h-4 w-4" /> Pause
        </Button>
        <Button className="w-30" variant="destructive" onClick={onStop}>
          <Square className="mr-2 h-4 w-4" /> Stop
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Button className="w-30" variant="default" onClick={onResume}>
        <PlayIcon className="mr-2 h-4 w-4" /> Resume
      </Button>
      <Button className="w-30" variant="destructive" onClick={onStop}>
        <Square className="mr-2 h-4 w-4" /> Stop
      </Button>
    </div>
  )
}
