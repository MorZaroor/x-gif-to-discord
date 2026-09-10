import type { GifPreset, Mp4Preset } from './types'

export const GIF_PRESETS: GifPreset[] = [
  {
    id: 'discord',
    label: 'Standard',
    description: '500px wide, 20fps',
    fps: 20,
    width: 500,
    maxColors: 256,
    dither: true,
  },
  {
    id: 'discord-hq',
    label: 'High quality',
    description: '500px wide, 30fps',
    fps: 30,
    width: 500,
    maxColors: 256,
    dither: true,
  },
  {
    id: 'discord-emoji',
    label: 'Emoji',
    description: '128px wide, 10fps',
    fps: 10,
    width: 128,
    maxColors: 128,
    dither: true,
  },
  {
    id: 'hq',
    label: 'Large',
    description: '720px wide, 30fps',
    fps: 30,
    width: 720,
    maxColors: 256,
    dither: true,
  },
]

export const MP4_PRESETS: Mp4Preset[] = [
  {
    id: 'discord',
    label: 'Standard',
    description: 'H.264, max 1280px wide',
    maxWidth: 1280,
    crf: 28,
  },
  {
    id: 'discord-small',
    label: 'Compact',
    description: 'H.264, max 720px wide, higher compression',
    maxWidth: 720,
    crf: 32,
  },
  {
    id: 'source-fps',
    label: 'Original fps',
    description: 'H.264, max 1280px wide, keeps source frame rate',
    maxWidth: 1280,
    crf: 26,
  },
]

export const DEFAULT_GIF_PRESET = GIF_PRESETS[0]
export const DEFAULT_MP4_PRESET = MP4_PRESETS[0]
