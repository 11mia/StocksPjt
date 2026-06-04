import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

const FINNHUB_BASE = 'https://finnhub.io/api/v1'

function checkAuth(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return request.headers.get('authorization') === `Bearer ${secret}`
}

async function runCollect() {
  const supabase = createAdminClient()
  const apiKey = process.env.FINNHUB_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'FINNHUB_API_KEY not set' }, { status: 500 })

  const { data: watchlistItems } = await supabase
    .from('watchlist_items')
    .select('ticker')
  if (!watchlistItems?.length) return NextResponse.json({ data: { collected: 0 } })

  const tickers = [...new Set(watchlistItems.map(w => w.ticker))]
  let collected = 0

  for (const ticker of tickers.slice(0, 20)) {
    try {
      const res = await fetch(
        `${FINNHUB_BASE}/stock/recommendation?symbol=${ticker}&token=${apiKey}`,
        { next: { revalidate: 0 } }
      )
      if (!res.ok) continue
      const data = await res.json()
      if (!Array.isArray(data) || data.length === 0) continue

      // 최근 3개월 데이터만 사용
      const recent = data.slice(0, 3) as Array<{
        period: string
        buy: number
        strongBuy: number
        hold: number
        sell: number
        strongSell: number
      }>

      // 기존 데이터 삭제 후 재삽입
      await supabase
        .from('institutional_ratings')
        .delete()
        .eq('ticker', ticker)
        .eq('firm', 'Finnhub Consensus')

      const rows = recent.flatMap(r => [
        { ticker, firm: 'Finnhub Consensus', rating: 'strongBuy', price_target: r.strongBuy, rated_at: r.period },
        { ticker, firm: 'Finnhub Consensus', rating: 'buy',       price_target: r.buy,       rated_at: r.period },
        { ticker, firm: 'Finnhub Consensus', rating: 'hold',      price_target: r.hold,      rated_at: r.period },
        { ticker, firm: 'Finnhub Consensus', rating: 'sell',      price_target: r.sell,      rated_at: r.period },
        { ticker, firm: 'Finnhub Consensus', rating: 'strongSell',price_target: r.strongSell,rated_at: r.period },
      ]).filter(row => (row.price_target ?? 0) > 0)

      if (rows.length > 0) {
        await supabase.from('institutional_ratings').insert(rows)
        collected++
      }
    } catch {
      // 개별 ticker 실패 무시
    }
  }

  return NextResponse.json({ data: { collected } })
}

export async function GET(request: Request) {
  if (!checkAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return runCollect()
}

export async function POST(request: Request) {
  if (!checkAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return runCollect()
}
