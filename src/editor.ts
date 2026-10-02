import './style.css'
import { downloadBlob } from './download'
import { convertClipsToGifs } from './ffmpeg-client'
import { fetchMediaBlob } from './media-fetch'
import { DEFAULT_GIF_PRESET, GIF_PRESETS } from './presets'
import { kindLabel, resolveTweetMedia } from './tweet'
import type { GifClipRange, PixelCrop, ResolvedMedia } from './types'
import { zipStore } from './zip'

const MIN_CLIP = 0.1
const MIN_CROP = 0.06

interface NormRect {
  x: number
  y: number
  w: number
  h: number
}

interface Clip {
  id: string
  name: string
  start: number
  end: number
  crop: NormRect | null
}

interface CropDrag {
  mode: string
  originX: number
  originY: number
  start: NormRect
}

const app = document.querySelector<HTMLDivElement>('#app')!
const base = import.meta.env.BASE_URL

const presetOptions = GIF_PRESETS.map(
  (preset) =>
    `<option value="${preset.id}" ${preset.id === DEFAULT_GIF_PRESET.id ? 'selected' : ''}>${preset.label} — ${preset.description}</option>`,
).join('')

app.innerHTML = `
  <div class="page page-wide">
    <header class="header">
      <nav class="nav">
        <a href="${base}">Download</a>
        <a href="${base}editor.html" aria-current="page">Split</a>
      </nav>
      <div class="brand">
        <span class="brand-icon" aria-hidden="true">𝕏</span>
      </div>
      <h1>Split into GIFs</h1>
      <p class="tagline wide">Upload a video or paste a post link, mark the parts you want, and download them as GIFs.</p>
    </header>

    <section class="panel">
      <div class="source-grid">
        <label class="drop" id="drop-zone">
          <input id="file-input" type="file" accept="video/*,.mp4,.mov,.webm,.mkv,.m4v" />
          <span class="drop-title" id="drop-title">Upload a video</span>
          <span class="drop-hint">MP4, MOV, WebM, or drop a file anywhere</span>
        </label>
        <p class="source-or">or</p>
        <div class="input-row">
          <input id="tweet-url" type="url" placeholder="https://x.com/user/status/…" autocomplete="off" spellcheck="false" />
          <button id="resolve-btn" type="button" class="primary">Go</button>
        </div>
      </div>
      <div id="source-picker" class="picker hidden"></div>
      <p id="status" class="status" role="status" aria-live="polite"></p>
    </section>

    <div id="workspace" class="workspace hidden">
      <section class="panel">
        <p id="source-meta" class="source-meta"></p>
        <div class="stage" id="stage">
          <video id="player" playsinline preload="auto"></video>
          <div id="crop-layer" class="crop-layer hidden">
            <div id="crop-box" class="crop-box">
              <span data-handle="nw"></span>
              <span data-handle="n"></span>
              <span data-handle="ne"></span>
              <span data-handle="e"></span>
              <span data-handle="se"></span>
              <span data-handle="s"></span>
              <span data-handle="sw"></span>
              <span data-handle="w"></span>
            </div>
          </div>
        </div>
        <div class="transport">
          <button id="play-btn" type="button" class="secondary">Play</button>
          <span id="time-label" class="time-readout">0:00.00 / 0:00.00</span>
        </div>
        <div class="timeline">
          <div class="timeline-track" id="track">
            <div id="clip-bars"></div>
            <div id="draft-range" class="draft-range"></div>
            <div id="playhead" class="playhead"></div>
            <button type="button" id="handle-in" class="time-handle" aria-label="Clip start"></button>
            <button type="button" id="handle-out" class="time-handle" aria-label="Clip end"></button>
          </div>
        </div>
        <div class="time-fields">
          <label>Start
            <input id="start-input" type="number" min="0" step="0.01" value="0" />
          </label>
          <label>End
            <input id="end-input" type="number" min="0" step="0.01" value="0" />
          </label>
          <button id="set-start" type="button" class="secondary" title="Use the current frame">Set start</button>
          <button id="set-end" type="button" class="secondary" title="Use the current frame">Set end</button>
        </div>
        <label class="check">
          <input id="crop-toggle" type="checkbox" />
          Crop this clip
        </label>
        <p id="crop-hint" class="hint hidden">Drag the box to choose what stays in the GIF. Drag a corner to resize it.</p>
        <div class="editor-actions">
          <button id="add-clip" type="button" class="secondary">Add clip</button>
          <button id="update-clip" type="button" class="secondary">Update selected</button>
        </div>
      </section>

      <section class="panel">
        <p class="results-title">Clips</p>
        <p class="hint clip-hint">Name each clip. That name is used for the GIF file.</p>
        <div id="clip-list"></div>
        <div class="convert-block">
          <label for="preset">GIF quality</label>
          <select id="preset" class="preset-select">${presetOptions}</select>
          <button id="convert-btn" type="button" class="primary">Download GIFs</button>
        </div>
        <div id="progress" class="progress hidden">
          <div class="progress-bar"><span id="progress-bar"></span></div>
          <p id="progress-text" class="progress-text">Preparing…</p>
        </div>
      </section>
    </div>

    <footer class="footer">
      <p>Runs in your browser · by M.Z / Beany</p>
    </footer>
  </div>
`

const dropZone = document.querySelector<HTMLLabelElement>('#drop-zone')!
const dropTitle = document.querySelector<HTMLSpanElement>('#drop-title')!
const fileInput = document.querySelector<HTMLInputElement>('#file-input')!
const urlInput = document.querySelector<HTMLInputElement>('#tweet-url')!
const resolveBtn = document.querySelector<HTMLButtonElement>('#resolve-btn')!
const statusEl = document.querySelector<HTMLParagraphElement>('#status')!
const picker = document.querySelector<HTMLDivElement>('#source-picker')!
const workspace = document.querySelector<HTMLDivElement>('#workspace')!
const sourceMeta = document.querySelector<HTMLParagraphElement>('#source-meta')!
const stage = document.querySelector<HTMLDivElement>('#stage')!
const player = document.querySelector<HTMLVideoElement>('#player')!
const cropLayer = document.querySelector<HTMLDivElement>('#crop-layer')!
const cropBox = document.querySelector<HTMLDivElement>('#crop-box')!
const playBtn = document.querySelector<HTMLButtonElement>('#play-btn')!
const timeLabel = document.querySelector<HTMLSpanElement>('#time-label')!
const track = document.querySelector<HTMLDivElement>('#track')!
const clipBars = document.querySelector<HTMLDivElement>('#clip-bars')!
const draftRange = document.querySelector<HTMLDivElement>('#draft-range')!
const playhead = document.querySelector<HTMLDivElement>('#playhead')!
const handleIn = document.querySelector<HTMLButtonElement>('#handle-in')!
const handleOut = document.querySelector<HTMLButtonElement>('#handle-out')!
const startInput = document.querySelector<HTMLInputElement>('#start-input')!
const endInput = document.querySelector<HTMLInputElement>('#end-input')!
const setStartBtn = document.querySelector<HTMLButtonElement>('#set-start')!
const setEndBtn = document.querySelector<HTMLButtonElement>('#set-end')!
const cropToggle = document.querySelector<HTMLInputElement>('#crop-toggle')!
const cropHint = document.querySelector<HTMLParagraphElement>('#crop-hint')!
const addClipBtn = document.querySelector<HTMLButtonElement>('#add-clip')!
const updateClipBtn = document.querySelector<HTMLButtonElement>('#update-clip')!
const clipList = document.querySelector<HTMLDivElement>('#clip-list')!
const presetSelect = document.querySelector<HTMLSelectElement>('#preset')!
const convertBtn = document.querySelector<HTMLButtonElement>('#convert-btn')!
const progressBlock = document.querySelector<HTMLDivElement>('#progress')!
const progressBar = document.querySelector<HTMLSpanElement>('#progress-bar')!
const progressText = document.querySelector<HTMLParagraphElement>('#progress-text')!

const state: {
  blob: Blob | null
  name: string
  duration: number
  videoWidth: number
  videoHeight: number
  clips: Clip[]
  selectedId: string | null
  draftStart: number
  draftEnd: number
  draftCrop: NormRect | null
  cropEnabled: boolean
  busy: boolean
} = {
  blob: null,
  name: '',
  duration: 0,
  videoWidth: 0,
  videoHeight: 0,
  clips: [],
  selectedId: null,
  draftStart: 0,
  draftEnd: 0,
  draftCrop: null,
  cropEnabled: false,
  busy: false,
}

let objectUrl: string | null = null
let generation = 0
let clipSeq = 1
let pendingMedia: ResolvedMedia[] = []
let dragKind: 'in' | 'out' | 'scrub' | null = null
let cropDrag: CropDrag | null = null
let seekQueued = false
let pendingSeek = 0

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  const mins = Math.floor(safe / 60)
  const secs = safe - mins * 60
  return `${mins}:${secs.toFixed(2).padStart(5, '0')}`
}

function percent(time: number): string {
  if (state.duration <= 0) return '0%'
  return `${(time / state.duration) * 100}%`
}

function setStatus(message: string, tone: 'info' | 'error' | 'success' = 'info') {
  statusEl.textContent = message
  statusEl.dataset.tone = tone
}

function syncActions() {
  const locked = state.busy
  const hasVideo = state.duration > 0
  resolveBtn.disabled = locked
  fileInput.disabled = locked
  addClipBtn.disabled = locked || !hasVideo
  updateClipBtn.disabled = locked || !state.selectedId
  convertBtn.disabled = locked || state.clips.length === 0
  cropToggle.disabled = locked || !hasVideo
  startInput.disabled = locked || !hasVideo
  endInput.disabled = locked || !hasVideo
  setStartBtn.disabled = locked || !hasVideo
  setEndBtn.disabled = locked || !hasVideo
  playBtn.disabled = locked || !hasVideo
  presetSelect.disabled = locked
  for (const input of clipList.querySelectorAll<HTMLInputElement>('[data-name]')) {
    input.disabled = locked
  }
  if (state.clips.length === 1) convertBtn.textContent = 'Download GIF'
  else if (state.clips.length > 1) convertBtn.textContent = `Download ${state.clips.length} GIFs`
  else convertBtn.textContent = 'Download GIFs'
}

function setBusy(next: boolean) {
  state.busy = next
  syncActions()
}

function syncTimeInputs() {
  if (document.activeElement !== startInput) startInput.value = state.draftStart.toFixed(2)
  if (document.activeElement !== endInput) endInput.value = state.draftEnd.toFixed(2)
  startInput.max = String(state.duration)
  endInput.max = String(state.duration)
}

function renderPlayhead() {
  const current = Number.isFinite(player.currentTime) ? player.currentTime : 0
  playhead.style.left = percent(current)
  timeLabel.textContent = `${formatTime(current)} / ${formatTime(state.duration)}`
}

function renderTimeline() {
  draftRange.style.left = percent(state.draftStart)
  draftRange.style.width = percent(Math.max(0, state.draftEnd - state.draftStart))
  handleIn.style.left = percent(state.draftStart)
  handleOut.style.left = percent(state.draftEnd)
  clipBars.innerHTML = state.clips
    .map((clip) => {
      const selected = clip.id === state.selectedId ? ' selected' : ''
      return `<button type="button" class="clip-bar${selected}" data-clip-id="${clip.id}" style="left:${percent(clip.start)};width:${percent(clip.end - clip.start)}" aria-label="Select clip"></button>`
    })
    .join('')
  renderPlayhead()
}

function renderCrop() {
  const show = state.cropEnabled && state.draftCrop !== null
  cropLayer.classList.toggle('hidden', !show)
  cropHint.classList.toggle('hidden', !state.cropEnabled)
  if (!state.draftCrop) return
  cropBox.style.left = `${state.draftCrop.x * 100}%`
  cropBox.style.top = `${state.draftCrop.y * 100}%`
  cropBox.style.width = `${state.draftCrop.w * 100}%`
  cropBox.style.height = `${state.draftCrop.h * 100}%`
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function renderClips() {
  if (state.clips.length === 0) {
    clipList.innerHTML = '<p class="empty-clips">No clips yet. Mark a start and end, then add a clip.</p>'
    return
  }

  clipList.innerHTML = state.clips
    .map((clip, index) => {
      const selected = clip.id === state.selectedId ? ' selected' : ''
      const crop = clip.crop ? '<span class="crop-badge">Cropped</span>' : ''
      return `
        <div class="clip-item">
          <input
            class="clip-name"
            data-name="${clip.id}"
            value="${escapeAttr(clip.name)}"
            aria-label="Name for clip ${index + 1}"
            maxlength="80"
            autocomplete="off"
            spellcheck="false"
            ${state.busy ? 'disabled' : ''}
          />
          <button type="button" class="clip-row${selected}" data-select="${clip.id}">
            <span class="clip-index">${index + 1}</span>
            <span>${formatTime(clip.start)} – ${formatTime(clip.end)}</span>
            ${crop}
          </button>
          <button type="button" class="secondary clip-remove" data-remove="${clip.id}">Remove</button>
        </div>
      `
    })
    .join('')
}

function layoutStage() {
  const vw = player.videoWidth
  const vh = player.videoHeight
  if (!vw || !vh || workspace.classList.contains('hidden')) return
  const maxWidth = stage.clientWidth
  const maxHeight = Math.min(window.innerHeight * 0.52, 480)
  if (maxWidth <= 0 || maxHeight <= 0) return
  const scale = Math.min(maxWidth / vw, maxHeight / vh)
  player.style.width = `${Math.max(1, Math.round(vw * scale))}px`
  player.style.height = `${Math.max(1, Math.round(vh * scale))}px`
  cropLayer.style.left = `${player.offsetLeft}px`
  cropLayer.style.top = `${player.offsetTop}px`
  cropLayer.style.width = `${player.offsetWidth}px`
  cropLayer.style.height = `${player.offsetHeight}px`
}

function seekTo(time: number) {
  pendingSeek = time
  if (seekQueued) return
  seekQueued = true
  requestAnimationFrame(() => {
    seekQueued = false
    if (state.duration <= 0) return
    const next = clamp(pendingSeek, 0, state.duration)
    if (Math.abs(player.currentTime - next) > 0.001) player.currentTime = next
    renderPlayhead()
  })
}

function normalizeCrop(rect: NormRect | null): NormRect | null {
  if (!rect) return null
  if (rect.x <= 0.005 && rect.y <= 0.005 && rect.w >= 0.99 && rect.h >= 0.99) return null
  return { x: rect.x, y: rect.y, w: rect.w, h: rect.h }
}

function clipFromDraft(name: string): Clip | null {
  if (state.draftEnd < state.draftStart + MIN_CLIP) {
    setStatus('The end time has to be after the start.', 'error')
    return null
  }
  return {
    id: `clip-${clipSeq}`,
    name,
    start: state.draftStart,
    end: state.draftEnd,
    crop: state.cropEnabled ? normalizeCrop(state.draftCrop) : null,
  }
}

function applyMetadata() {
  const duration = player.duration
  if (!Number.isFinite(duration) || duration <= 0) {
    setStatus('This video has no duration, so it can’t be split.', 'error')
    return
  }
  if (duration < MIN_CLIP || !player.videoWidth || !player.videoHeight) {
    setStatus('Could not read that video.', 'error')
    return
  }

  state.duration = duration
  state.videoWidth = player.videoWidth
  state.videoHeight = player.videoHeight
  state.draftStart = 0
  state.draftEnd = Math.min(duration, 3)
  if (state.draftEnd < MIN_CLIP) state.draftEnd = duration
  state.draftCrop = null
  state.cropEnabled = false
  state.clips = []
  state.selectedId = null
  cropToggle.checked = false
  workspace.classList.remove('hidden')
  sourceMeta.textContent = `${state.name} · ${state.videoWidth}×${state.videoHeight} · ${formatTime(state.duration)}`
  dropTitle.textContent = state.name
  syncTimeInputs()
  renderTimeline()
  renderClips()
  renderCrop()
  layoutStage()
  requestAnimationFrame(() => layoutStage())
  syncActions()

  const large = (state.blob?.size ?? 0) > 200 * 1024 * 1024
  setStatus(
    large
      ? 'Video ready. This file is large, so conversion may be slow or run out of memory.'
      : 'Video ready. Mark a range, then add a clip.',
    'success',
  )
}

function loadSource(blob: Blob, name: string) {
  const gen = ++generation
  const nextUrl = URL.createObjectURL(blob)
  const previous = objectUrl
  objectUrl = nextUrl
  state.blob = blob
  state.name = name
  state.duration = 0
  state.videoWidth = 0
  state.videoHeight = 0
  state.clips = []
  state.selectedId = null
  state.cropEnabled = false
  state.draftCrop = null
  cropToggle.checked = false
  workspace.classList.add('hidden')
  picker.classList.add('hidden')
  player.onloadedmetadata = () => {
    if (gen !== generation) return
    applyMetadata()
  }
  player.onerror = () => {
    if (gen !== generation) return
    if (player.error?.code === 1) return
    setStatus('Could not read that video.', 'error')
  }
  player.src = nextUrl
  if (previous) URL.revokeObjectURL(previous)
  setStatus('Reading video…')
  renderClips()
  syncActions()
}

function takeFile(file: File) {
  if (state.busy) return
  const looksLikeVideo = file.type.startsWith('video/') || /\.(mp4|mov|webm|mkv|m4v|avi)$/i.test(file.name)
  if (!looksLikeVideo) {
    setStatus('Choose a video file.', 'error')
    return
  }
  loadSource(file, file.name)
}

function timeFromClientX(clientX: number): number {
  const rect = track.getBoundingClientRect()
  if (rect.width <= 0) return 0
  return clamp((clientX - rect.left) / rect.width, 0, 1) * state.duration
}

function applyDrag(clientX: number) {
  const time = timeFromClientX(clientX)
  if (dragKind === 'scrub') {
    seekTo(time)
    return
  }
  if (dragKind === 'in') {
    state.draftStart = clamp(time, 0, Math.max(0, state.draftEnd - MIN_CLIP))
    seekTo(state.draftStart)
  } else if (dragKind === 'out') {
    state.draftEnd = clamp(time, Math.min(state.duration, state.draftStart + MIN_CLIP), state.duration)
    seekTo(state.draftEnd)
  }
  syncTimeInputs()
  renderTimeline()
}

function selectClip(id: string) {
  const clip = state.clips.find((item) => item.id === id)
  if (!clip) return
  state.selectedId = id
  state.draftStart = clip.start
  state.draftEnd = clip.end
  state.draftCrop = clip.crop ? { ...clip.crop } : null
  state.cropEnabled = clip.crop !== null
  cropToggle.checked = state.cropEnabled
  syncTimeInputs()
  renderTimeline()
  renderClips()
  renderCrop()
  layoutStage()
  syncActions()
  seekTo(clip.start)
}

function addClip() {
  const clip = clipFromDraft(`Clip ${clipSeq}`)
  if (!clip) return
  clipSeq += 1
  state.clips.push(clip)
  state.selectedId = clip.id
  renderClips()
  renderTimeline()
  syncActions()
  setStatus(`Clip ${state.clips.length} added.`, 'success')
  const nameInput = clipList.querySelector<HTMLInputElement>(`[data-name="${CSS.escape(clip.id)}"]`)
  nameInput?.focus()
  nameInput?.select()
}

function updateSelectedClip() {
  const index = state.clips.findIndex((item) => item.id === state.selectedId)
  if (index < 0) return
  const next = clipFromDraft(state.clips[index].name)
  if (!next) return
  next.id = state.clips[index].id
  state.clips[index] = next
  renderClips()
  renderTimeline()
  setStatus('Clip updated.', 'success')
}

function removeClip(id: string) {
  state.clips = state.clips.filter((item) => item.id !== id)
  if (state.selectedId === id) state.selectedId = null
  renderClips()
  renderTimeline()
  syncActions()
}

function setStartFromPlayhead() {
  const time = clamp(player.currentTime, 0, Math.max(0, state.duration - MIN_CLIP))
  state.draftStart = time
  if (state.draftEnd < time + MIN_CLIP) state.draftEnd = Math.min(state.duration, time + MIN_CLIP)
  syncTimeInputs()
  renderTimeline()
}

function setEndFromPlayhead() {
  const time = clamp(player.currentTime, Math.min(state.duration, state.draftStart + MIN_CLIP), state.duration)
  state.draftEnd = time
  if (state.draftStart > time - MIN_CLIP) state.draftStart = Math.max(0, time - MIN_CLIP)
  syncTimeInputs()
  renderTimeline()
}

function nudgeHandle(which: 'in' | 'out', delta: number) {
  if (which === 'in') {
    state.draftStart = clamp(state.draftStart + delta, 0, Math.max(0, state.draftEnd - MIN_CLIP))
    seekTo(state.draftStart)
  } else {
    state.draftEnd = clamp(state.draftEnd + delta, Math.min(state.duration, state.draftStart + MIN_CLIP), state.duration)
    seekTo(state.draftEnd)
  }
  syncTimeInputs()
  renderTimeline()
}

function clampRect(rect: NormRect): NormRect {
  const w = clamp(rect.w, MIN_CROP, 1)
  const h = clamp(rect.h, MIN_CROP, 1)
  return {
    x: clamp(rect.x, 0, 1 - w),
    y: clamp(rect.y, 0, 1 - h),
    w,
    h,
  }
}

function applyCropDelta(start: NormRect, mode: string, dx: number, dy: number): NormRect {
  let { x, y, w, h } = start
  if (mode === 'move') return clampRect({ x: x + dx, y: y + dy, w, h })

  const west = mode === 'w' || mode === 'nw' || mode === 'sw'
  const east = mode === 'e' || mode === 'ne' || mode === 'se'
  const north = mode === 'n' || mode === 'nw' || mode === 'ne'
  const south = mode === 's' || mode === 'sw' || mode === 'se'
  if (west) {
    x += dx
    w -= dx
  }
  if (east) w += dx
  if (north) {
    y += dy
    h -= dy
  }
  if (south) h += dy
  return clampRect({ x, y, w, h })
}

function toPixelCrop(rect: NormRect, vw: number, vh: number): PixelCrop | undefined {
  if (!vw || !vh) return undefined
  const x = clamp(Math.round(rect.x * vw), 0, Math.max(0, vw - 2))
  const y = clamp(Math.round(rect.y * vh), 0, Math.max(0, vh - 2))
  const width = clamp(Math.round(rect.w * vw), 2, vw - x)
  const height = clamp(Math.round(rect.h * vh), 2, vh - y)
  if (x <= 1 && y <= 1 && width >= vw - 2 && height >= vh - 2) return undefined
  return { x, y, width, height }
}

function clipFilename(raw: string, index: number, used: Set<string>): string {
  const cleaned = raw
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/\.gif$/i, '')
    .trim()
    .slice(0, 80)
  const base = cleaned || `Clip ${index + 1}`
  let filename = `${base}.gif`
  if (!used.has(filename.toLowerCase())) {
    used.add(filename.toLowerCase())
    return filename
  }

  let count = 2
  while (used.has(`${base}-${count}.gif`.toLowerCase())) count += 1
  filename = `${base}-${count}.gif`
  used.add(filename.toLowerCase())
  return filename
}

function clipFilenames(clips: Clip[]): string[] {
  const used = new Set<string>()
  return clips.map((clip, index) => clipFilename(clip.name, index, used))
}

function selectedPreset() {
  return GIF_PRESETS.find((item) => item.id === presetSelect.value) ?? DEFAULT_GIF_PRESET
}

function showProgress(ratio: number, label: string) {
  progressBlock.classList.remove('hidden')
  progressBar.style.width = `${Math.min(100, Math.round(ratio * 100))}%`
  progressText.textContent = label
}

async function loadRemote(media: ResolvedMedia) {
  setBusy(true)
  setStatus('Downloading video…')
  try {
    const blob = await fetchMediaBlob(media.url)
    const label = media.sourceLabel.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 40)
    loadSource(blob, `${label || media.id}.mp4`)
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Could not download that video.', 'error')
  } finally {
    setBusy(false)
  }
}

function renderPicker(items: ResolvedMedia[]) {
  picker.classList.remove('hidden')
  picker.innerHTML = `
    <p class="results-title">Choose a video</p>
    <div class="picker-list">
      ${items
        .map((item) => {
          const size = item.width && item.height ? ` · ${item.width}×${item.height}` : ''
          return `<button type="button" class="secondary" data-pick="${item.id}">${kindLabel(item.kind)}${size}</button>`
        })
        .join('')}
    </div>
  `
}

async function handleResolve() {
  if (state.busy) return
  const input = urlInput.value.trim()
  if (!input) {
    setStatus('Paste a link or upload a video.', 'error')
    return
  }

  setBusy(true)
  setStatus('Looking up post…')
  let toLoad: ResolvedMedia | null = null
  try {
    const media = await resolveTweetMedia(input)
    const videos = media.filter((item) => item.kind === 'video' || item.kind === 'gif')
    pendingMedia = videos
    if (videos.length === 0) {
      picker.classList.add('hidden')
      setStatus('That post has no video.', 'error')
      return
    }
    if (videos.length === 1) {
      picker.classList.add('hidden')
      toLoad = videos[0]
      return
    }
    renderPicker(videos)
    setStatus(`${videos.length} videos found. Choose one.`, 'success')
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Could not load that link.', 'error')
  } finally {
    setBusy(false)
  }

  if (toLoad) await loadRemote(toLoad)
}

async function handleConvert() {
  if (state.busy || !state.blob || state.clips.length === 0) return
  const preset = selectedPreset()
  const ranges: GifClipRange[] = state.clips.map((clip) => ({
    start: clip.start,
    end: Math.min(clip.end, state.duration),
    crop: clip.crop ? toPixelCrop(clip.crop, state.videoWidth, state.videoHeight) : undefined,
  }))

  player.pause()
  setBusy(true)
  setStatus('Converting…')
  showProgress(0, 'Loading converter…')

  try {
    const blobs = await convertClipsToGifs(state.blob, state.name, preset, ranges, (index, ratio) => {
      const overall = (index + ratio) / ranges.length
      showProgress(overall, `Clip ${index + 1} of ${ranges.length} · ${Math.round(ratio * 100)}%`)
    })

    const filenames = clipFilenames(state.clips)
    if (blobs.length === 1) {
      await downloadBlob(blobs[0], filenames[0])
      setStatus('GIF saved.', 'success')
    } else {
      const entries = []
      for (let index = 0; index < blobs.length; index += 1) {
        entries.push({
          name: filenames[index],
          data: new Uint8Array(await blobs[index].arrayBuffer()),
        })
      }
      await downloadBlob(zipStore(entries), 'clips.zip')
      setStatus(`${blobs.length} GIFs saved.`, 'success')
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Conversion failed.', 'error')
  } finally {
    progressBlock.classList.add('hidden')
    setBusy(false)
  }
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  fileInput.value = ''
  if (file) takeFile(file)
})

function draggingFiles(transfer: DataTransfer | null): boolean {
  return Array.from(transfer?.types ?? []).includes('Files')
}

document.addEventListener('dragover', (event) => {
  if (!draggingFiles(event.dataTransfer)) return
  event.preventDefault()
  dropZone.classList.add('dragover')
})

document.addEventListener('dragleave', (event) => {
  if (!event.relatedTarget) dropZone.classList.remove('dragover')
})

document.addEventListener('drop', (event) => {
  if (!draggingFiles(event.dataTransfer)) return
  event.preventDefault()
  dropZone.classList.remove('dragover')
  const file = event.dataTransfer?.files?.[0]
  if (file) takeFile(file)
})

resolveBtn.addEventListener('click', () => {
  void handleResolve()
})

urlInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') void handleResolve()
})

picker.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-pick]')
  if (!button?.dataset.pick || state.busy) return
  const media = pendingMedia.find((item) => item.id === button.dataset.pick)
  if (media) void loadRemote(media)
})

playBtn.addEventListener('click', () => {
  if (player.paused) void player.play()
  else player.pause()
})

player.addEventListener('click', () => {
  if (state.busy || state.duration <= 0) return
  if (player.paused) void player.play()
  else player.pause()
})

player.addEventListener('play', () => {
  playBtn.textContent = 'Pause'
})

player.addEventListener('pause', () => {
  playBtn.textContent = 'Play'
})

player.addEventListener('timeupdate', renderPlayhead)
player.addEventListener('seeked', renderPlayhead)

track.addEventListener('pointerdown', (event) => {
  if (state.busy || state.duration <= 0) return
  const target = event.target as HTMLElement
  if (target.closest('#handle-in')) dragKind = 'in'
  else if (target.closest('#handle-out')) dragKind = 'out'
  else {
    const bar = target.closest<HTMLElement>('[data-clip-id]')
    if (bar?.dataset.clipId) {
      selectClip(bar.dataset.clipId)
      return
    }
    dragKind = 'scrub'
  }
  track.setPointerCapture(event.pointerId)
  applyDrag(event.clientX)
  event.preventDefault()
})

track.addEventListener('pointermove', (event) => {
  if (!dragKind) return
  applyDrag(event.clientX)
})

track.addEventListener('pointerup', () => {
  dragKind = null
})

track.addEventListener('pointercancel', () => {
  dragKind = null
})

function onHandleKey(which: 'in' | 'out', event: KeyboardEvent) {
  const step = event.shiftKey ? 1 : 0.1
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  nudgeHandle(which, event.key === 'ArrowLeft' ? -step : step)
  event.preventDefault()
}

handleIn.addEventListener('keydown', (event) => onHandleKey('in', event))
handleOut.addEventListener('keydown', (event) => onHandleKey('out', event))

startInput.addEventListener('input', () => {
  const value = Number(startInput.value)
  if (!Number.isFinite(value)) return
  state.draftStart = clamp(value, 0, Math.max(0, state.draftEnd - MIN_CLIP))
  seekTo(state.draftStart)
  renderTimeline()
})

endInput.addEventListener('input', () => {
  const value = Number(endInput.value)
  if (!Number.isFinite(value)) return
  state.draftEnd = clamp(value, Math.min(state.duration, state.draftStart + MIN_CLIP), state.duration || value)
  seekTo(state.draftEnd)
  renderTimeline()
})

startInput.addEventListener('change', () => {
  const value = Number(startInput.value)
  if (Number.isFinite(value)) state.draftStart = clamp(value, 0, Math.max(0, state.draftEnd - MIN_CLIP))
  syncTimeInputs()
  seekTo(state.draftStart)
  renderTimeline()
})

endInput.addEventListener('change', () => {
  const value = Number(endInput.value)
  if (Number.isFinite(value)) {
    state.draftEnd = clamp(value, Math.min(state.duration, state.draftStart + MIN_CLIP), state.duration || value)
  }
  syncTimeInputs()
  seekTo(state.draftEnd)
  renderTimeline()
})

for (const input of [startInput, endInput]) {
  input.addEventListener('wheel', (event) => event.preventDefault(), { passive: false })
}

setStartBtn.addEventListener('click', setStartFromPlayhead)
setEndBtn.addEventListener('click', setEndFromPlayhead)

cropToggle.addEventListener('change', () => {
  state.cropEnabled = cropToggle.checked
  state.draftCrop = state.cropEnabled ? (state.draftCrop ?? { x: 0, y: 0, w: 1, h: 1 }) : null
  renderCrop()
  layoutStage()
})

cropBox.addEventListener('pointerdown', (event) => {
  if (!state.cropEnabled || !state.draftCrop || state.busy) return
  const handle = (event.target as HTMLElement).dataset.handle
  cropDrag = {
    mode: handle || 'move',
    originX: event.clientX,
    originY: event.clientY,
    start: { ...state.draftCrop },
  }
  cropBox.setPointerCapture(event.pointerId)
  event.preventDefault()
  event.stopPropagation()
})

cropBox.addEventListener('pointermove', (event) => {
  if (!cropDrag) return
  const bounds = cropLayer.getBoundingClientRect()
  if (bounds.width <= 0 || bounds.height <= 0) return
  const dx = (event.clientX - cropDrag.originX) / bounds.width
  const dy = (event.clientY - cropDrag.originY) / bounds.height
  state.draftCrop = applyCropDelta(cropDrag.start, cropDrag.mode, dx, dy)
  renderCrop()
})

cropBox.addEventListener('pointerup', () => {
  cropDrag = null
})

cropBox.addEventListener('pointercancel', () => {
  cropDrag = null
})

addClipBtn.addEventListener('click', addClip)
updateClipBtn.addEventListener('click', updateSelectedClip)

clipList.addEventListener('input', (event) => {
  const input = (event.target as HTMLElement).closest<HTMLInputElement>('[data-name]')
  if (!input?.dataset.name) return
  const clip = state.clips.find((item) => item.id === input.dataset.name)
  if (clip) clip.name = input.value
})

clipList.addEventListener('click', (event) => {
  if (state.busy) return
  const target = event.target as HTMLElement
  if (target.closest('[data-name]')) return
  const remove = target.closest<HTMLElement>('[data-remove]')
  if (remove?.dataset.remove) {
    removeClip(remove.dataset.remove)
    return
  }
  const select = target.closest<HTMLElement>('[data-select]')
  if (select?.dataset.select) selectClip(select.dataset.select)
})

convertBtn.addEventListener('click', () => {
  void handleConvert()
})

window.addEventListener('resize', () => layoutStage())

renderClips()
syncActions()
