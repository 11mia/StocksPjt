import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Anthropic from '@anthropic-ai/sdk'
import { isValidArticleUrl } from '@/lib/url-utils'
import { calcKeywordScore } from '@/lib/top-news'

export const maxDuration = 60

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

  // 24시간 이내 기사 우선, 없으면 48시간으로 폴백
  let articles = await fetchArticles(from24h)
  let usedWindow = '24h'
  if (articles.length === 0) {
    articles = await fetchArticles(from48h)
    usedWindow = '48h'
  }

  if (articles.length === 0) return NextResponse.json({ error: 'No articles found' }, { status: 500 })

  const client = new Anthropic({ apiKey: anthropicKey })
  const articlesText = articles
    .map((a, i) =>
      `[${i + 1}] 제목: ${a.title}\n설명: ${a.description ?? '없음'}\nURL: ${a.url}\n출처: ${a.source?.name ?? '알 수 없음'}\n발행일: ${a.publishedAt}`
    )
    .join('\n\n')

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 6000,
    system: `당신은 미국 주식 투자자를 위한 글로벌 뉴스 필터링 AI입니다.
아래 엄격한 기준에 따라 뉴스를 채점하고 TOP 10을 선정합니다.
모든 출력(한글 제목, 요약, 분석, 태그)은 반드시 한국어로 작성하세요.

[TOP 10 선정 기준]

1. 시의성 필터 (필수)
   - 24시간 이내에 발생했거나 업데이트된 뉴스만 대상으로 합니다.

2. 키워드 가중치 사전 (아래 키워드 포함 시 우선 선정)
   - 거시경제/정책: Fed, FOMC, Interest Rate, Inflation, CPI, Rate Cut, Rate Hike
   - 지정학적 리스크: Sanctions, Tariff, Trade War, Geopolitical Risk, Conflict, Alliance, Reconstruction
   - 글로벌 공급망: Semiconductor, Crude Oil, Natural Gas, Rare Earth, Supply Chain Disruption, Logistics
   - 미국 증시/특수 섹터: Treasury Yield, Dollar Index, Earnings, BDC, Dividend Stability, Defense Stock

3. 카테고리별 가중치
   ① 매크로/정책(macro): 연준 금리 결정, 통화 정책 변동, 글로벌 관세·수출입 규제
   ② 지정학(geopolitical): 군사 충돌, 외교적 제재, 동맹 변화, 공급망 봉쇄 리스크
   ③ 공급망/원자재(supply_chain): 반도체, 에너지(원유·천연가스), 핵심 원자재 공급 차질·가격 급등락
   ④ 기업 펀더멘탈(fundamental): 미국 시총 상위 기업·주요 섹터(방산, 기술, 고배당 BDC)에 직접 영향

4. 자산 전이도: S&P 500, Nasdaq, 미국 국채 금리, 달러 인덱스에 직접 변동성 유발 가능성

5. 스코어링
   - 시장 긴급성(urgencyScore): 1~5점 (5=즉각적·광범위한 시장 충격 예상)
   - 미국 증시 연관도(marketScore): 1~5점 (5=S&P500·Nasdaq에 직접 영향)
   - totalScore = urgencyScore + marketScore
   - importance: 8~10 → critical, 5~7 → high, 2~4 → medium

6. 테마 태그 (1~2개)
   다음 중에서 뉴스 내용에 가장 적합한 한글 태그를 1~2개 선택하세요:
   "정책/금리", "지정학", "공급망", "미국증시", "에너지", "배당/BDC", "반도체", "기업실적"

7. AI 분석 3개 항목 (반드시 한국어로 작성)
   ① koreanSummary: 핵심 3줄 요약 — 무슨 일인지(1문장) + 왜 중요한지(1문장) + 자산 전이 영향(1문장)
   ② priceImpactReason: 주가 영향 예측 이유 — 단기(1~5 거래일) 주가 방향성과 근거 2~3문장
   ③ institutionTrend: 기관 투자 의견 트렌드 — 기관 투자자 예상 반응 및 섹터 매수/매도 트렌드 2~3문장`,
    messages: [
      {
        role: 'user',
        content: `다음 뉴스 목록을 위 기준으로 채점하여 TOP 10을 선정하고, 한글 분석 3개 항목과 테마 태그를 작성하세요.

${articlesText}

반드시 아래 JSON 형식으로만 응답하세요:
{
  "issues": [
    {
      "rank": 1,
      "articleIndex": <1~${articles.length}>,
      "urgencyScore": <1~5>,
      "marketScore": <1~5>,
      "totalScore": <합계>,
      "koreanTitle": "<한글 제목 35자 이내>",
      "koreanSummary": "<핵심 3줄 요약: 무슨 일(1문장) + 왜 중요한지(1문장) + 자산 전이 영향(1문장)>",
      "priceImpactReason": "<주가 영향 예측 이유: 단기 주가 방향성과 근거 2~3문장>",
      "institutionTrend": "<기관 투자 의견 트렌드: 기관 투자자 예상 반응 및 섹터 매수/매도 트렌드 2~3문장>",
      "category": "<geopolitical|macro|supply_chain|fundamental>",
      "importance": "<critical|high|medium>",
      "tags": ["<태그1>", "<태그2 선택적>"]
    }
  ]
}`,
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
    const original = articles[(item.articleIndex ?? 1) - 1] ?? articles[0]
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
