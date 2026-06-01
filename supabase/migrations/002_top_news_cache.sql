-- global_issues에 한글 요약 컬럼 추가
ALTER TABLE global_issues ADD COLUMN IF NOT EXISTS korean_summary TEXT;

-- AI가 생성한 TOP 7 뉴스 캐시 테이블
CREATE TABLE IF NOT EXISTS top_news_cache (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rank          INTEGER NOT NULL,
  korean_title  TEXT NOT NULL,
  korean_summary TEXT NOT NULL,
  category      TEXT NOT NULL,
  importance    TEXT NOT NULL,
  urgency_score INTEGER NOT NULL,
  market_score  INTEGER NOT NULL,
  total_score   INTEGER NOT NULL,
  source_url    TEXT,
  source_name   TEXT,
  published_at  TIMESTAMPTZ,
  cached_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE top_news_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "top_news: authenticated read"
  ON top_news_cache FOR SELECT TO authenticated USING (true);
