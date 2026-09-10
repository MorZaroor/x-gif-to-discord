import './style.css'
import { downloadBlob, downloadFromUrl, suggestedFilename } from './download'
import { convertToGif, convertToMp4 } from './ffmpeg-client'
import {
  DEFAULT_GIF_PRESET,
  DEFAULT_MP4_PRESET,
  GIF_PRESETS,
  MP4_PRESETS,
} from './presets'
import { kindLabel, resolveTweetMedia } from './tweet'
import type { GifPreset, Mp4Preset, ResolvedMedia } from './types'

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
  <div class="page">
    <header class="header">
      <div class="brand">
        <span class="brand-icon" aria-hidden="true">𝕏</span>
      </div>
      <h1>X GIF to Discord</h1>
      <p class="tagline">Paste a post link, download the media, or convert it for Discord.</p>
    </header>

    <section class="panel">
      <div class="input-row">
        <input
          id="tweet-url"
          type="url"
          placeholder="https://x.com/user/status/…"
          autocomplete="off"
          spellcheck="false"
        />
        <button id="resolve-btn" type="button" class="primary">Go</button>
      </div>
      <p id="status" class="status" role="status" aria-live="polite"></p>
    </section>

    <section id="media-panel" class="results hidden">
      <p class="results-title">Media</p>
      <div id="media-list"></div>
    </section>

    <footer class="footer">
      <p>Runs in your browser · by M.Z / Beany</p>
    </footer>
  </div>
`

const urlInput = document.querySelector<HTMLInputElement>('#tweet-url')!
const resolveBtn = document.querySelector<HTMLButtonElement>('#resolve-btn')!
const statusEl = document.querySelector<HTMLParagraphElement>('#status')!
const mediaPanel = document.querySelector<HTMLElement>('#media-panel')!
const mediaList = document.querySelector<HTMLElement>('#media-list')!

let activeMedia: ResolvedMedia[] = []
let busy = false

function setStatus(message: string, tone: 'info' | 'error' | 'success' = 'info') {
  statusEl.textContent = message
  statusEl.dataset.tone = tone
}

function setBusy(next: boolean, message?: string) {
  busy = next
  resolveBtn.disabled = next
  if (message) setStatus(message)
}

function renderPresetOptions<T extends { id: string; label: string; description: string }>(
  presets: T[],
  selectedId: string,
): string {
  return presets
    .map(
      (preset) =>
        `<option value="${preset.id}" ${preset.id === selectedId ? 'selected' : ''}>${preset.label} — ${preset.description}</option>`,
    )
    .join('')
}

function renderMediaCard(media: ResolvedMedia): string {
  const isVideo = media.kind === 'gif' || media.kind === 'video'
  const preview = isVideo
    ? `<video src="${media.url}" controls loop muted playsinline crossorigin="anonymous" referrerpolicy="no-referrer" class="preview-video"></video>`
    : `<img src="${media.url}" alt="${media.altText ?? ''}" crossorigin="anonymous" referrerpolicy="no-referrer" class="preview-image" />`

  const meta = [
    kindLabel(media.kind),
    media.width && media.height ? `${media.width}×${media.height}` : null,
    media.durationMs ? `${(media.durationMs / 1000).toFixed(1)}s` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const convertSection = isVideo
    ? `
      <div class="convert-grid">
        <div class="convert-block">
          <label>GIF quality</label>
          <select data-preset="gif" class="preset-select">${renderPresetOptions(GIF_PRESETS, DEFAULT_GIF_PRESET.id)}</select>
          <button type="button" class="secondary" data-action="convert-gif" data-id="${media.id}">Save as GIF</button>
        </div>
        <div class="convert-block">
          <label>MP4 quality</label>
          <select data-preset="mp4" class="preset-select">${renderPresetOptions(MP4_PRESETS, DEFAULT_MP4_PRESET.id)}</select>
          <button type="button" class="secondary" data-action="convert-mp4" data-id="${media.id}">Save as MP4</button>
        </div>
      </div>
    `
    : ''

  return `
    <article class="media-card" data-media-id="${media.id}">
      <div class="media-preview">${preview}</div>
      <div class="media-body">
        <p class="media-meta">${meta}</p>
        <p class="media-source">${media.sourceLabel}</p>
        <div class="actions">
          <button type="button" class="primary" data-action="download" data-id="${media.id}">Download</button>
        </div>
        ${convertSection}
        <div class="progress hidden" data-progress>
          <div class="progress-bar"><span></span></div>
          <p class="progress-text">Preparing…</p>
        </div>
      </div>
    </article>
  `
}

function renderMedia() {
  if (activeMedia.length === 0) {
    mediaPanel.classList.add('hidden')
    mediaList.innerHTML = ''
    return
  }

  mediaPanel.classList.remove('hidden')
  mediaList.innerHTML = activeMedia.map(renderMediaCard).join('')
}

function getMediaById(id: string): ResolvedMedia {
  const media = activeMedia.find((item) => item.id === id)
  if (!media) throw new Error('Media not found')
  return media
}

function getMediaCard(mediaId: string): HTMLElement | null {
  return mediaList.querySelector(`[data-media-id="${CSS.escape(mediaId)}"]`)
}

function getSelectedGifPreset(mediaId: string): GifPreset {
  const select = getMediaCard(mediaId)?.querySelector<HTMLSelectElement>('select[data-preset="gif"]')
  const preset = GIF_PRESETS.find((item) => item.id === select?.value)
  return preset ?? DEFAULT_GIF_PRESET
}

function getSelectedMp4Preset(mediaId: string): Mp4Preset {
  const select = getMediaCard(mediaId)?.querySelector<HTMLSelectElement>('select[data-preset="mp4"]')
  const preset = MP4_PRESETS.find((item) => item.id === select?.value)
  return preset ?? DEFAULT_MP4_PRESET
}

function showProgress(mediaId: string, ratio: number, label: string) {
  const block = getMediaCard(mediaId)?.querySelector<HTMLElement>('[data-progress]')
  if (!block) return
  block.classList.remove('hidden')
  const bar = block.querySelector<HTMLSpanElement>('.progress-bar span')
  const text = block.querySelector<HTMLParagraphElement>('.progress-text')
  if (bar) bar.style.width = `${Math.min(100, Math.round(ratio * 100))}%`
  if (text) text.textContent = label
}

function hideProgress(mediaId: string) {
  const block = getMediaCard(mediaId)?.querySelector<HTMLElement>('[data-progress]')
  block?.classList.add('hidden')
}

async function handleResolve() {
  if (busy) return
  const input = urlInput.value.trim()
  if (!input) {
    setStatus('Paste a link first.', 'error')
    return
  }

  setBusy(true, 'Looking up post…')
  try {
    activeMedia = await resolveTweetMedia(input)
    renderMedia()
    setStatus(
      activeMedia.length === 1 ? 'Ready to download or convert.' : `${activeMedia.length} items found.`,
      'success',
    )
  } catch (error) {
    activeMedia = []
    renderMedia()
    setStatus(error instanceof Error ? error.message : 'Could not load that link.', 'error')
  } finally {
    setBusy(false)
  }
}

async function handleDownload(media: ResolvedMedia) {
  if (busy) return
  setBusy(true, 'Downloading…')
  try {
    const ext = media.kind === 'image' ? 'bin' : 'mp4'
    await downloadFromUrl(media.url, suggestedFilename(media.id, ext))
    setStatus('Download started.', 'success')
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Download failed.', 'error')
  } finally {
    setBusy(false)
  }
}

async function handleConvertGif(media: ResolvedMedia) {
  if (busy) return
  const preset = getSelectedGifPreset(media.id)
  setBusy(true, 'Converting to GIF…')
  showProgress(media.id, 0, 'Starting…')

  try {
    const blob = await convertToGif(media.url, preset, (ratio) => {
      showProgress(media.id, ratio, `Converting… ${Math.round(ratio * 100)}%`)
    })
    await downloadBlob(blob, suggestedFilename(`${media.id}-${preset.id}`, 'gif'))
    setStatus('GIF saved.', 'success')
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Conversion failed.', 'error')
  } finally {
    hideProgress(media.id)
    setBusy(false)
  }
}

async function handleConvertMp4(media: ResolvedMedia) {
  if (busy) return
  const preset = getSelectedMp4Preset(media.id)
  setBusy(true, 'Converting to MP4…')
  showProgress(media.id, 0, 'Starting…')

  try {
    const blob = await convertToMp4(media.url, preset, (ratio) => {
      showProgress(media.id, ratio, `Converting… ${Math.round(ratio * 100)}%`)
    })
    await downloadBlob(blob, suggestedFilename(`${media.id}-${preset.id}`, 'mp4'))
    setStatus('MP4 saved.', 'success')
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Conversion failed.', 'error')
  } finally {
    hideProgress(media.id)
    setBusy(false)
  }
}

resolveBtn.addEventListener('click', () => {
  void handleResolve()
})

urlInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') void handleResolve()
})

mediaList.addEventListener('click', (event) => {
  const target = event.target as HTMLElement
  const button = target.closest<HTMLButtonElement>('button[data-action]')
  if (!button || busy) return

  const action = button.dataset.action
  const id = button.dataset.id
  if (!action || !id) return

  const media = getMediaById(id)
  if (action === 'download') void handleDownload(media)
  if (action === 'convert-gif') void handleConvertGif(media)
  if (action === 'convert-mp4') void handleConvertMp4(media)
})
