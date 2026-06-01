-- TOP 10 뉴스에 AI 분석 3개 필드 추가
ALTER TABLE top_news_cache ADD COLUMN IF NOT EXISTS price_impact_reason TEXT;
ALTER TABLE top_news_cache ADD COLUMN IF NOT EXISTS institution_trend TEXT;
