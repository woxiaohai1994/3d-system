import Image from 'next/image'
import { cn } from '../../../lib/utils'

// Optical sizes compensate for the different transparent margins in the source artwork.
const opticalSizes: Record<string, number> = {
  '/icons/camera.png': 26,
  '/icons/pan.webp': 28,
  '/icons/select.webp': 34,
  '/icons/zone.webp': 36,
  '/icons/measure.png': 28,
  '/icons/delete.png': 27,
  '/icons/rotate.webp': 28,
  '/icons/topview.webp': 28,
}

export function ActionIcon({
  src,
  alt,
  active = false,
  mirrored = false,
}: {
  src: string
  alt: string
  active?: boolean
  mirrored?: boolean
}) {
  const size = opticalSizes[src] ?? 28
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center">
      <Image
        alt={alt}
        className={cn(
          'shrink-0 object-contain transition-[opacity,filter] duration-200',
          mirrored && '-scale-x-100',
          active
            ? 'opacity-100 grayscale-0'
            : 'opacity-60 grayscale group-hover:opacity-100 group-hover:grayscale-0',
        )}
        height={size}
        src={src}
        style={{ width: size, height: size, maxWidth: 'none' }}
        width={size}
      />
    </span>
  )
}
