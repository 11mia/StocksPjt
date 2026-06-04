'use client'

import { useState, useEffect, useCallback } from 'react'
import AIAnalysisPanel from './AIAnalysisPanel'

interface Analysis {
  id: string
  summary: string
  impact_score: number
  impact_label: string
  scenario: string
}

type TickerState = {
  analysis: Analysis | null
  loading: boolean
  error: string | null
}

export default function AIAnalysisList({ tickers, issueId }: { tickers: string[]; issueId: string }) {
  const [states, setStates] = useState<Record<string, TickerState>>(() =>
    Object.fromEntries(tickers.map(t => [t, { analysis: null, loading: true, error: null }]))
  )

  const fetchAnalysis = useCallback(async (ticker: string) => {
    setStates(prev => ({ ...prev, [ticker]: { ...prev[ticker], loading: true, error: null } }))
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issue_id: issueId, ticker }),
      })
      const json = await res.json()
      setStates(prev => ({
        ...prev,
        [ticker]: { analysis: json.data ?? null, loading: false, error: json.error ?? null },
      }))
    } catch {
      setStates(prev => ({
        ...prev,
        [ticker]: { analysis: null, loading: false, error: '분석을 불러올 수 없습니다' },
      }))
    }
  }, [issueId])

  // 마운트 시 모든 티커 병렬 fetch
  useEffect(() => {
    tickers.forEach(ticker => fetchAnalysis(ticker))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 점수 내림차순 정렬: 분석 완료된 것 우선, 점수 높은 순
  const sorted = [...tickers].sort((a, b) => {
    const sa = states[a]?.analysis?.impact_score
    const sb = states[b]?.analysis?.impact_score
    if (sa == null && sb == null) return 0
    if (sa == null) return 1
    if (sb == null) return -1
    return sb - sa
  })

  return (
    <div className="flex flex-col gap-3">
      {sorted.map(ticker => (
        <AIAnalysisPanel
          key={ticker}
          ticker={ticker}
          analysis={states[ticker]?.analysis ?? null}
          loading={states[ticker]?.loading ?? false}
          error={states[ticker]?.error ?? null}
          onAnalyze={() => fetchAnalysis(ticker)}
        />
      ))}
    </div>
  )
}
