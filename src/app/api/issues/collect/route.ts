import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Anthropic from '@anthropic-ai/sdk'

const NEWSAPI_BASE = 'https://newsapi.org/v2'
// pageSize 100 = NewsAPI 단일 요청 최대치 (무료·유료 공통)
// 페이지네이션은 유료 플랜 전용이므로 1회 요청당 100개가 실질 상한
const NEWSAPI_PAGE_SIZE = 100
const TIMEOUT_MS = 15000 // 100건 응답에 맞게 여유 확보

const CATEGORIES: Record<string, string[]> = {
  geopolitical: ['war', 'conflict', 'military', 'geopolitical', 'NATO', 'sanctions', 'invasion'],
  macro: ['inflation', 'interest rate', 'GDP', 'recession', 'Fed', 'central bank', 'economy'],
  supply_chain: ['supply chain', 'shortage', 'semiconductor', 'oil', 'energy', 'logistics'],
  political: ['election', 'congress', 'senate', 'president', 'policy', 'regulation', 'tariff'],
}

function detectCategory(title: string, description: string): string {
  const text = `${title} ${description}`.toLowerCase()
  for (const [cat, keywords] of Object.entries(CATEGORIES)) {
    if (keywords.some(kw => text.includes(kw.toLowerCase()))) return cat
  }
  return 'macro'
}

function checkAuth(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return request.headers.get('authorization') === `Bearer ${secret}`
}

async function runCollect() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const supabase = createAdminClient()

  try {
    const res = await fetch(
      `${NEWSAPI_BASE}/everything?q=economy+OR+market+OR+geopolitical+OR+stocks+OR+inflation+OR+Fed+OR+sanctions+OR+tariff+OR+recession+OR+semiconductor&language=en&sortBy=publishedAt&pageSize=${NEWSAPI_PAGE_SIZE}&apiKey=${process.env.NEWS_API_KEY}`,
      { signal: controller.signal }
    )
    clearTimeout(timer)

    if (!res.ok) throw new Error(`NewsAPI error: ${res.status}`)
    const json = await res.json()
    const articles = (json.articles ?? []) as Array<{
      title: string
      url: string
      description: string
      publishedAt: string
    }>

    const issues = articles
      .filter(a => a.title && a.title !== '[Removed]')
      .map(a => ({
        title: a.title,
        source_url: a.url,
        category: detectCategory(a.title, a.description ?? ''),
        published_at: a.publishedAt,
      }))

    let inserted = 0
    if (issues.length > 0) {
      const titles = issues.map(i => i.title)
      const { data: existing } = await supabase
        .from('global_issues')
        .select('title')
        .in('title', titles)
      const existingTitles = new Set((existing ?? []).map((r: { title: string }) => r.title))
      const newIssues = issues.filter(i => !existingTitles.has(i.title))

      if (newIssues.length > 0) {
        const { data: insertedRows, error } = await supabase
          .from('global_issues')
          .insert(newIssues)
          .select('id, title')
        if (error) throw error
        inserted = newIssues.length

        // 신규 이슈에 한글 요약 즉시 생성 후 저장
        if (insertedRows && insertedRows.length > 0) {
          try {
            const anthropicKey = process.env.ANTHROPIC_API_KEY
            if (anthropicKey) {
              const client = new Anthropic({ apiKey: anthropicKey })
              const numbered = insertedRows.map((r, i) => `[${i + 1}] ${r.title}`).join('\n')
              const response = await client.messages.create({
                model: 'claude-sonnet-4-6',
                max_tokens: 3000,
                messages: [{
                  role: 'user',
                  content: `다음 영문 기사 제목들을 각각 한글로 2문장 요약해주세요. 무슨 일이 일어났는지와 그 중요성을 간결하게 설명해주세요.\n\n${numbered}\n\n반드시 아래 JSON 형식으로만 응답하세요:\n{"summaries": ["요약1", ...(총 ${insertedRows.length}개)]}`,
                }],
              })
              const text = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
              const match = text.match(/\{[\s\S]*\}/)
              if (match) {
                const parsed = JSON.parse(match[0]) as { summaries: string[] }
                await Promise.all(
                  insertedRows.map((row, idx) => {
                    const summary = parsed.summaries[idx]
                    if (!summary) return Promise.resolve()
                    return supabase
                      .from('global_issues')
                      .update({ korean_summary: summary })
                      .eq('id', row.id)
                  })
                )
              }
            }
          } catch {
            // 요약 생성 실패 시 무시 (나중에 with-summaries 라우트에서 생성)
          }
        }
      }
    }

    await generateAlertsForNewIssues(supabase)
    return NextResponse.json({ data: { collected: inserted } })
  } catch (err) {
    clearTimeout(timer)
    console.error('[collect] error:', err)
    const { data } = await supabase
      .from('global_issues')
      .select('id, title, published_at')
      .order('published_at', { ascending: false })
      .limit(10)
    return NextResponse.json({ data: { collected: 0, fallback: data }, stale: true })
  }
}

// Vercel Cron은 GET 요청을 보냄
export async function GET(request: Request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized', code: 401 }, { status: 401 })
  }
  return runCollect()
}

export async function POST(request: Request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized', code: 401 }, { status: 401 })
  }
  return runCollect()
}

async function generateAlertsForNewIssues(supabase: ReturnType<typeof createAdminClient>) {
  const { data: recentIssues } = await supabase
    .from('global_issues')
    .select('id, title')
    .order('created_at', { ascending: false })
    .limit(NEWSAPI_PAGE_SIZE)
  if (!recentIssues?.length) return

  const { data: watchlistItems } = await supabase
    .from('watchlist_items')
    .select('user_id, ticker')
  if (!watchlistItems?.length) return

  const candidates: { user_id: string; issue_id: string; ticker: string; message: string }[] = []
  for (const issue of recentIssues) {
    for (const item of watchlistItems) {
      if (issue.title.toUpperCase().includes(item.ticker)) {
        candidates.push({
          user_id: item.user_id,
          issue_id: issue.id,
          ticker: item.ticker,
          message: `[${item.ticker}] 관련 이슈: ${issue.title.slice(0, 100)}`,
        })
      }
    }
  }
  if (!candidates.length) return

  // 이미 존재하는 (user_id, issue_id, ticker) 조합 제거
  const issueIds = [...new Set(candidates.map(c => c.issue_id))]
  const { data: existing } = await supabase
    .from('alerts')
    .select('user_id, issue_id, ticker')
    .in('issue_id', issueIds)

  const existingKeys = new Set(
    (existing ?? []).map((r: { user_id: string; issue_id: string; ticker: string }) =>
      `${r.user_id}|${r.issue_id}|${r.ticker}`
    )
  )

  const newAlerts = candidates.filter(
    c => !existingKeys.has(`${c.user_id}|${c.issue_id}|${c.ticker}`)
  )

  if (newAlerts.length > 0) {
    await supabase.from('alerts').insert(newAlerts)
  }
}
