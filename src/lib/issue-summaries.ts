import Anthropic from '@anthropic-ai/sdk'
import { unstable_cache } from 'next/cache'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// issueKeys 형식: "id:::title"
async function generateSummaries(issueKeys: string[]): Promise<Record<string, string>> {
  if (issueKeys.length === 0) return {}

  const issues = issueKeys.map(key => {
    const sepIdx = key.indexOf(':::')
    return { id: key.slice(0, sepIdx), title: key.slice(sepIdx + 3) }
  })

  const numbered = issues.map((issue, i) => `[${i + 1}] ${issue.title}`).join('\n')

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    messages: [
      {
        role: 'user',
        content: `다음 영문 기사 제목들을 각각 한글로 2문장 요약해주세요. 무슨 일이 일어났는지와 그 중요성을 간결하게 설명해주세요.

${numbered}

반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{"summaries": ["요약1", "요약2", ...(총 ${issues.length}개)]}`,
      },
    ],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return {}

  const parsed = JSON.parse(match[0]) as { summaries: string[] }
  const result: Record<string, string> = {}
  issues.forEach((issue, i) => {
    result[issue.id] = parsed.summaries[i] ?? ''
  })
  return result
}

// 동일한 이슈 집합에 대해 24시간 캐시
export const getIssueSummaries = unstable_cache(generateSummaries, ['issue-summaries'], {
  revalidate: 86400,
})
