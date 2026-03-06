import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Monitor, Mic, Settings, Wand2 } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Progress } from '../../components/ui/progress'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../components/ui/popover'

interface AudioCaptureSettingsProps {
  isSysCapture: boolean
  onSysCaptureChange: (checked: boolean) => void
  sysVolume: number
  isMicCapture: boolean
  onMicCaptureChange: (checked: boolean) => void
  micVolume: number
  selectedDeviceId: string
  onDeviceChange: (deviceId: string) => void
  audioDevices: MediaDeviceInfo[]
  disabled: boolean
  isDenoise: boolean
  onDenoiseChange: (checked: boolean) => void
}

export function AudioCaptureSettings({
  isSysCapture,
  onSysCaptureChange,
  sysVolume,
  isMicCapture,
  onMicCaptureChange,
  micVolume,
  selectedDeviceId,
  onDeviceChange,
  audioDevices,
  disabled,
  isDenoise,
  onDenoiseChange,
}: AudioCaptureSettingsProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost">
          <Settings className="h-5 w-5" /> Audio Setting
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96">
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <label className="flex items-center select-none gap-2">
              <Checkbox
                checked={isSysCapture}
                onCheckedChange={(checked) => onSysCaptureChange(!!checked)}
                disabled={disabled}
              />
              <Monitor className="w-4 text-muted-foreground shrink-0" />
              <span className="cursor-pointer shrink-0">System Audio</span>
              {isSysCapture && (
                <Progress className="w-40 ml-auto" value={sysVolume * 100} />
              )}
            </label>
            <p className="text-xs text-muted-foreground ml-6">
              Enable to translate other participants' speech in real time during
              meetings.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <label className="flex items-center select-none gap-2">
              <Checkbox
                checked={isMicCapture}
                onCheckedChange={(checked) => onMicCaptureChange(!!checked)}
                disabled={disabled}
              />
              <Mic className="w-4 text-muted-foreground shrink-0" />
              <span className="cursor-pointer shrink-0">Microphone</span>
              {isMicCapture && (
                <Progress className="w-40 ml-auto" value={micVolume * 100} />
              )}
            </label>
            <Select
              value={selectedDeviceId}
              onValueChange={onDeviceChange}
              disabled={disabled}
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

          <div className="flex flex-col gap-1">
            <label className="flex items-center select-none gap-2">
              <Checkbox
                checked={isDenoise}
                onCheckedChange={(checked) => onDenoiseChange(!!checked)}
                disabled={disabled}
              />
              <Wand2 className="w-4 text-muted-foreground shrink-0" />
              <span className="cursor-pointer shrink-0">Denoise</span>
            </label>
            <p className="text-xs text-muted-foreground ml-6">
              Apply noise reduction before transcription. Also enables denoised
              audio playback per segment.
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
