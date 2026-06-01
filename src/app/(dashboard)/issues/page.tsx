'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { isValidArticleUrl } from '@/lib/url-utils'

interface Issue {
  id: string
  title: string
  source_url: string | null
  category: string
  published_at: string | null
  korean_summary: string | null
}

const CATEGORIES = ['전체', 'geopolitical', 'macro', 'supply_chain', 'political']
const CATEGORY_LABELS: Record<string, string> = {
  geopolitical: '지정학',
  macro: '거시경제',
  supply_chain: '공급망',
  political: '정치',
  '전체': '전체',
}
const CATEGORY_COLORS: Record<string, string> = {
  geopolitical: 'bg-red-100 text-red-700',
  macro: 'bg-blue-100 text-blue-700',
  supply_chain: 'bg-amber-100 text-amber-700',
  political: 'bg-purple-100 text-purple-700',
}

function IssueList({ category }: { category: string }) {
  const [issues, setIssues] = useState<Issue[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const url =
      category === '전체'
        ? '/api/issues/with-summaries'
        : `/api/issues/with-summaries?category=${category}`
    fetch(url)
      .then(r => r.json())
      .then(json => {
        setIssues(json.data ?? [])
        setLoading(false)
      })
      .catch(() => {
        setIssues([])
        setLoading(false)
      })
  }, [category])

  if (loading || issues === null) {
    return (
      <div className="flex flex-col gap-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-zinc-200 p-4 animate-pulse">
            <div className="h-4 bg-zinc-200 rounded w-3/4 mb-2" />
            <div className="h-3 bg-zinc-100 rounded w-full mb-1" />
            <div className="h-3 bg-zinc-100 rounded w-2/3" />
          </div>
        ))}
      </div>
    )
  }

  if (issues.length === 0) return <p className="text-zinc-500 text-sm">이슈가 없습니다.</p>

  return (
    <ul className="flex flex-col gap-3">
      {issues.map(issue => (
        <li key={issue.id}>
          <div className="bg-white rounded-xl border border-zinc-200 hover:border-blue-300 hover:shadow-sm transition-all p-4">
            <div className="flex items-start justify-between gap-2 mb-2">
              <Link
                href={`/issues/${issue.id}`}
                className="text-sm font-semibold text-zinc-900 leading-snug hover:text-blue-700 transition-colors"
              >
                {issue.title}
              </Link>
              <span
                className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                  CATEGORY_COLORS[issue.category] ?? 'bg-zinc-100 text-zinc-600'
                }`}
              >
                {CATEGORY_LABELS[issue.category] ?? issue.category}
              </span>
            </div>

            {issue.korean_summary ? (
              <p className="text-sm text-zinc-600 leading-relaxed mb-2">{issue.korean_summary}</p>
            ) : (
              <p className="text-xs text-zinc-400 italic mb-2">요약 생성 중...</p>
            )}

            <div className="flex items-center justify-between">
              {issue.published_at && (
                <span className="text-xs text-zinc-400">
                  {new Date(issue.published_at).toLocaleString('ko-KR')}
                </span>
              )}
              <div className="flex items-center gap-3">
                {isValidArticleUrl(issue.source_url) && (
                  <a
                    href={issue.source_url!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline font-medium"
                  >
                    원문 보기 ↗
                  </a>
                )}
                <Link
                  href={`/issues/${issue.id}`}
                  className="text-xs text-zinc-500 hover:text-zinc-800 transition-colors"
                >
                  AI 분석 →
                </Link>
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

export default function IssuesPage() {
  const [category, setCategory] = useState('전체')

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-zinc-900 mb-6">글로벌 이슈</h1>

      <div className="flex gap-2 mb-6 flex-wrap">
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`px-3 py-1 text-sm rounded-full border transition-colors ${
              category === cat
                ? 'bg-blue-600 text-white border-blue-600'
                : 'text-zinc-600 border-zinc-300 hover:border-blue-400'
            }`}
          >
            {CATEGORY_LABELS[cat] ?? cat}
          </button>
        ))}
      </div>

      <IssueList key={category} category={category} />
    </div>
  )
}
