import { test, expect } from '@playwright/test'

const TEST_EMAIL = process.env.E2E_TEST_EMAIL ?? ''
const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD ?? ''

test.describe('대시보드 (로그인 필요)', () => {
  test.skip(!TEST_EMAIL || !TEST_PASSWORD, 'E2E_TEST_EMAIL / E2E_TEST_PASSWORD 미설정')

  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.locator('input[type="email"]').fill(TEST_EMAIL)
    await page.locator('input[type="password"]').fill(TEST_PASSWORD)
    await page.getByRole('button', { name: '로그인' }).click()
    await expect(page).toHaveURL('/', { timeout: 15000 })
  })

  test('대시보드 홈이 정상 렌더링된다', async ({ page }) => {
    await expect(page.getByText('StockRadar', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Watchlist').first()).toBeVisible()
    await expect(page.getByText('글로벌 이슈').first()).toBeVisible()
    await expect(page.getByText('알림').first()).toBeVisible()
  })

  test('미국 주요 이슈 TOP 7 섹션이 표시된다', async ({ page }) => {
    // 페이지 로딩 (AI 요약 포함, 최대 60초 대기)
    await expect(page.getByText('오늘의 미국 주요 이슈 TOP 7')).toBeVisible({ timeout: 60000 })
    // 이슈 목록이 렌더링되었는지 확인
    const issueList = page.locator('[data-testid="top-issues-list"]')
    await expect(issueList).toBeVisible({ timeout: 60000 })
    // 최소 1개 이상의 이슈가 표시되는지 확인
    const articles = issueList.locator('article')
    await expect(articles.first()).toBeVisible({ timeout: 60000 })
  })

  test('이슈 카드에 원문 보기 링크가 있다', async ({ page }) => {
    await expect(page.getByText('오늘의 미국 주요 이슈 TOP 7')).toBeVisible({ timeout: 60000 })
    const issueList = page.locator('[data-testid="top-issues-list"]')
    await expect(issueList).toBeVisible({ timeout: 60000 })
    // 원문 보기 링크가 최소 1개 이상 존재하는지 확인
    const sourceLinks = page.getByText('원문 보기 ↗')
    await expect(sourceLinks.first()).toBeVisible({ timeout: 60000 })
  })

  test('Watchlist 페이지가 정상 렌더링된다', async ({ page }) => {
    await page.goto('/watchlist')
    await expect(page.getByText('Watchlist')).toBeVisible()
    await expect(page.locator('input[placeholder*="티커"]')).toBeVisible()
  })

  test('이슈 피드 페이지가 정상 렌더링된다', async ({ page }) => {
    await page.goto('/issues')
    await expect(page.getByRole('heading', { name: '글로벌 이슈' })).toBeVisible()
  })

  test('알림 페이지가 정상 렌더링된다', async ({ page }) => {
    await page.goto('/alerts')
    await expect(page.getByText('알림 센터')).toBeVisible()
  })

  test('로그아웃 후 /login으로 리다이렉트된다', async ({ page }) => {
    await page.getByRole('button', { name: '로그아웃' }).click()
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 })
  })
})
