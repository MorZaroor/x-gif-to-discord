import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL } from '@ffmpeg/util'
import coreJs from '@ffmpeg/core?url'
import coreWasm from '@ffmpeg/core/wasm?url'
import { fetchMediaBlob } from './media-fetch'
import type { GifPreset, Mp4Preset } from './types'

let ffmpeg: FFmpeg | null = null
let loadPromise: Promise<FFmpeg> | null = null

function toArrayBuffer(data: Uint8Array | string): ArrayBuffer {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : Uint8Array.from(data)
  return bytes.buffer
}

async function getFfmpeg(onProgress?: (ratio: number) => void): Promise<FFmpeg> {
  if (ffmpeg?.loaded) return ffmpeg
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    const instance = new FFmpeg()
    if (onProgress) {
      instance.on('progress', ({ progress }) => onProgress(progress))
    }

    await instance.load({
      coreURL: await toBlobURL(coreJs, 'text/javascript'),
      wasmURL: await toBlobURL(coreWasm, 'application/wasm'),
    })

    ffmpeg = instance
    return instance
  })()

  return loadPromise
}

function buildGifFilter(preset: GifPreset): string {
  const palettegen = preset.dither
    ? `palettegen=max_colors=${preset.maxColors}`
    : `palettegen=max_colors=${preset.maxColors}:stats_mode=diff`

  const paletteuse = preset.dither
    ? 'paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle'
    : 'paletteuse'

  return [
    `fps=${preset.fps}`,
    `scale=${preset.width}:-1:flags=lanczos`,
    'split[s0][s1]',
    `[s0]${palettegen}[p]`,
    `[s1][p]${paletteuse}`,
  ].join(',')
}

function buildMp4Args(preset: Mp4Preset): string[] {
  const vfParts = [`scale='min(${preset.maxWidth},iw)':-2:flags=lanczos`]
  if (preset.fps) vfParts.unshift(`fps=${preset.fps}`)

  return [
    '-vf',
    vfParts.join(','),
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    String(preset.crf),
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-an',
  ]
}

export async function convertToGif(
  sourceUrl: string,
  preset: GifPreset,
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  const ff = await getFfmpeg(onProgress)
  const inputName = 'input.mp4'
  const outputName = 'output.gif'

  const sourceBlob = await fetchMediaBlob(sourceUrl)
  await ff.writeFile(inputName, new Uint8Array(await sourceBlob.arrayBuffer()))

  const filter = buildGifFilter(preset)
  await ff.exec(['-i', inputName, '-filter_complex', filter, '-loop', '0', outputName])

  const data = await ff.readFile(outputName)
  await ff.deleteFile(inputName)
  await ff.deleteFile(outputName)

  const bytes = toArrayBuffer(data)
  return new Blob([bytes], { type: 'image/gif' })
}

export async function convertToMp4(
  sourceUrl: string,
  preset: Mp4Preset,
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  const ff = await getFfmpeg(onProgress)
  const inputName = 'input.mp4'
  const outputName = 'output.mp4'

  const sourceBlob = await fetchMediaBlob(sourceUrl)
  await ff.writeFile(inputName, new Uint8Array(await sourceBlob.arrayBuffer()))

  await ff.exec(['-i', inputName, ...buildMp4Args(preset), outputName])

  const data = await ff.readFile(outputName)
  await ff.deleteFile(inputName)
  await ff.deleteFile(outputName)

  const bytes = toArrayBuffer(data)
  return new Blob([bytes], { type: 'video/mp4' })
}
