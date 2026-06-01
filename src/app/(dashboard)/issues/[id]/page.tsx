import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import AIAnalysisPanel from '@/features/analysis/AIAnalysisPanel'
import { getIssueSummaries } from '@/lib/issue-summaries'
import { isValidArticleUrl } from '@/lib/url-utils'

interface Issue {
  id: string
  title: string
  source_url: string | null
  category: string
  published_at: string | null
}

const CATEGORY_LABELS: Record<string, string> = {
  geopolitical: '지정학',
  macro: '거시경제',
  supply_chain: '공급망',
  political: '정치',
}
const CATEGORY_COLORS: Record<string, string> = {
  geopolitical: 'bg-red-100 text-red-700',
  macro: 'bg-blue-100 text-blue-700',
  supply_chain: 'bg-amber-100 text-amber-700',
  political: 'bg-purple-100 text-purple-700',
}

export const maxDuration = 60

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: issues } = await supabase
    .from('global_issues')
    .select('*')
    .eq('id', id)
    .limit(1)

  const issue = issues?.[0] as Issue | undefined
  if (!issue) notFound()

  const { data: watchlistItems } = await supabase
    .from('watchlist_items')
    .select('ticker')
    .eq('user_id', user.id)

  const tickers = watchlistItems?.map(w => w.ticker) ?? []

  let koreanSummary: string | null = null
  try {
    const summaries = await getIssueSummaries([`${issue.id}:::${issue.title}`])
    koreanSummary = summaries[issue.id] ?? null
  } catch {
    // 요약 실패 시 null 유지
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/issues" className="text-sm text-zinc-400 hover:text-zinc-700">
          ← 이슈 피드
        </Link>
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            CATEGORY_COLORS[issue.category] ?? 'bg-zinc-100 text-zinc-600'
          }`}
        >
          {CATEGORY_LABELS[issue.category] ?? issue.category}
        </span>
      </div>

      <h1 className="text-lg font-bold text-zinc-900 mb-1 leading-snug">{issue.title}</h1>

      {issue.published_at && (
        <p className="text-xs text-zinc-400 mb-4">
          {new Date(issue.published_at).toLocaleString('ko-KR')}
        </p>
      )}

      {koreanSummary && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-4">
          <p className="text-xs font-semibold text-blue-600 mb-1">AI 한글 요약</p>
          <p className="text-sm text-zinc-700 leading-relaxed">{koreanSummary}</p>
        </div>
      )}

      {isValidArticleUrl(issue.source_url) && (
        <a
          href={issue.source_url!}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mb-6 text-sm text-blue-600 hover:underline"
        >
          원문 보기 ↗
        </a>
      )}

      {tickers.length > 0 && (
        <div className="mt-4">
          <h2 className="text-base font-semibold text-zinc-900 mb-3">AI 영향 분석</h2>
          <div className="flex flex-col gap-3">
            {tickers.map(ticker => (
              <AIAnalysisPanel key={ticker} issueId={issue.id} ticker={ticker} />
            ))}
          </div>
        </div>
      )}

      {tickers.length === 0 && (
        <p className="text-sm text-zinc-400">
          <Link href="/watchlist" className="text-blue-600 hover:underline">
            Watchlist
          </Link>
          에 종목을 추가하면 AI 분석을 볼 수 있습니다.
        </p>
      )}
    </div>
  )
}
