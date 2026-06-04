import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const FINNHUB_BASE = 'https://finnhub.io/api/v1'
const TIMEOUT_MS = 8000

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 401 }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const tickers = searchParams.get('tickers')
  if (!tickers) return NextResponse.json({ error: 'tickers required', code: 400 }, { status: 400 })

  const apiKey = process.env.FINNHUB_API_KEY
  if (!apiKey) return NextResponse.json({ data: [], stale: true, error: 'FINNHUB_API_KEY not set' })

  const tickerList = tickers.split(',').map(t => t.trim()).filter(Boolean)

  try {
    const results = await Promise.all(
      tickerList.map(async (ticker) => {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
        try {
          const res = await fetch(
            `${FINNHUB_BASE}/quote?symbol=${ticker}&token=${apiKey}`,
            { signal: controller.signal, next: { revalidate: 30 } }
          )
          clearTimeout(timer)
          if (!res.ok) return null
          const q = await res.json()
          // c=현재가, d=변동액, dp=변동률, h=고가, l=저가, o=시가, pc=전일종가
          if (!q.c || q.c === 0) return null
          return {
            ticker,
            day: { c: q.c, o: q.o, h: q.h, l: q.l },
            prevDay: { c: q.pc },
            todaysChangePerc: q.dp,
            todaysChange: q.d,
          }
        } catch {
          clearTimeout(timer)
          return null
        }
      })
    )

    const data = results.filter(Boolean)
    const hasFailures = data.length < tickerList.length
    return NextResponse.json({ data, ...(hasFailures ? { stale: true } : {}) })
  } catch {
    return NextResponse.json({ data: [], stale: true, error: '데이터 지연 중' })
  }
}
