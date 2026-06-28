import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 401 }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const category = searchParams.get('category')
  const q = searchParams.get('q')?.trim()

  let query = supabase
    .from('global_issues')
    .select('id, title, source_url, category, published_at, korean_summary')
    .order('published_at', { ascending: false })
    .limit(20)

  if (category && category !== '전체') query = query.eq('category', category)
  if (q) query = query.ilike('title', `%${q}%`)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message, code: 500 }, { status: 500 })

  const issues = data ?? []

  // korean_summary가 없는 항목만 AI로 생성 후 DB에 저장
  const missing = issues.filter(i => !i.korean_summary)
  if (missing.length > 0) {
    try {
      const anthropicKey = process.env.ANTHROPIC_API_KEY
      if (anthropicKey) {
        const client = new Anthropic({ apiKey: anthropicKey })
        const numbered = missing.map((i, idx) => `[${idx + 1}] ${i.title}`).join('\n')

        const response = await client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 3000,
          messages: [{
            role: 'user',
            content: `다음 영문 기사 제목들을 각각 한글로 2문장 요약해주세요. 무슨 일이 일어났는지와 그 중요성을 간결하게 설명해주세요.

${numbered}

반드시 아래 JSON 형식으로만 응답하세요:
{"summaries": ["요약1", "요약2", ...(총 ${missing.length}개)]}`,
          }],
        })

        const text = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
        const match = text.match(/\{[\s\S]*\}/)
        if (match) {
          const parsed = JSON.parse(match[0]) as { summaries: string[] }
          const admin = createAdminClient()
          await Promise.all(
            missing.map((issue, idx) => {
              const summary = parsed.summaries[idx]
              if (!summary) return Promise.resolve()
              return admin
                .from('global_issues')
                .update({ korean_summary: summary })
                .eq('id', issue.id)
            })
          )
          // 생성된 요약을 결과에 반영
          missing.forEach((issue, idx) => {
            const found = issues.find(i => i.id === issue.id)
            if (found) found.korean_summary = parsed.summaries[idx] ?? null
          })
        }
      }
    } catch {
      // 요약 생성 실패 시 기존 null 그대로 반환
    }
  }

  return NextResponse.json({ data: issues })
}
