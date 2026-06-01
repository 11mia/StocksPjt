import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import SignOutButton from '@/features/auth/SignOutButton'
import {
  relativeTime,
  CATEGORY_COLORS,
  IMPORTANCE_COLORS,
  IMPORTANCE_LABELS,
  type NewsItem,
} from '@/lib/top-news'
import { isValidArticleUrl } from '@/lib/url-utils'
import { Badge, getTagVariant } from '@/components/ui/badge'

const CATEGORY_LABELS: Record<string, string> = {
  geopolitical: '지정학',
  macro: '매크로/정책',
  supply_chain: '공급망/원자재',
  fundamental: '기업 펀더멘탈',
}

export default async function DashboardHome() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: rows } = await supabase
    .from('top_news_cache')
    .select('*')
    .order('rank', { ascending: true })

  const topIssues: NewsItem[] = (rows ?? []).map(row => ({
    rank: row.rank,
    koreanTitle: row.korean_title,
    koreanSummary: row.korean_summary,
    category: row.category,
    categoryLabel: CATEGORY_LABELS[row.category] ?? row.category,
    importance: row.importance as NewsItem['importance'],
    urgencyScore: row.urgency_score,
    marketScore: row.market_score,
    totalScore: row.total_score,
    tags: Array.isArray(row.tags) ? row.tags : [],
    sourceUrl: row.source_url ?? '#',
    sourceName: row.source_name ?? '',
    publishedAt: row.published_at ?? new Date().toISOString(),
  }))

  const cachedAt: string | null = rows?.[0]?.cached_at ?? null

  return (
    <div className="min-h-screen bg-zinc-50">
      <nav className="bg-white border-b border-zinc-200 px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Link href="/" className="flex items-center gap-2 mr-3">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 10L4.5 6L7 8.5L10 4L13 6" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="text-base font-bold text-zinc-900 tracking-tight">StockRadar</span>
          </Link>
          <Link
            href="/"
            className="px-3 py-1.5 text-sm font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-all"
          >
            Dashboard
          </Link>
          <Link
            href="/watchlist"
            className="px-3 py-1.5 text-sm font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-all"
          >
            Watchlist
          </Link>
          <Link
            href="/issues"
            className="px-3 py-1.5 text-sm font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-all"
          >
            글로벌 이슈
          </Link>
          <Link
            href="/alerts"
            className="px-3 py-1.5 text-sm font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-all"
          >
            알림
          </Link>
        </div>
        <SignOutButton />
      </nav>

      <main className="max-w-4xl mx-auto px-4 py-5">
        {/* Header */}
        <div className="flex items-end justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-zinc-900">
              🇺🇸 오늘의 미국 주요 이슈 TOP 10
            </h1>
            <p className="text-xs text-zinc-500 mt-0.5">
              AI가 선별한 24시간 내 글로벌 영향력 최상위 이슈
            </p>
          </div>
          {cachedAt && (
            <div className="text-right">
              <p className="text-xs text-zinc-400">
                {relativeTime(cachedAt)} 업데이트
              </p>
            </div>
          )}
        </div>

        {/* Issues list */}
        {topIssues.length === 0 ? (
          <div className="bg-white rounded-xl border border-zinc-200 p-8 text-center mb-5">
            <p className="text-zinc-400 text-sm">아직 수집된 이슈가 없습니다.</p>
          </div>
        ) : (
          <div className="space-y-2 mb-5" data-testid="top-issues-list">
            {topIssues.map((issue) => (
              <article
                key={issue.rank}
                className={`bg-white rounded-xl border border-l-4 border-zinc-200 hover:shadow-md transition-all ${
                  IMPORTANCE_COLORS[issue.importance] ?? ''
                }`}
              >
                <div className="px-4 py-3">
                  {/* Top row: rank + badges + score */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-zinc-900 text-white text-xs font-bold flex items-center justify-center">
                      {issue.rank}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                        CATEGORY_COLORS[issue.category] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200'
                      }`}
                    >
                      {issue.categoryLabel}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {IMPORTANCE_LABELS[issue.importance]}
                    </span>
                    {issue.totalScore > 0 && (
                      <span
                        className="ml-auto text-xs font-mono text-zinc-400"
                        title={`긴급성 ${issue.urgencyScore}/5 + 증시연관 ${issue.marketScore}/5`}
                      >
                        {issue.urgencyScore}+{issue.marketScore}={issue.totalScore}
                      </span>
                    )}
                  </div>

                  {/* Title */}
                  <h2 className="font-semibold text-zinc-900 text-sm leading-snug mb-1.5">
                    {issue.koreanTitle}
                  </h2>

                  {/* Theme tags */}
                  {issue.tags && issue.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-1.5">
                      {issue.tags.map(tag => (
                        <Badge key={tag} variant={getTagVariant(tag)}>
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Summary */}
                  {issue.koreanSummary && (
                    <p className="text-xs text-zinc-600 leading-relaxed line-clamp-2 mb-2">
                      {issue.koreanSummary}
                    </p>
                  )}

                  {/* Meta row */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400">
                      {issue.sourceName && `${issue.sourceName} · `}
                      {relativeTime(issue.publishedAt)}
                    </span>
                    {isValidArticleUrl(issue.sourceUrl) && (
                      <a
                        href={issue.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:text-blue-800 hover:underline font-medium transition-colors"
                      >
                        원문 보기 ↗
                      </a>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
