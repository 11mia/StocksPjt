import Anthropic from '@anthropic-ai/sdk'
import { unstable_cache } from 'next/cache'
import { isValidArticleUrl } from './url-utils'

export interface NewsItem {
  rank: number
  koreanTitle: string
  koreanSummary: string
  category: string
  categoryLabel: string
  importance: 'critical' | 'high' | 'medium'
  urgencyScore: number
  marketScore: number
  totalScore: number
  sourceUrl: string
  sourceName: string
  publishedAt: string
}

const CATEGORY_LABELS: Record<string, string> = {
  geopolitical: '지정학',
  macro: '매크로/정책',
  supply_chain: '공급망/원자재',
  fundamental: '기업 펀더멘탈',
}

const CATEGORY_COLORS: Record<string, string> = {
  geopolitical: 'bg-red-100 text-red-700 border-red-200',
  macro: 'bg-blue-100 text-blue-700 border-blue-200',
  supply_chain: 'bg-amber-100 text-amber-700 border-amber-200',
  fundamental: 'bg-emerald-100 text-emerald-700 border-emerald-200',
}

const IMPORTANCE_COLORS: Record<string, string> = {
  critical: 'border-l-red-500 bg-red-50/30',
  high: 'border-l-orange-400 bg-orange-50/30',
  medium: 'border-l-yellow-400 bg-yellow-50/20',
}

const IMPORTANCE_LABELS: Record<string, string> = {
  critical: '🔴 매우중요',
  high: '🟠 중요',
  medium: '🟡 주목',
}

export { CATEGORY_COLORS, IMPORTANCE_COLORS, IMPORTANCE_LABELS }

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

  const res = await fetch(
    `https://newsapi.org/v2/everything?q=United+States+OR+America+OR+White+House+OR+Trump+OR+Federal+Reserve+OR+US+economy+OR+Pentagon+OR+Congress+OR+Wall+Street+OR+tariff+OR+dollar+OR+inflation&language=en&sortBy=publishedAt&pageSize=30&apiKey=${apiKey}`,
    { cache: 'no-store' }
  )

  if (!res.ok) throw new Error(`NewsAPI error: ${res.status}`)
  const json = await res.json()
  const articles: RawArticle[] = (json.articles ?? [])
    .filter((a: RawArticle) =>
      a.title &&
      a.title !== '[Removed]' &&
      isValidArticleUrl(a.url)
    )
    .slice(0, 20)

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
    max_tokens: 3000,
    system: `당신은 미국 주식 투자자를 위한 글로벌 뉴스 필터링 AI입니다.
아래 엄격한 기준에 따라 뉴스를 채점하고 TOP 10을 선정합니다.

[TOP 10 선정 기준]

1. 시의성 필터 (필수)
   - 24시간 이내에 발생했거나 업데이트된 뉴스만 대상으로 합니다.
   - 24시간이 넘은 뉴스는 제외합니다.

2. 카테고리별 가중치 (매칭 항목이 많고 비중이 클수록 상위)
   ① 매크로/정책(macro): 연준 금리 결정, 통화 정책 변동, 글로벌 관세·수출입 규제
   ② 지정학(geopolitical): 군사 충돌, 외교적 제재, 동맹 변화, 공급망 봉쇄 리스크
   ③ 공급망/원자재(supply_chain): 반도체, 에너지(원유·천연가스), 핵심 원자재 공급 차질·가격 급등락
   ④ 기업 펀더멘탈(fundamental): 미국 시총 상위 기업·주요 섹터(방산, 기술, 고배당 BDC)에 직접 영향

3. 자산 전이도 (Transmission)
   - S&P 500, Nasdaq, 미국 국채 금리, 달러 인덱스 중 최소 1개 이상에 직접적인 변동성을 유발할 가능성이 높은 뉴스를 우선합니다.

4. 스코어링 (내부 채점 — 아래 점수 합산 순으로 TOP 10 선출)
   - 시장 긴급성(urgencyScore): 1~5점 (5=즉각적·광범위한 시장 충격 예상)
   - 미국 증시 연관도(marketScore): 1~5점 (5=S&P500·Nasdaq에 직접 영향)
   - totalScore = urgencyScore + marketScore (최대 10점)
   - 동점 시 publishedAt 최신 순 우선

5. importance 매핑
   - totalScore 8~10 → critical
   - totalScore 5~7  → high
   - totalScore 2~4  → medium`,
    messages: [
      {
        role: 'user',
        content: `다음 뉴스 목록을 위 기준으로 채점하여 TOP 10을 선정하고 한글 요약을 작성하세요.

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
      "koreanSummary": "<무슨 일이 일어났는지, 왜 중요한지, S&P500·금리·달러 등 자산 전이 영향을 포함한 2문장 한글 요약>",
      "category": "<geopolitical|macro|supply_chain|fundamental>",
      "importance": "<critical|high|medium>"
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
      category: string
      importance: string
    }) => {
      const original = articles[(item.articleIndex ?? 1) - 1] ?? articles[0]
      const urgency = Math.min(5, Math.max(1, item.urgencyScore ?? 3))
      const market = Math.min(5, Math.max(1, item.marketScore ?? 3))
      const total = urgency + market
      return {
        rank: item.rank,
        koreanTitle: item.koreanTitle,
        koreanSummary: item.koreanSummary,
        category: item.category,
        categoryLabel: CATEGORY_LABELS[item.category] ?? item.category,
        importance: item.importance as NewsItem['importance'],
        urgencyScore: urgency,
        marketScore: market,
        totalScore: total,
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
