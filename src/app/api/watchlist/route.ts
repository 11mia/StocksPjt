import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 401 }, { status: 401 })

  const { data, error } = await supabase
    .from('watchlist_items')
    .select('*')
    .order('added_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message, code: 500 }, { status: 500 })
  return NextResponse.json({ data })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 401 }, { status: 401 })

  const { ticker, company } = await request.json()
  if (!ticker) return NextResponse.json({ error: 'ticker required', code: 400 }, { status: 400 })

  const { data, error } = await supabase
    .from('watchlist_items')
    .insert({ user_id: user.id, ticker: ticker.toUpperCase(), company: company ?? null })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message, code: 500 }, { status: 500 })

  // 기존 이슈 전체에서 해당 ticker 소급 스캔 → alerts 생성
  backfillAlertsForTicker(user.id, ticker.toUpperCase()).catch(err =>
    console.error('[watchlist] backfill error:', err)
  )

  return NextResponse.json({ data })
}

async function backfillAlertsForTicker(userId: string, ticker: string) {
  const admin = createAdminClient()

  const { data: issues } = await admin
    .from('global_issues')
    .select('id, title')
    .ilike('title', `%${ticker}%`)

  if (!issues?.length) return

  // 이미 생성된 alert의 issue_id 목록 조회 (중복 방지)
  const issueIds = issues.map(i => i.id)
  const { data: existing } = await admin
    .from('alerts')
    .select('issue_id')
    .eq('user_id', userId)
    .eq('ticker', ticker)
    .in('issue_id', issueIds)

  const existingIssueIds = new Set((existing ?? []).map((r: { issue_id: string }) => r.issue_id))

  const newAlerts = issues
    .filter(i => !existingIssueIds.has(i.id))
    .map(issue => ({
      user_id: userId,
      issue_id: issue.id,
      ticker,
      message: `[${ticker}] 관련 이슈: ${issue.title.slice(0, 100)}`,
    }))

  if (newAlerts.length > 0) {
    await admin.from('alerts').insert(newAlerts)
  }
}
