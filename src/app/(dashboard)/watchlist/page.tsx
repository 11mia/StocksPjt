'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface WatchlistItem {
  id: string
  ticker: string
  company: string | null
  added_at: string
}

interface Quote {
  ticker: string
  day?: { c: number; o: number }
  prevDay?: { c: number }
  todaysChangePerc?: number
}

interface Rating {
  rating: string
  price_target: number | null
  rated_at: string | null
}

interface RatingSummary {
  label: string
  strongBuy: number
  buy: number
  hold: number
  sell: number
  strongSell: number
  total: number
}

const ORDER_KEY = 'watchlist-order'
// Finnhub 서버 캐시 TTL(30s)과 맞춰 실제 새 데이터가 오는 최소 주기
const QUOTE_REFRESH_MS = 30_000

function getLatestRatingSummary(ratings: Rating[]): RatingSummary | null {
  if (!ratings.length) return null
  const map = new Map<string, RatingSummary>()
  for (const r of ratings) {
    const key = r.rated_at?.slice(0, 7) ?? 'unknown'
    if (!map.has(key)) {
      map.set(key, { label: key, strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0, total: 0 })
    }
    const p = map.get(key)!
    const count = r.price_target ?? 0
    const rStr = r.rating.toLowerCase()
    if (rStr === 'strongbuy')       { p.strongBuy  += count; p.total += count }
    else if (rStr === 'buy')        { p.buy        += count; p.total += count }
    else if (rStr === 'hold')       { p.hold       += count; p.total += count }
    else if (rStr === 'sell')       { p.sell       += count; p.total += count }
    else if (rStr === 'strongsell') { p.strongSell += count; p.total += count }
  }
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))[0]?.[1] ?? null
}

function formatAgo(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000)
  if (secs < 60) return `${secs}초 전`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}분 전`
  return `${Math.floor(mins / 60)}시간 전`
}

function RatingBar({ summary }: { summary: RatingSummary }) {
  const { strongBuy, buy, hold, sell, strongSell, total, label } = summary
  if (!total) return null
  const pct = (v: number) => `${(v / total) * 100}%`
  return (
    <div>
      <div className="flex justify-between text-xs text-zinc-400 mb-1.5">
        <span>기관 투자 의견 <span className="text-zinc-500 font-medium">{label}</span></span>
        <span>{total}명</span>
      </div>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-zinc-100" style={{ gap: '1px' }}>
        {strongBuy  > 0 && <div className="bg-green-600 h-full" style={{ width: pct(strongBuy) }} />}
        {buy        > 0 && <div className="bg-green-400 h-full" style={{ width: pct(buy) }} />}
        {hold       > 0 && <div className="bg-yellow-400 h-full" style={{ width: pct(hold) }} />}
        {sell       > 0 && <div className="bg-red-400 h-full" style={{ width: pct(sell) }} />}
        {strongSell > 0 && <div className="bg-red-600 h-full" style={{ width: pct(strongSell) }} />}
      </div>
      <div className="flex gap-2 mt-1.5 flex-wrap">
        {strongBuy  > 0 && <span className="text-xs text-zinc-500 flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-green-600 inline-block" />강력매수 {strongBuy}</span>}
        {buy        > 0 && <span className="text-xs text-zinc-500 flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />매수 {buy}</span>}
        {hold       > 0 && <span className="text-xs text-zinc-500 flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" />중립 {hold}</span>}
        {sell       > 0 && <span className="text-xs text-zinc-500 flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />매도 {sell}</span>}
        {strongSell > 0 && <span className="text-xs text-zinc-500 flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-red-600 inline-block" />강력매도 {strongSell}</span>}
      </div>
    </div>
  )
}

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistItem[]>([])
  const [orderedIds, setOrderedIds] = useState<string[]>([])
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  const [ratingsMap, setRatingsMap] = useState<Record<string, RatingSummary | null>>({})
  const [newTicker, setNewTicker] = useState('')
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [agoLabel, setAgoLabel] = useState('')

  // 드래그 상태
  const dragItem = useRef<number | null>(null)
  const dragOver = useRef<number | null>(null)
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null)
  const [dragTargetIdx, setDragTargetIdx] = useState<number | null>(null)

  // 인터벌 내 stale closure 방지용 ref
  const itemsRef = useRef<WatchlistItem[]>([])
  useEffect(() => { itemsRef.current = items }, [items])

  // ─── 데이터 패치 함수들 ───────────────────────────────────────────

  const fetchItems = useCallback(async (): Promise<WatchlistItem[]> => {
    const res = await fetch('/api/watchlist')
    const json = await res.json()
    if (!json.data) return []
    const fetched: WatchlistItem[] = json.data
    setItems(fetched)
    try {
      const saved = localStorage.getItem(ORDER_KEY)
      const savedIds: string[] = saved ? JSON.parse(saved) : []
      const existingIds = new Set(fetched.map(i => i.id))
      const filtered = savedIds.filter(id => existingIds.has(id))
      const missing = fetched.filter(i => !filtered.includes(i.id)).map(i => i.id)
      setOrderedIds([...filtered, ...missing])
    } catch {
      setOrderedIds(fetched.map(i => i.id))
    }
    return fetched
  }, [])

  const fetchQuotes = useCallback(async (tickers: string[]) => {
    if (!tickers.length) return
    const res = await fetch(`/api/watchlist/quotes?tickers=${tickers.join(',')}`)
    const json = await res.json()
    setStale(!!json.stale)
    const map: Record<string, Quote> = {}
    for (const q of json.data ?? []) map[q.ticker] = q
    setQuotes(map)
  }, [])

  const fetchRatings = useCallback(async (tickers: string[]) => {
    if (!tickers.length) return
    const results = await Promise.all(
      tickers.map(async ticker => {
        const res = await fetch(`/api/ratings?ticker=${ticker}`)
        const json = await res.json()
        return { ticker, ratings: (json.data ?? []) as Rating[] }
      })
    )
    const map: Record<string, RatingSummary | null> = {}
    for (const { ticker, ratings } of results) {
      map[ticker] = getLatestRatingSummary(ratings)
    }
    setRatingsMap(map)
  }, [])

  // 전체 갱신: items + quotes + ratings
  const refreshAll = useCallback(async () => {
    setRefreshing(true)
    try {
      const fetched = await fetchItems()
      const tickers = fetched.map(i => i.ticker)
      await Promise.all([fetchQuotes(tickers), fetchRatings(tickers)])
      setLastUpdated(new Date())
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }, [fetchItems, fetchQuotes, fetchRatings])

  // 시세만 갱신 (자동 폴링용)
  const refreshQuotesOnly = useCallback(async () => {
    const tickers = itemsRef.current.map(i => i.ticker)
    if (!tickers.length) return
    await fetchQuotes(tickers)
    setLastUpdated(new Date())
  }, [fetchQuotes])

  // ─── 마운트: 전체 갱신 (페이지 접속마다) ──────────────────────────
  useEffect(() => {
    refreshAll()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 자동 폴링: 30초마다 시세 갱신 (Finnhub 캐시 TTL 기준) ────────
  useEffect(() => {
    const id = setInterval(refreshQuotesOnly, QUOTE_REFRESH_MS)
    return () => clearInterval(id)
  }, [refreshQuotesOnly])

  // ─── "X초 전" 라벨 업데이트 ──────────────────────────────────────
  useEffect(() => {
    if (!lastUpdated) return
    setAgoLabel(formatAgo(lastUpdated))
    const id = setInterval(() => setAgoLabel(formatAgo(lastUpdated)), 5000)
    return () => clearInterval(id)
  }, [lastUpdated])

  // ─── 정렬된 아이템 목록 ──────────────────────────────────────────
  const orderedItems = orderedIds
    .map(id => items.find(i => i.id === id))
    .filter(Boolean) as WatchlistItem[]

  function saveOrder(ids: string[]) {
    localStorage.setItem(ORDER_KEY, JSON.stringify(ids))
  }

  // ─── 드래그앤드롭 ────────────────────────────────────────────────
  function handleDragStart(index: number) {
    dragItem.current = index
    setDraggingIdx(index)
  }

  function handleDragEnter(index: number) {
    dragOver.current = index
    setDragTargetIdx(index)
  }

  function handleDragEnd() {
    const from = dragItem.current
    const to = dragOver.current
    if (from !== null && to !== null && from !== to) {
      const newOrder = [...orderedIds]
      const [moved] = newOrder.splice(from, 1)
      newOrder.splice(to, 0, moved)
      setOrderedIds(newOrder)
      saveOrder(newOrder)
    }
    dragItem.current = null
    dragOver.current = null
    setDraggingIdx(null)
    setDragTargetIdx(null)
  }

  // ─── 티커 추가: 추가 후 전체 갱신 ───────────────────────────────
  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newTicker.trim()) return
    setAdding(true)
    setError(null)
    const res = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: newTicker.trim().toUpperCase() }),
    })
    const json = await res.json()
    if (json.error) {
      setError(json.error)
      setAdding(false)
    } else {
      setNewTicker('')
      setAdding(false)
      await refreshAll()
    }
  }

  async function handleDelete(ticker: string, id: string) {
    await fetch(`/api/watchlist/${ticker}`, { method: 'DELETE' })
    setItems(prev => prev.filter(i => i.id !== id))
    setOrderedIds(prev => {
      const next = prev.filter(oid => oid !== id)
      saveOrder(next)
      return next
    })
  }

  if (loading) return <div className="p-8 text-zinc-500">로딩 중...</div>

  return (
    <div className="max-w-6xl mx-auto">

      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">Watchlist</h1>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-zinc-400">{agoLabel} 업데이트</span>
          )}
          <button
            onClick={refreshAll}
            disabled={refreshing}
            title="새로고침"
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-zinc-600 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 hover:border-zinc-300 disabled:opacity-50 transition-all"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={refreshing ? 'animate-spin' : ''}
            >
              <path d="M13 2v4h-4" />
              <path d="M1 12v-4h4" />
              <path d="M11.5 5A5.5 5.5 0 0 0 2.5 5" />
              <path d="M2.5 9a5.5 5.5 0 0 0 9 0" />
            </svg>
            {refreshing ? '갱신 중...' : '새로고침'}
          </button>
        </div>
      </div>

      {/* 티커 추가 폼 */}
      <form onSubmit={handleAdd} className="flex gap-2 mb-6">
        <input
          type="text"
          placeholder="티커 입력 (예: AAPL)"
          value={newTicker}
          onChange={e => setNewTicker(e.target.value.toUpperCase())}
          className="flex-1 max-w-xs px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={adding || refreshing}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {adding ? '추가 중...' : '추가'}
        </button>
      </form>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
      {stale && (
        <p className="text-sm text-amber-600 mb-4 bg-amber-50 px-3 py-2 rounded-lg">
          ⚠ 데이터 지연 중 — 시세 정보가 최신이 아닐 수 있습니다
        </p>
      )}

      {orderedItems.length === 0 ? (
        <p className="text-zinc-500 text-sm">관심 종목이 없습니다. 위에서 추가해보세요.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {orderedItems.map((item, index) => {
            const q = quotes[item.ticker]
            const price = q?.day?.c ?? q?.prevDay?.c
            const change = q?.todaysChangePerc
            const rating = ratingsMap[item.ticker]
            const isDragging = draggingIdx === index
            const isTarget = dragTargetIdx === index && draggingIdx !== index

            return (
              <div
                key={item.id}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragEnter={() => handleDragEnter(index)}
                onDragEnd={handleDragEnd}
                onDragOver={e => e.preventDefault()}
                className={`relative bg-white rounded-xl border p-4 cursor-grab active:cursor-grabbing select-none transition-all duration-150 ${
                  isDragging
                    ? 'opacity-40 scale-95 border-blue-300 shadow-none'
                    : isTarget
                    ? 'border-blue-400 shadow-lg ring-2 ring-blue-200'
                    : 'border-zinc-200 hover:shadow-sm hover:border-zinc-300'
                }`}
              >
                {/* 삭제 버튼 */}
                <button
                  onClick={() => handleDelete(item.ticker, item.id)}
                  className="absolute top-3 right-3 w-6 h-6 flex items-center justify-center text-zinc-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                  title="삭제"
                >
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="1" y1="1" x2="10" y2="10" />
                    <line x1="10" y1="1" x2="1" y2="10" />
                  </svg>
                </button>

                {/* 티커 + 시세 */}
                <div className="mb-3 pr-7">
                  <div className="flex items-baseline gap-2">
                    <span className="text-lg font-bold text-zinc-900 leading-none">{item.ticker}</span>
                    {item.company && (
                      <span className="text-xs text-zinc-400 truncate max-w-[130px]">{item.company}</span>
                    )}
                  </div>
                  {price !== undefined ? (
                    <div className="mt-1.5 flex items-baseline gap-2">
                      <span className="text-2xl font-semibold text-zinc-900">${price.toFixed(2)}</span>
                      {change !== undefined && (
                        <span className={`text-sm font-medium ${change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-400 mt-1.5">시세 불러오는 중...</p>
                  )}
                </div>

                {/* 기관 투자 의견 */}
                <div className="border-t border-zinc-100 pt-3">
                  {rating !== undefined ? (
                    rating ? <RatingBar summary={rating} /> : (
                      <p className="text-xs text-zinc-400">기관 투자 의견 없음</p>
                    )
                  ) : (
                    <p className="text-xs text-zinc-400">로딩 중...</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
