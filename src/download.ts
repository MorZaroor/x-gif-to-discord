export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

import { fetchMediaBlob } from './media-fetch'

export async function downloadFromUrl(sourceUrl: string, filename: string): Promise<void> {
  const blob = await fetchMediaBlob(sourceUrl)
  await downloadBlob(blob, filename)
}

export function suggestedFilename(
  base: string,
  extension: 'gif' | 'mp4' | 'bin',
): string {
  const safe = base.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80)
  return `${safe || 'twitter-media'}.${extension}`
}
