import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const FINNHUB_BASE = 'https://finnhub.io/api/v1'

async function fetchAndStoreRatings(ticker: string): Promise<object[]> {
  const apiKey = process.env.FINNHUB_API_KEY
  if (!apiKey) return []

  try {
    const res = await fetch(
      `${FINNHUB_BASE}/stock/recommendation?symbol=${ticker}&token=${apiKey}`,
      { next: { revalidate: 0 } }
    )
    if (!res.ok) return []
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) return []

    const recent = data.slice(0, 3) as Array<{
      period: string
      buy: number
      strongBuy: number
      hold: number
      sell: number
      strongSell: number
    }>

    const admin = createAdminClient()
    await admin.from('institutional_ratings').delete()
      .eq('ticker', ticker)
      .eq('firm', 'Finnhub Consensus')

    const rows = recent.flatMap(r => [
      { ticker, firm: 'Finnhub Consensus', rating: 'strongBuy',  price_target: r.strongBuy,  rated_at: r.period },
      { ticker, firm: 'Finnhub Consensus', rating: 'buy',        price_target: r.buy,        rated_at: r.period },
      { ticker, firm: 'Finnhub Consensus', rating: 'hold',       price_target: r.hold,       rated_at: r.period },
      { ticker, firm: 'Finnhub Consensus', rating: 'sell',       price_target: r.sell,       rated_at: r.period },
      { ticker, firm: 'Finnhub Consensus', rating: 'strongSell', price_target: r.strongSell, rated_at: r.period },
    ]).filter(row => (row.price_target ?? 0) > 0)

    if (rows.length > 0) {
      await admin.from('institutional_ratings').insert(rows)
    }
    return rows
  } catch {
    return []
  }
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 401 }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const ticker = searchParams.get('ticker')
  if (!ticker) return NextResponse.json({ error: 'ticker required', code: 400 }, { status: 400 })

  const sym = ticker.toUpperCase()

  const { data, error } = await supabase
    .from('institutional_ratings')
    .select('*')
    .eq('ticker', sym)
    .order('rated_at', { ascending: false })
    .limit(20)

  if (error) return NextResponse.json({ error: error.message, code: 500 }, { status: 500 })

  // DB에 데이터 없으면 Finnhub에서 즉시 수집 후 반환
  if (!data || data.length === 0) {
    const fresh = await fetchAndStoreRatings(sym)
    return NextResponse.json({ data: fresh })
  }

  return NextResponse.json({ data })
}
