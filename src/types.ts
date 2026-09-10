export type MediaKind = 'gif' | 'video' | 'image'

export interface ResolvedMedia {
  id: string
  url: string
  kind: MediaKind
  thumbnailUrl?: string
  width?: number
  height?: number
  altText?: string
  durationMs?: number
  sourceLabel: string
}

export interface GifPreset {
  id: string
  label: string
  description: string
  fps: number
  width: number
  maxColors: number
  dither: boolean
}

export interface Mp4Preset {
  id: string
  label: string
  description: string
  maxWidth: number
  crf: number
  fps?: number
}
