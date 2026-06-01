import Anthropic from '@anthropic-ai/sdk'
import { unstable_cache } from 'next/cache'
import { isValidArticleUrl } from './url-utils'

export interface NewsItem {
  rank: number
  koreanTitle: string
  koreanSummary: string
  priceImpactReason: string
  institutionTrend: string
  category: string
  categoryLabel: string
  importance: 'critical' | 'high' | 'medium'
  urgencyScore: number
  marketScore: number
  totalScore: number
  tags: string[]
  sourceUrl: string
  sourceName: string
  publishedAt: string
}

export const CATEGORY_LABELS: Record<string, string> = {
  geopolitical: '지정학',
  macro: '매크로/정책',
  supply_chain: '공급망/원자재',
  fundamental: '기업 펀더멘탈',
}

export const CATEGORY_COLORS: Record<string, string> = {
  geopolitical: 'bg-red-100 text-red-700 border-red-200',
  macro: 'bg-blue-100 text-blue-700 border-blue-200',
  supply_chain: 'bg-amber-100 text-amber-700 border-amber-200',
  fundamental: 'bg-emerald-100 text-emerald-700 border-emerald-200',
}

export const IMPORTANCE_COLORS: Record<string, string> = {
  critical: 'border-l-red-500 bg-red-50/30',
  high: 'border-l-orange-400 bg-orange-50/30',
  medium: 'border-l-yellow-400 bg-yellow-50/20',
}

export const IMPORTANCE_LABELS: Record<string, string> = {
  critical: '🔴 매우중요',
  high: '🟠 중요',
  medium: '🟡 주목',
}

// 키워드 사전 — 카테고리별 우선 필터링 및 가중치 부여
export const KEYWORD_DICT: Record<string, { keywords: string[]; tag: string; weight: number }> = {
  macro: {
    keywords: ['Fed', 'FOMC', 'Interest Rate', 'Inflation', 'CPI', 'Rate Cut', 'Rate Hike', 'Federal Reserve', 'monetary policy'],
    tag: '정책/금리',
    weight: 2,
  },
  geopolitical: {
    keywords: ['Sanctions', 'Tariff', 'Trade War', 'Geopolitical Risk', 'Conflict', 'Alliance', 'Reconstruction', 'military', 'war', 'nuclear'],
    tag: '지정학',
    weight: 2,
  },
  supply_chain: {
    keywords: ['Semiconductor', 'Crude Oil', 'Natural Gas', 'Rare Earth', 'Supply Chain Disruption', 'Logistics', 'chip', 'energy', 'oil price'],
    tag: '공급망',
    weight: 2,
  },
  us_market: {
    keywords: ['Treasury Yield', 'Dollar Index', 'Earnings', 'BDC', 'Dividend Stability', 'Defense Stock', 'S&P 500', 'Nasdaq', 'Wall Street', 'stock market'],
    tag: '미국증시',
    weight: 1,
  },
}

// 기사 텍스트에서 키워드 가중치 점수 계산
export function calcKeywordScore(title: string, description: string | null): number {
  const text = `${title} ${description ?? ''}`.toLowerCase()
  let score = 0
  for (const entry of Object.values(KEYWORD_DICT)) {
    for (const kw of entry.keywords) {
      if (text.includes(kw.toLowerCase())) {
        score += entry.weight
      }
    }
  }
  return score
}

interface RawArticle {
  title: string
  description: string | null
  url: string
  source: { name: string }
  publishedAt: string
}

async function fetchTopUsNewsInternal(): Promise<NewsItem[]> {
  const apiKey = process.env.NEWS_API_KEY
  if (!apiKey) throw new Error('NEWS_API_KEY not set')

  // 키워드 사전 기반 NewsAPI 쿼리
  const query = [
    'Fed', 'FOMC', 'inflation', 'CPI', 'tariff', 'sanctions',
    'semiconductor', '"crude oil"', '"natural gas"', '"supply chain"',
    '"treasury yield"', '"dollar index"', 'earnings', 'BDC',
    '"trade war"', 'geopolitical', 'conflict', '"rate cut"', '"rate hike"',
  ].join('+OR+')

  const from24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const from48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  const fetchFiltered = async (from: string): Promise<RawArticle[]> => {
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
  let articles = await fetchFiltered(from24h)
  if (articles.length === 0) articles = await fetchFiltered(from48h)

  if (articles.length === 0) throw new Error('No articles found')

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not set')

  const client = new Anthropic({ apiKey: anthropicKey })

  const articlesText = articles
    .map(
      (a, i) =>
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

5. 스코어링 (내부 채점 — 합산 순으로 TOP 10 선출)
   - 시장 긴급성(urgencyScore): 1~5점 (5=즉각적·광범위한 시장 충격 예상)
   - 미국 증시 연관도(marketScore): 1~5점 (5=S&P500·Nasdaq에 직접 영향)
   - totalScore = urgencyScore + marketScore (최대 10점)
   - 동점 시 publishedAt 최신 순 우선

6. importance 매핑
   - totalScore 8~10 → critical
   - totalScore 5~7  → high
   - totalScore 2~4  → medium

7. 테마 태그 (1~2개 추출)
   다음 중에서 뉴스 내용에 가장 적합한 한글 태그를 1~2개 선택하세요:
   "정책/금리", "지정학", "공급망", "미국증시", "에너지", "배당/BDC", "반도체", "기업실적"

8. AI 분석 3개 항목 (반드시 한국어로 작성)
   ① koreanSummary: 핵심 3줄 요약 — 무슨 일인지, 왜 중요한지, 자산 전이 영향을 각각 1문장씩 3문장으로 작성
   ② priceImpactReason: 주가 영향 예측 이유 — 단기(1~5 거래일) 주가 방향성과 그 근거를 2~3문장으로 작성
   ③ institutionTrend: 기관 투자 의견 트렌드 — 기관 투자자·애널리스트의 예상 반응 및 섹터별 매수/매도 트렌드를 2~3문장으로 작성`,
    messages: [
      {
        role: 'user',
        content: `다음 뉴스 목록을 위 기준으로 채점하여 TOP 10을 선정하고, 한글 분석 3개 항목과 테마 태그를 작성하세요.

${articlesText}

반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이 JSON만):
{
  "issues": [
    {
      "rank": 1,
      "articleIndex": <위 목록에서의 번호 1~${articles.length}>,
      "urgencyScore": <1~5 정수>,
      "marketScore": <1~5 정수>,
      "totalScore": <urgencyScore + marketScore>,
      "koreanTitle": "<핵심 내용을 담은 한글 제목 (35자 이내)>",
      "koreanSummary": "<핵심 3줄 요약: 무슨 일(1문장) + 왜 중요한지(1문장) + S&P500·금리·달러 등 자산 전이 영향(1문장)>",
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

  const text =
    response.content[0].type === 'text' ? response.content[0].text.trim() : ''
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Invalid AI response format')

  const parsed = JSON.parse(jsonMatch[0])

  return parsed.issues.map(
    (item: {
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
      const total = urgency + market
      return {
        rank: item.rank,
        koreanTitle: item.koreanTitle,
        koreanSummary: item.koreanSummary,
        priceImpactReason: item.priceImpactReason ?? '',
        institutionTrend: item.institutionTrend ?? '',
        category: item.category,
        categoryLabel: CATEGORY_LABELS[item.category] ?? item.category,
        importance: item.importance as NewsItem['importance'],
        urgencyScore: urgency,
        marketScore: market,
        totalScore: total,
        tags: Array.isArray(item.tags) ? item.tags.slice(0, 2) : [],
        sourceUrl: original.url,
        sourceName: original.source?.name ?? '알 수 없음',
        publishedAt: original.publishedAt,
      }
    }
  )
}

export const getTopUsNews = unstable_cache(
  fetchTopUsNewsInternal,
  ['top-us-news'],
  { revalidate: 3600 }
)

export function relativeTime(dateStr: string): string {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const diffH = Math.floor(diffMs / (1000 * 60 * 60))
  if (diffH < 1) {
    const diffM = Math.floor(diffMs / (1000 * 60))
    return diffM <= 0 ? '방금 전' : `${diffM}분 전`
  }
  if (diffH < 24) return `${diffH}시간 전`
  const diffD = Math.floor(diffH / 24)
  return `${diffD}일 전`
}
