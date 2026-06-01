import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { join } from 'path'

// .env.local 수동 파싱 (dotenv 미설치 환경 대응)
const envPath = join(process.cwd(), '.env.local')
const envContent = readFileSync(envPath, 'utf-8')
for (const line of envContent.split('\n')) {
  const [key, ...vals] = line.split('=')
  if (key && !key.startsWith('#')) process.env[key.trim()] = vals.join('=').trim()
}

const KEYWORD_DICT: Record<string, { keywords: string[]; weight: number }> = {
  macro: { keywords: ['Fed','FOMC','Interest Rate','Inflation','CPI','Rate Cut','Rate Hike','Federal Reserve','monetary policy'], weight: 2 },
  geopolitical: { keywords: ['Sanctions','Tariff','Trade War','Geopolitical','Conflict','Alliance','Reconstruction','military','war','nuclear'], weight: 2 },
  supply_chain: { keywords: ['Semiconductor','Crude Oil','Natural Gas','Rare Earth','Supply Chain','Logistics','chip','energy','oil price'], weight: 2 },
  us_market: { keywords: ['Treasury Yield','Dollar Index','Earnings','BDC','Dividend','Defense Stock','S&P 500','Nasdaq','Wall Street'], weight: 1 },
}

function kwScore(title: string, desc: string | null): number {
  const text = `${title} ${desc ?? ''}`.toLowerCase()
  let s = 0
  for (const e of Object.values(KEYWORD_DICT))
    for (const kw of e.keywords)
      if (text.includes(kw.toLowerCase())) s += e.weight
  return s
}

interface Article { title: string; description: string | null; url: string; source: { name: string }; publishedAt: string }

async function main() {
  const apiKey = process.env.NEWS_API_KEY!
  const anthropicKey = process.env.ANTHROPIC_API_KEY!
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  console.log('1. Fetching news...')
  const query = ['Fed','FOMC','inflation','CPI','tariff','sanctions','semiconductor','"crude oil"','"natural gas"','"supply chain"','"treasury yield"','"dollar index"','earnings','BDC','"trade war"','geopolitical','conflict','"rate cut"','"rate hike"'].join('+OR+')
  const from48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  const res = await fetch(`https://newsapi.org/v2/everything?q=${query}&language=en&sortBy=publishedAt&pageSize=50&from=${from48h}&apiKey=${apiKey}`)
  const json = await res.json()
  console.log(`   API status: ${json.status}, total: ${json.totalResults}`)

  const articles: Article[] = (json.articles ?? [])
    .filter((a: Article) => a.title && a.title !== '[Removed]')
    .map((a: Article) => ({ ...a, kwScore: kwScore(a.title, a.description) }))
    .sort((a: { kwScore: number }, b: { kwScore: number }) => b.kwScore - a.kwScore)
    .slice(0, 15)

  console.log(`   Using ${articles.length} articles after filtering`)
  articles.slice(0, 3).forEach((a, i) => console.log(`   [${i+1}] ${a.title.slice(0, 60)}`))

  console.log('\n2. Calling Claude...')
  const client = new Anthropic({ apiKey: anthropicKey })
  const articlesText = articles.map((a, i) => `[${i+1}] ${a.title} | ${a.description?.slice(0,80)??''} | ${a.publishedAt}`).join('\n')

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 5000,
    system: `미국 주식 투자자용 뉴스 필터링 AI. TOP 10 선정 후 한국어로 분석.
스코어링: urgencyScore(1~5) + marketScore(1~5) 합산 상위 10개.
키워드 우선: Fed/FOMC/금리/관세/반도체/원유/제재/무역전쟁/Treasury Yield/Earnings/BDC.
카테고리: geopolitical/macro/supply_chain/fundamental.
importance: 8~10→critical, 5~7→high, 2~4→medium.
태그(1~2개): "정책/금리","지정학","공급망","미국증시","에너지","배당/BDC","반도체","기업실적"`,
    messages: [{
      role: 'user',
      content: `뉴스 ${articles.length}개를 채점해 TOP 10을 선정하고 아래 JSON으로만 응답:

${articlesText}

{"issues":[{"rank":1,"articleIndex":<1~${articles.length}>,"urgencyScore":<1~5>,"marketScore":<1~5>,"totalScore":<합계>,"koreanTitle":"<35자이내>","koreanSummary":"<무슨일+왜중요+자산영향 각1문장>","priceImpactReason":"<단기주가방향+근거 1~2문장>","institutionTrend":"<기관반응+섹터트렌드 1~2문장>","category":"<geopolitical|macro|supply_chain|fundamental>","importance":"<critical|high|medium>","tags":["<태그1>"]}]}`
    }]
  })

  const text = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
  console.log(`   Claude responded (${text.length} chars)`)

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Invalid AI response')

  const parsed = JSON.parse(jsonMatch[0])
  console.log(`   Parsed ${parsed.issues.length} issues`)

  const rows = parsed.issues.map((item: { rank:number;articleIndex:number;urgencyScore:number;marketScore:number;koreanTitle:string;koreanSummary:string;priceImpactReason?:string;institutionTrend?:string;category:string;importance:string;tags?:string[] }) => {
    const orig = articles[(item.articleIndex ?? 1) - 1] ?? articles[0]
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
      source_url: orig.url,
      source_name: orig.source?.name ?? '',
      published_at: orig.publishedAt,
      cached_at: new Date().toISOString(),
    }
  })

  console.log('\n3. Saving to Supabase...')
  const supabase = createClient(supaUrl, supaKey)
  await supabase.from('top_news_cache').delete().not('id', 'is', null)
  const { error } = await supabase.from('top_news_cache').insert(rows)
  if (error) throw new Error(error.message)

  console.log(`\n✅ Done! Saved ${rows.length} articles`)
  rows.forEach((r: { rank:number;korean_title:string;urgency_score:number;market_score:number;total_score:number;tags:string[] }) =>
    console.log(`   ${r.rank}. [${r.total_score}점] ${r.korean_title} ${JSON.stringify(r.tags)}`)
  )
}

main().catch(e => { console.error('Error:', e.message); process.exit(1) })
