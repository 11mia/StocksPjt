'use client'

interface Analysis {
  id: string
  summary: string
  impact_score: number
  impact_label: string
  scenario: string
}

const LABEL_COLORS: Record<string, string> = {
  '강한 호재': 'text-green-700 bg-green-50',
  '호재': 'text-green-600 bg-green-50',
  '중립': 'text-zinc-600 bg-zinc-100',
  '악재': 'text-red-600 bg-red-50',
  '강한 악재': 'text-red-700 bg-red-50',
}

interface Props {
  ticker: string
  analysis: Analysis | null
  loading: boolean
  error: string | null
  onAnalyze: () => void
}

export default function AIAnalysisPanel({ ticker, analysis, loading, error, onAnalyze }: Props) {
  const scoreColor = analysis
    ? analysis.impact_score > 20 ? 'text-green-600'
    : analysis.impact_score < -20 ? 'text-red-600'
    : 'text-zinc-600'
    : ''

  return (
    <div className="p-4 bg-white rounded-xl border border-zinc-200">
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-zinc-900 text-sm">{ticker}</span>
        {analysis && (
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${LABEL_COLORS[analysis.impact_label] ?? 'text-zinc-600 bg-zinc-100'}`}>
            {analysis.impact_label}
          </span>
        )}
      </div>

      {loading && <p className="text-xs text-zinc-400">AI 분석 중...</p>}

      {!loading && !analysis && !error && (
        <button onClick={onAnalyze} className="text-xs text-blue-600 hover:underline">
          AI 분석 실행
        </button>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      {analysis && (
        <div className="mt-2 flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span data-testid="impact-score" className={`text-base font-bold ${scoreColor}`}>
              {analysis.impact_score > 0 ? '+' : ''}{analysis.impact_score}
            </span>
            <span className="text-xs text-zinc-400">영향 점수</span>
          </div>
          <p className="text-xs text-zinc-700 leading-relaxed">{analysis.summary}</p>
          <p className="text-xs text-zinc-500 leading-relaxed mt-1">{analysis.scenario}</p>
        </div>
      )}
    </div>
  )
}
