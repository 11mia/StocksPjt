'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { isValidArticleUrl } from '@/lib/url-utils'
import { Badge, type BadgeVariant } from '@/components/ui/badge'

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
const CATEGORY_TO_TAG: Record<string, string> = {
  geopolitical: '지정학',
  macro: '정책/금리',
  supply_chain: '공급망',
  political: '지정학',
}
const CATEGORY_VARIANT: Record<string, BadgeVariant> = {
  geopolitical: 'geopolitical',
  macro: 'macro',
  supply_chain: 'supply_chain',
  political: 'geopolitical',
}

function IssueList({ category, query }: { category: string; query: string }) {
  const [issues, setIssues] = useState<Issue[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const params = new URLSearchParams()
    if (category !== '전체') params.set('category', category)
    if (query) params.set('q', query)
    const url = `/api/issues/with-summaries${params.size > 0 ? `?${params.toString()}` : ''}`
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
  }, [category, query])

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

  if (issues.length === 0) {
    return (
      <p className="text-zinc-500 text-sm">
        {query ? '검색 결과가 없습니다.' : '이슈가 없습니다.'}
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-3">
      {issues.map(issue => (
        <li key={issue.id}>
          <div className="bg-white rounded-xl border border-zinc-200 hover:border-blue-300 hover:shadow-sm transition-all p-4">
            <div className="mb-2">
              <Link
                href={`/issues/${issue.id}`}
                className="text-sm font-semibold text-zinc-900 leading-snug hover:text-blue-700 transition-colors block mb-1.5"
              >
                {issue.title}
              </Link>
              <div className="flex flex-wrap gap-1">
                <Badge variant={CATEGORY_VARIANT[issue.category] ?? 'default'}>
                  {CATEGORY_TO_TAG[issue.category] ?? CATEGORY_LABELS[issue.category] ?? issue.category}
                </Badge>
              </div>
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
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-zinc-900 mb-6">글로벌 이슈</h1>

      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="이슈 검색..."
        aria-label="이슈 검색"
        data-testid="issue-search-input"
        className="w-full mb-4 px-4 py-2 text-sm rounded-lg border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
      />

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

      <IssueList key={`${category}:${query}`} category={category} query={query} />
    </div>
  )
}
