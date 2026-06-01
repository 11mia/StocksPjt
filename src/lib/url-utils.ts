// NewsAPI free tier returns placeholder URLs for restricted articles
const BLOCKED_DOMAINS = [
  'example.com',
  'removed.com',
  'newsapi.org',
]

export function isValidArticleUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const { hostname } = new URL(url)
    return !BLOCKED_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d))
  } catch {
    return false
  }
}
