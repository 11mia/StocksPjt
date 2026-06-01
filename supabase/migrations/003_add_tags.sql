-- TOP 10 뉴스 캐시 테이블에 테마 태그 컬럼 추가
ALTER TABLE top_news_cache ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
