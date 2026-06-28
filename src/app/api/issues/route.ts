import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized', code: 401 }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const category = searchParams.get('category')
  const id = searchParams.get('id')
  const q = searchParams.get('q')?.trim()

  let query = supabase
    .from('global_issues')
    .select('*')
    .order('published_at', { ascending: false })
    .limit(50)

  if (category) query = query.eq('category', category)
  if (id) query = query.eq('id', id).limit(1)
  if (q) query = query.ilike('title', `%${q}%`)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message, code: 500 }, { status: 500 })
  return NextResponse.json({ data })
}
