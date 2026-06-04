'use client'

import { useState, useEffect } from 'react'

interface Rating {
  id: string
  rating: string
  price_target: number | null
  rated_at: string | null
}

type Period = {
  label: string
  strongBuy: number
  buy: number
  hold: number
  sell: number
  strongSell: number
  total: number
}

function buildPeriods(ratings: Rating[]): Period[] {
  const map = new Map<string, Period>()
  for (const r of ratings) {
    const key = r.rated_at?.slice(0, 7) ?? 'unknown'
    if (!map.has(key)) {
      map.set(key, { label: key, strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0, total: 0 })
    }
    const p = map.get(key)!
    const count = r.price_target ?? 0
    const rating = r.rating.toLowerCase()
    if (rating === 'strongbuy')  { p.strongBuy  += count; p.total += count }
    else if (rating === 'buy')   { p.buy        += count; p.total += count }
    else if (rating === 'hold')  { p.hold       += count; p.total += count }
    else if (rating === 'sell')  { p.sell       += count; p.total += count }
    else if (rating === 'strongsell') { p.strongSell += count; p.total += count }
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([, v]) => v)
}

function Bar({ value, total, color }: { value: number; total: number; color: string }) {
  if (!value || !total) return null
  return (
    <div
      className={`${color} h-full transition-all`}
      style={{ width: `${(value / total) * 100}%` }}
    />
  )
}

export default function RatingsChart({ ticker }: { ticker: string }) {
  const [ratings, setRatings] = useState<Rating[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/ratings?ticker=${ticker}`)
      .then(r => r.json())
      .then(json => {
        setRatings(json.data ?? [])
        setLoading(false)
      })
  }, [ticker])

  if (loading) return <div className="text-sm text-zinc-400 py-4">기관 평가 로딩 중...</div>

  const periods = buildPeriods(ratings)

  if (periods.length === 0) {
    return (
      <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200">
        <h2 className="font-semibold text-zinc-900 mb-1">기관 투자 의견</h2>
        <p className="text-sm text-zinc-400">데이터 없음</p>
      </div>
    )
  }

  const latest = periods[0]

  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-4 mb-4">
      <h2 className="font-semibold text-zinc-900 mb-3">기관 투자 의견 (Finnhub Consensus)</h2>

      {/* 최신 월 요약 */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-zinc-500 font-medium">{latest.label} · 총 {latest.total}명</span>
          <div className="flex gap-3 text-xs text-zinc-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-600 inline-block"/>강력매수 {latest.strongBuy}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block"/>매수 {latest.buy}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block"/>중립 {latest.hold}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block"/>매도 {latest.sell}</span>
            {latest.strongSell > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-600 inline-block"/>강력매도 {latest.strongSell}</span>}
          </div>
        </div>
        <div className="flex h-5 rounded-full overflow-hidden gap-px bg-zinc-100">
          <Bar value={latest.strongBuy}  total={latest.total} color="bg-green-600" />
          <Bar value={latest.buy}        total={latest.total} color="bg-green-400" />
          <Bar value={latest.hold}       total={latest.total} color="bg-yellow-400" />
          <Bar value={latest.sell}       total={latest.total} color="bg-red-400" />
          <Bar value={latest.strongSell} total={latest.total} color="bg-red-600" />
        </div>
      </div>

      {/* 월별 추이 */}
      {periods.length > 1 && (
        <div>
          <p className="text-xs text-zinc-400 mb-2">월별 추이</p>
          <div className="flex flex-col gap-2">
            {periods.map(p => (
              <div key={p.label}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs text-zinc-500 w-16">{p.label}</span>
                  <span className="text-xs text-zinc-400">{p.total}명</span>
                </div>
                <div className="flex h-3 rounded-full overflow-hidden gap-px bg-zinc-100">
                  <Bar value={p.strongBuy}  total={p.total} color="bg-green-600" />
                  <Bar value={p.buy}        total={p.total} color="bg-green-400" />
                  <Bar value={p.hold}       total={p.total} color="bg-yellow-400" />
                  <Bar value={p.sell}       total={p.total} color="bg-red-400" />
                  <Bar value={p.strongSell} total={p.total} color="bg-red-600" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
