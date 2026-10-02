import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL } from '@ffmpeg/util'
import coreJs from '@ffmpeg/core?url'
import coreWasm from '@ffmpeg/core/wasm?url'
import { fetchMediaBlob } from './media-fetch'
import type { GifClipRange, GifPreset, Mp4Preset } from './types'

let ffmpeg: FFmpeg | null = null
let loadPromise: Promise<FFmpeg> | null = null
let progressHandler: ((ratio: number) => void) | null = null
let recentLog = ''

function toArrayBuffer(data: Uint8Array | string): ArrayBuffer {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : Uint8Array.from(data)
  return bytes.buffer
}

async function removeFile(instance: FFmpeg, name: string): Promise<void> {
  try {
    await instance.deleteFile(name)
  } catch {
    // The file is not in the wasm filesystem.
  }
}

async function getFfmpeg(): Promise<FFmpeg> {
  if (ffmpeg?.loaded) return ffmpeg
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    try {
      const instance = new FFmpeg()
      instance.on('progress', ({ progress }) => {
        if (Number.isFinite(progress)) progressHandler?.(Math.min(1, Math.max(0, progress)))
      })
      instance.on('log', ({ message }) => {
        const line = message.trim()
        if (line) recentLog = line
      })

      await instance.load({
        coreURL: await toBlobURL(coreJs, 'text/javascript'),
        wasmURL: await toBlobURL(coreWasm, 'application/wasm'),
      })

      ffmpeg = instance
      return instance
    } catch (error) {
      loadPromise = null
      ffmpeg = null
      throw error
    }
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

function buildClipFilter(preset: GifPreset, clip: GifClipRange): string {
  const crop = clip.crop
  const prefix = crop ? `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},` : ''
  return `${prefix}${buildGifFilter(preset)}`
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

function inputExtension(blob: Blob, filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename)
  const ext = match?.[1]?.toLowerCase()
  if (ext === 'webm' || ext === 'mov' || ext === 'mkv' || ext === 'avi' || ext === 'mp4') return ext
  if (ext === 'm4v') return 'mp4'
  if (blob.type.includes('webm')) return 'webm'
  if (blob.type.includes('quicktime')) return 'mov'
  if (blob.type.includes('matroska')) return 'mkv'
  return 'mp4'
}

async function writeSource(instance: FFmpeg, name: string, blob: Blob): Promise<void> {
  await removeFile(instance, name)
  await instance.writeFile(name, new Uint8Array(await blob.arrayBuffer()))
}

export async function convertToGif(
  sourceUrl: string,
  preset: GifPreset,
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  progressHandler = onProgress ?? null
  try {
    const ff = await getFfmpeg()
    const inputName = 'input.mp4'
    const outputName = 'output.gif'
    const sourceBlob = await fetchMediaBlob(sourceUrl)
    await writeSource(ff, inputName, sourceBlob)
    const code = await ff.exec(['-i', inputName, '-filter_complex', buildGifFilter(preset), '-loop', '0', outputName])
    if (code !== 0) throw new Error('Conversion failed.')
    const data = await ff.readFile(outputName)
    await removeFile(ff, inputName)
    await removeFile(ff, outputName)
    return new Blob([toArrayBuffer(data)], { type: 'image/gif' })
  } finally {
    progressHandler = null
  }
}

export async function convertToMp4(
  sourceUrl: string,
  preset: Mp4Preset,
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  progressHandler = onProgress ?? null
  try {
    const ff = await getFfmpeg()
    const inputName = 'input.mp4'
    const outputName = 'output.mp4'
    const sourceBlob = await fetchMediaBlob(sourceUrl)
    await writeSource(ff, inputName, sourceBlob)
    const code = await ff.exec(['-i', inputName, ...buildMp4Args(preset), outputName])
    if (code !== 0) throw new Error('Conversion failed.')
    const data = await ff.readFile(outputName)
    await removeFile(ff, inputName)
    await removeFile(ff, outputName)
    return new Blob([toArrayBuffer(data)], { type: 'video/mp4' })
  } finally {
    progressHandler = null
  }
}

export async function convertClipsToGifs(
  source: Blob,
  filename: string,
  preset: GifPreset,
  clips: GifClipRange[],
  onProgress?: (clipIndex: number, ratio: number) => void,
): Promise<Blob[]> {
  if (clips.length === 0) throw new Error('Add a clip first.')

  const ff = await getFfmpeg()
  const inputName = `source.${inputExtension(source, filename)}`
  await writeSource(ff, inputName, source)

  const results: Blob[] = []
  let currentOutput: string | null = null

  try {
    for (let index = 0; index < clips.length; index += 1) {
      const clip = clips[index]
      if (!(clip.end > clip.start)) throw new Error(`Clip ${index + 1} has an invalid time range.`)

      const outputName = `clip-${index}.gif`
      currentOutput = outputName
      await removeFile(ff, outputName)
      progressHandler = (ratio) => onProgress?.(index, ratio)
      recentLog = ''

      let code = 1
      try {
        code = await ff.exec([
          '-ss',
          clip.start.toFixed(3),
          '-to',
          clip.end.toFixed(3),
          '-i',
          inputName,
          '-filter_complex',
          buildClipFilter(preset, clip),
          '-loop',
          '0',
          '-an',
          outputName,
        ])
      } catch (error) {
        const detail = error instanceof Error ? error.message : recentLog
        throw new Error(detail ? `Could not convert clip ${index + 1}. ${detail}` : `Could not convert clip ${index + 1}.`)
      }
      if (code !== 0) {
        throw new Error(recentLog ? `Could not convert clip ${index + 1}. ${recentLog}` : `Could not convert clip ${index + 1}.`)
      }

      const bytes = new Uint8Array(toArrayBuffer(await ff.readFile(outputName)))
      const isGif = bytes.length > 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46
      if (!isGif) throw new Error(`Could not convert clip ${index + 1}.`)

      results.push(new Blob([bytes], { type: 'image/gif' }))
      await removeFile(ff, outputName)
      currentOutput = null
    }
  } finally {
    progressHandler = null
    if (currentOutput) await removeFile(ff, currentOutput)
    await removeFile(ff, inputName)
  }

  return results
}
