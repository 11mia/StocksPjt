import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
const POLYGON_BASE = 'https://api.polygon.io'

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized', code: 401 }, { status: 401 })
    }
  }

  const supabase = createAdminClient()

  try {
    // 현재 watchlist에 있는 모든 고유 ticker 조회
    const { data: watchlistItems } = await supabase
      .from('watchlist_items')
      .select('ticker')

    if (!watchlistItems?.length) {
      return NextResponse.json({ data: { collected: 0 } })
    }

    const tickers = [...new Set(watchlistItems.map(w => w.ticker))]
    const ratings = []

    for (const ticker of tickers.slice(0, 10)) { // 최대 10개 (API 한도 고려)
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 5000)

        const res = await fetch(
          `${POLYGON_BASE}/v2/reference/financials/${ticker}?apiKey=${process.env.POLYGON_API_KEY}`,
          { signal: controller.signal }
        )
        clearTimeout(timer)

        if (!res.ok) continue
        const json = await res.json()

        // Polygon analyst ratings (simplyfied mock for free tier)
        if (json.results?.length) {
          ratings.push({
            ticker,
            firm: 'Polygon.io',
            rating: 'hold',
            price_target: null,
            rated_at: new Date().toISOString(),
          })
        }
      } catch {
        // 개별 ticker 실패는 무시
      }
    }

    if (ratings.length > 0) {
      await supabase.from('institutional_ratings').insert(ratings)
    }

    return NextResponse.json({ data: { collected: ratings.length } })
  } catch (err) {
    return NextResponse.json({ error: String(err), code: 500 }, { status: 500 })
  }
}
