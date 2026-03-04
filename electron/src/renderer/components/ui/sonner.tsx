import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 text-white" />,
        info: <InfoIcon className="size-4 text-white" />,
        warning: <TriangleAlertIcon className="size-4 text-white" />,
        error: <OctagonXIcon className="size-4 text-white" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      closeButton
      toastOptions={{
        classNames: {
          toast: 'group-[.toaster]:shadow-lg',
          success: '!bg-emerald-500/90 !text-white !border-emerald-500/90',
          info: '!bg-sky-500/90 !text-white !border-sky-500/90',
          warning: '!bg-amber-400/90 !text-white !border-amber-400/90',
          error: '!bg-rose-500/90 !text-white !border-rose-500/90',
          closeButton:
            '!left-auto !right-2 !top-1/2 !-translate-y-1/2 !translate-x-0 !bg-white/20 !border-white/30 !text-white hover:!bg-white/40 hover:!border-white/50',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
