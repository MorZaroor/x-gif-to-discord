export interface LoopCrop {
  x: number
  y: number
  w: number
  h: number
}

export interface LoopFindOptions {
  start: number
  end: number
  similarityPercent: number
  crop?: LoopCrop | null
  onProgress?: (ratio: number, label: string) => void
  isCancelled?: () => boolean
}

export interface LoopFindResult {
  start: number
  /** Time of the frame that matches `start`; export should end one GIF frame before this. */
  matchEnd: number
  similarity: number
}

const ANALYSIS_SIZE = 48
const ANALYSIS_FPS = 12
const MAX_FRAMES = 240
const MIN_LOOP_SECONDS = 0.4
const MAX_LOOP_SECONDS = 15

function waitForSeek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const target = Math.max(0, time)
    const onSeeked = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('Could not read a video frame.'))
    }
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
    }

    if (Math.abs(video.currentTime - target) < 0.002 && video.readyState >= 2) {
      resolve()
      return
    }

    video.addEventListener('seeked', onSeeked)
    video.addEventListener('error', onError)
    try {
      video.currentTime = target
    } catch (error) {
      cleanup()
      reject(error instanceof Error ? error : new Error('Could not seek in this video.'))
    }
  })
}

function frameSimilarity(a: Uint8Array, b: Uint8Array): number {
  let diff = 0
  for (let index = 0; index < a.length; index += 1) {
    diff += Math.abs(a[index] - b[index])
  }
  return 1 - diff / (a.length * 255)
}

function captureGrayFrame(
  video: HTMLVideoElement,
  ctx: CanvasRenderingContext2D,
  crop: LoopCrop | null,
): Uint8Array {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) throw new Error('Video is not ready.')

  if (crop) {
    const sx = Math.round(crop.x * vw)
    const sy = Math.round(crop.y * vh)
    const sw = Math.max(2, Math.round(crop.w * vw))
    const sh = Math.max(2, Math.round(crop.h * vh))
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE)
  } else {
    ctx.drawImage(video, 0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE)
  }

  const rgba = ctx.getImageData(0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE).data
  const gray = new Uint8Array(ANALYSIS_SIZE * ANALYSIS_SIZE)
  for (let index = 0, pixel = 0; index < rgba.length; index += 4, pixel += 1) {
    gray[pixel] = (rgba[index] * 0.299 + rgba[index + 1] * 0.587 + rgba[index + 2] * 0.114) | 0
  }
  return gray
}

function buildSampleTimes(start: number, end: number, fps: number): number[] {
  const span = end - start
  if (span < MIN_LOOP_SECONDS) return []

  let step = 1 / fps
  let times: number[] = []
  for (let time = start; time <= end - MIN_LOOP_SECONDS / 2; time += step) {
    times.push(time)
  }

  if (times.length > MAX_FRAMES) {
    const stride = Math.ceil(times.length / MAX_FRAMES)
    times = times.filter((_, index) => index % stride === 0)
  }

  if (times.length < 3) {
    times = [start, start + span / 2, end - MIN_LOOP_SECONDS / 2]
  }

  return times
}

export async function findSeamlessLoop(
  video: HTMLVideoElement,
  options: LoopFindOptions,
): Promise<LoopFindResult | null> {
  const { start, end, similarityPercent, crop, onProgress, isCancelled } = options
  if (end < start + MIN_LOOP_SECONDS) {
    throw new Error('Make the selected range a little longer first.')
  }

  const threshold = similarityPercent / 100
  const originalDuration = end - start
  const times = buildSampleTimes(start, end, ANALYSIS_FPS)
  if (times.length < 3) return null

  const canvas = document.createElement('canvas')
  canvas.width = ANALYSIS_SIZE
  canvas.height = ANALYSIS_SIZE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Could not analyze frames.')

  const frames: Uint8Array[] = []
  for (let index = 0; index < times.length; index += 1) {
    if (isCancelled?.()) return null
    await waitForSeek(video, times[index])
    if (isCancelled?.()) return null
    frames.push(captureGrayFrame(video, ctx, crop ?? null))
    onProgress?.((index + 1) / times.length * 0.85, `Scanning frames… ${index + 1}/${times.length}`)
  }

  const minGap = Math.max(2, Math.ceil(MIN_LOOP_SECONDS * ANALYSIS_FPS))

  let best: { i: number; j: number; sim: number } | null = null

  for (let i = 0; i < frames.length - minGap; i += 1) {
    for (let j = i + minGap; j < frames.length; j += 1) {
      const duration = times[j] - times[i]
      if (duration > MAX_LOOP_SECONDS) break

      const sim = frameSimilarity(frames[i], frames[j])
      if (sim < threshold) continue

      const better =
        !best ||
        sim > best.sim + 0.0005 ||
        (Math.abs(sim - best.sim) <= 0.0005 &&
          Math.abs(duration - originalDuration) < Math.abs(times[best.j] - times[best.i] - originalDuration))

      if (better) best = { i, j, sim }
    }
  }

  onProgress?.(1, 'Done scanning.')

  if (!best) return null

  return {
    start: times[best.i],
    matchEnd: times[best.j],
    similarity: best.sim,
  }
}
