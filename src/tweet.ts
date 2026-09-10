import type { MediaKind, ResolvedMedia } from './types'

const TWEET_URL_RE =
  /(?:twitter\.com|x\.com|fxtwitter\.com|vxtwitter\.com|fixvx\.com)\/([^/?#]+)\/status\/(\d+)/i
const DIRECT_MP4_RE = /^https?:\/\/video\.twimg\.com\/.+\.mp4/i
const DIRECT_GIF_MP4_RE = /^https?:\/\/video\.twimg\.com\/tweet_video\/.+\.mp4/i
const DIRECT_IMAGE_RE = /^https?:\/\/pbs\.twimg\.com\/.+\.(?:jpg|jpeg|png|webp)/i

interface VxMediaItem {
  url: string
  type: 'image' | 'video' | 'gif'
  thumbnail_url?: string
  size?: { width: number; height: number }
  altText?: string
  duration_millis?: number
}

interface VxTweetResponse {
  tweetID?: string
  tweetURL?: string
  user_screen_name?: string
  media_extended?: VxMediaItem[]
  mediaURLs?: string[]
}

export function parseTweetUrl(input: string): { username: string; tweetId: string } | null {
  const trimmed = input.trim()
  const match = trimmed.match(TWEET_URL_RE)
  if (!match) return null
  return { username: match[1], tweetId: match[2] }
}

function classifyTwimgUrl(url: string): MediaKind {
  if (DIRECT_GIF_MP4_RE.test(url)) return 'gif'
  if (DIRECT_MP4_RE.test(url)) return 'video'
  return 'image'
}

function mapVxMedia(
  item: VxMediaItem,
  index: number,
  tweetId: string,
  sourceLabel: string,
): ResolvedMedia | null {
  if (!item.url) return null

  const kind: MediaKind =
    item.type === 'gif' ? 'gif' : item.type === 'video' ? 'video' : 'image'

  return {
    id: `${tweetId}-${index}`,
    url: item.url,
    kind,
    thumbnailUrl: item.thumbnail_url,
    width: item.size?.width,
    height: item.size?.height,
    altText: item.altText,
    durationMs: item.duration_millis,
    sourceLabel,
  }
}

export function resolveDirectMediaUrl(input: string): ResolvedMedia[] | null {
  const url = input.trim()
  if (!url.startsWith('http')) return null

  if (DIRECT_MP4_RE.test(url) || DIRECT_IMAGE_RE.test(url)) {
    const kind = classifyTwimgUrl(url)
    return [
      {
        id: 'direct-0',
        url,
        kind,
        sourceLabel: 'Direct URL',
      },
    ]
  }

  return null
}

export async function resolveTweetMedia(input: string): Promise<ResolvedMedia[]> {
  const direct = resolveDirectMediaUrl(input)
  if (direct) return direct

  const parsed = parseTweetUrl(input)
  if (!parsed) {
    throw new Error('Paste a Twitter/X status URL or a direct video.twimg.com / pbs.twimg.com link.')
  }

  const { username, tweetId } = parsed
  const apiUrl = `https://api.vxtwitter.com/${username}/status/${tweetId}`
  const response = await fetch(apiUrl)
  if (!response.ok) {
    throw new Error(`Could not load tweet (${response.status}). The post may be deleted or private.`)
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new Error('Tweet lookup failed. The post may be private, deleted, or temporarily unavailable.')
  }

  const data = (await response.json()) as VxTweetResponse
  const sourceLabel = data.user_screen_name
    ? `@${data.user_screen_name} / ${tweetId}`
    : tweetId

  const fromExtended =
    data.media_extended
      ?.map((item, index) => mapVxMedia(item, index, tweetId, sourceLabel))
      .filter((item): item is ResolvedMedia => item !== null) ?? []

  if (fromExtended.length > 0) {
    return fromExtended.filter((item) => item.kind !== 'image' || item.url.includes('twimg.com'))
  }

  const fallbackVideos =
    data.mediaURLs
      ?.filter((url) => DIRECT_MP4_RE.test(url))
      .map((url, index) => ({
        id: `${tweetId}-fallback-${index}`,
        url,
        kind: classifyTwimgUrl(url),
        sourceLabel,
      })) ?? []

  if (fallbackVideos.length > 0) return fallbackVideos

  throw new Error('No video or GIF media found in this tweet.')
}

export function kindLabel(kind: MediaKind): string {
  switch (kind) {
    case 'gif':
      return 'GIF'
    case 'video':
      return 'Video'
    case 'image':
      return 'Image'
  }
}
