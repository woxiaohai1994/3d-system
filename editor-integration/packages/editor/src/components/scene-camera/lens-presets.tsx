import { useI18n } from '../../i18n'
import { cameraFocalPresets } from './camera-math'

export function LensPresets({
  value,
  onChange,
}: {
  value: number
  onChange: (value: number) => void
}) {
  const zh = useI18n().locale === 'zh-CN'
  return (
    <div role="group" aria-label={zh ? '常用焦距' : 'Common focal lengths'} className="flex gap-1">
      {cameraFocalPresets.map((focal) => (
        <button
          key={focal}
          type="button"
          aria-pressed={Math.abs(value - focal) < 0.01}
          className={`flex-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent ${Math.abs(value - focal) < 0.01 ? 'bg-accent text-sky-300' : ''}`}
          onClick={() => onChange(focal)}
        >
          {focal} {zh ? '毫米' : 'mm'}
        </button>
      ))}
    </div>
  )
}
