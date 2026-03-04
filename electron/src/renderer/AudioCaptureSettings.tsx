import { Checkbox } from '@/components/ui/checkbox'
import { Monitor, Mic } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Progress } from './components/ui/progress'

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
}: AudioCaptureSettingsProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between select-none gap-4">
          <label className="flex flex-row items-center gap-2 w-50 cursor-pointer">
            <Checkbox
              checked={isSysCapture}
              onCheckedChange={(checked) => onSysCaptureChange(!!checked)}
              disabled={disabled}
            />
            <Monitor className="w-4 text-muted-foreground" />
            <span className="text-m">System Audio</span>
          </label>

          <div className="w-40">
            {isSysCapture && <Progress value={sysVolume * 100} />}
          </div>
        </div>
        <p className="text-xs text-muted-foreground ml-6">
          若要即時翻譯會議其他人發言，請選擇。
        </p>
      </div>

      <div className="flex flex-row items-center justify-between gap-4">
        <div className="w-50">
          <label className="flex flex-row items-center gap-2 w-50 cursor-pointer">
            <Checkbox
              checked={isMicCapture}
              onCheckedChange={(checked) => onMicCaptureChange(!!checked)}
              disabled={disabled}
            />
            <Mic className="w-4 text-muted-foreground" />
            <span className="text-m">Microphone</span>
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
                  {device.label || `Microphone ${device.deviceId.slice(0, 8)}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          {isMicCapture && <Progress value={micVolume * 100} />}
        </div>
      </div>
    </div>
  )
}
