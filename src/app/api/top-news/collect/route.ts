import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Anthropic from '@anthropic-ai/sdk'
import { isValidArticleUrl } from '@/lib/url-utils'
import { calcKeywordScore } from '@/lib/top-news'

export const maxDuration = 120

function checkAuth(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return request.headers.get('authorization') === `Bearer ${secret}`
}

interface RawArticle {
  title: string
  description: string | null
  url: string
  source: { name: string }
  publishedAt: string
}

async function runCollect() {
  const apiKey = process.env.NEWS_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'NEWS_API_KEY not set' }, { status: 500 })
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 })

  // 키워드 사전 기반 NewsAPI 쿼리 — from 파라미터로 API 레벨에서 24시간 필터
  const query = [
    'Fed', 'FOMC', 'inflation', 'CPI', 'tariff', 'sanctions',
    'semiconductor', '"crude oil"', '"natural gas"', '"supply chain"',
    '"treasury yield"', '"dollar index"', 'earnings', 'BDC',
    '"trade war"', 'geopolitical', 'conflict', '"rate cut"', '"rate hike"',
  ].join('+OR+')

  const from24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const from48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  const fetchArticles = async (from: string): Promise<RawArticle[]> => {
    const res = await fetch(
      `https://newsapi.org/v2/everything?q=${query}&language=en&sortBy=publishedAt&pageSize=50&from=${from}&apiKey=${apiKey}`,
      { cache: 'no-store' }
    )
    if (!res.ok) return []
    const json = await res.json()
    const cutoff = new Date(from)
    return (json.articles ?? [])
      .filter((a: RawArticle) =>
        a.title &&
        a.title !== '[Removed]' &&
        isValidArticleUrl(a.url) &&
        a.publishedAt &&
        new Date(a.publishedAt) >= cutoff
      )
      .map((a: RawArticle) => ({ ...a, kwScore: calcKeywordScore(a.title, a.description) }))
      .sort((a: { kwScore: number }, b: { kwScore: number }) => b.kwScore - a.kwScore)
      .slice(0, 25)
  }

  // 24h · 48h 병렬 호출 — 24h 결과가 있으면 사용, 없으면 48h 폴백
  const [articles24, articles48] = await Promise.all([
    fetchArticles(from24h),
    fetchArticles(from48h),
  ])
  const articles = articles24.length > 0 ? articles24 : articles48
  const usedWindow = articles24.length > 0 ? '24h' : '48h'

  if (articles.length === 0) return NextResponse.json({ error: 'No articles found' }, { status: 500 })

  // 입력 토큰 최소화 — URL/출처 제거, 상위 15개만 전달
  const topArticles = articles.slice(0, 15)
  const client = new Anthropic({ apiKey: anthropicKey })
  const articlesText = topArticles
    .map((a, i) =>
      `[${i + 1}] ${a.title} | ${a.description?.slice(0, 80) ?? ''} | ${a.publishedAt}`
    )
    .join('\n')

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 5000,
    system: `미국 주식 투자자용 뉴스 필터링 AI. TOP 10 선정 후 한국어로 분석.
스코어링: urgencyScore(1~5 시장긴급성) + marketScore(1~5 미국증시연관도) 합산 상위 10개 선출.
키워드 우선: Fed/FOMC/금리/관세/반도체/원유/제재/무역전쟁/Treasury Yield/Earnings/BDC.
카테고리: geopolitical/macro/supply_chain/fundamental.
importance: 8~10→critical, 5~7→high, 2~4→medium.
태그(1~2개): "정책/금리","지정학","공급망","미국증시","에너지","배당/BDC","반도체","기업실적".`,
    messages: [
      {
        role: 'user',
        content: `뉴스 ${topArticles.length}개를 채점해 TOP 10을 선정하고 아래 JSON으로만 응답:

${articlesText}

{"issues":[{"rank":1,"articleIndex":<1~${topArticles.length}>,"urgencyScore":<1~5>,"marketScore":<1~5>,"totalScore":<합계>,"koreanTitle":"<35자이내>","koreanSummary":"<무슨일+왜중요+자산영향 각1문장>","priceImpactReason":"<단기주가방향+근거 1~2문장>","institutionTrend":"<기관반응+섹터트렌드 1~2문장>","category":"<geopolitical|macro|supply_chain|fundamental>","importance":"<critical|high|medium>","tags":["<태그1>"]}]}`,
      },
    ],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return NextResponse.json({ error: 'Invalid AI response format' }, { status: 500 })

  const parsed = JSON.parse(jsonMatch[0])
  const rows = parsed.issues.map((item: {
    rank: number
    articleIndex: number
    urgencyScore: number
    marketScore: number
    totalScore: number
    koreanTitle: string
    koreanSummary: string
    priceImpactReason?: string
    institutionTrend?: string
    category: string
    importance: string
    tags?: string[]
  }) => {
    const original = topArticles[(item.articleIndex ?? 1) - 1] ?? topArticles[0]
    const urgency = Math.min(5, Math.max(1, item.urgencyScore ?? 3))
    const market = Math.min(5, Math.max(1, item.marketScore ?? 3))
    return {
      rank: item.rank,
      korean_title: item.koreanTitle,
      korean_summary: item.koreanSummary,
      price_impact_reason: item.priceImpactReason ?? '',
      institution_trend: item.institutionTrend ?? '',
      category: item.category,
      importance: item.importance,
      urgency_score: urgency,
      market_score: market,
      total_score: urgency + market,
      tags: Array.isArray(item.tags) ? item.tags.slice(0, 2) : [],
      source_url: original.url,
      source_name: original.source?.name ?? '',
      published_at: original.publishedAt,
      cached_at: new Date().toISOString(),
    }
  })

  const supabase = createAdminClient()
  await supabase.from('top_news_cache').delete().not('id', 'is', null)
  const { error } = await supabase.from('top_news_cache').insert(rows)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, count: rows.length, window: usedWindow, cached_at: new Date().toISOString() })
}

export async function GET(request: Request) {
  if (!checkAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return runCollect()
}

export async function POST(request: Request) {
  if (!checkAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return runCollect()
}
