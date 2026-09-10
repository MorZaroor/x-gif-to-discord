const FETCH_ATTEMPTS: RequestInit[] = [
  { credentials: 'omit' },
  { credentials: 'omit', referrerPolicy: 'no-referrer' },
  { credentials: 'omit', referrer: 'https://twitter.com/' },
]

export async function fetchMediaBlob(url: string): Promise<Blob> {
  let lastStatus = 0

  for (const init of FETCH_ATTEMPTS) {
    try {
      const response = await fetch(url, { ...init, mode: 'cors' })
      lastStatus = response.status
      if (response.ok) return await response.blob()
    } catch {
      // Try the next fetch strategy.
    }
  }

  if (lastStatus === 403) {
    throw new Error(
      'Twitter blocked the download (403). Open the tweet in X, right-click the video, and paste the direct video.twimg.com URL instead.',
    )
  }

  throw new Error(`Could not download media (${lastStatus || 'network error'}).`)
}
