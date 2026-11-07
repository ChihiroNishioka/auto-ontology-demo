import { expect, test, type Page } from '@playwright/test';

const noHScroll = async (page: Page) => {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(w[0]).toBeLessThanOrEqual(w[1]);
};
const bigEnough = async (page: Page) => {
  const hs = await page.evaluate(() =>
    [...document.querySelectorAll('button, nav a, input')]
      .filter((e) => (e as HTMLElement).offsetParent !== null)
      .map((e) => [e.tagName + ':' + (e.textContent || '').slice(0, 10), e.getBoundingClientRect().height]),
  );
  for (const [name, h] of hs) expect(h, String(name)).toBeGreaterThanOrEqual(43.5);
};
const center = (page: Page) => page.getByTestId('center-label');

test.describe('グラフ', () => {
  test('初期の中心が出て、隣をタップすると移り、パンくずで戻れる', async ({ page }) => {
    await page.goto('/');
    await expect(center(page)).not.toHaveText('');
    const first = (await center(page).textContent())!;
    const neighbor = page.getByTestId('neighbor-list').locator('button').first();
    const name = (await neighbor.getAttribute('data-label'))!;
    await neighbor.click();
    await expect(center(page)).toHaveText(name);
    await expect(page.getByTestId('breadcrumb').locator('button')).toHaveCount(2);
    await page.getByTestId('breadcrumb').locator('button').first().click();
    await expect(center(page)).toHaveText(first);
    await noHScroll(page);
    await bigEnough(page);
    await page.screenshot({ path: `docs/screenshots/graph-${test.info().project.name}.png`, fullPage: true });
  });
  test('サンプルデータの帯とデータ源', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('sample-banner')).toContainText('サンプルデータ');
    await expect(page.getByTestId('data-source')).toContainText('架空の記事');
    await expect(page.locator('body')).not.toContainText('articles.sample');
  });
  test('検索 0 件で「見つかりませんでした」', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('searchbox', { name: '概念を検索' }).fill('ぬるぽぬるぽ');
    await expect(page.getByText('見つかりませんでした')).toBeVisible();
  });
  test('検索して選ぶと中心が移る', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('searchbox', { name: '概念を検索' }).fill('検索拡張生成');
    await page.getByRole('option', { name: /RAG/ }).first().click();
    await expect(center(page)).toHaveText('RAG');
  });
});

test.describe('概念詳細', () => {
  test('関係と出典記事が出て、記事リンクは新しいタブ', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: '詳細を見る' }).click();
    await expect(page).toHaveURL(/\/concept\//);
    await expect(page.getByTestId('relations')).toBeVisible();
    const links = page.getByTestId('articles').locator('a[href^="https://example.com/"]');
    expect(await links.count()).toBeGreaterThan(0);
    await expect(links.first()).toHaveAttribute('target', '_blank');
    await expect(links.first()).toHaveAttribute('rel', /noopener/);
    await noHScroll(page);
    await bigEnough(page);
  });
  test('存在しない概念', async ({ page }) => {
    await page.goto('/concept/no-such');
    await expect(page.getByText('その概念は見つかりません')).toBeVisible();
    await page.getByRole('link', { name: 'グラフへ戻る' }).click();
    await expect(center(page)).toBeVisible();
  });
});

test.describe('質問', () => {
  test('例の質問で経路と根拠の記事が出て、?q= で再現できる', async ({ page }) => {
    await page.goto('/ask');
    await page.getByTestId('example').first().click();
    await expect(page.getByTestId('verdict')).toContainText('答えられます');
    expect(await page.getByTestId('path').count()).toBeGreaterThan(0);
    await page.getByTestId('path').first().getByText(/根拠/).first().click();
    await expect(page.getByTestId('path').first().locator('a[href^="https://example.com/"]').first()).toBeVisible();
    await expect(page.getByTestId('shared-articles')).toBeVisible();
    await expect(page).toHaveURL(/[?&]q=/);
    const verdict = await page.getByTestId('verdict').textContent();
    await page.reload();
    await expect(page.getByTestId('verdict')).toHaveText(verdict!);
    await expect(page.getByTestId('path').first()).toBeVisible();
    await noHScroll(page);
    await bigEnough(page);
    await page.screenshot({ path: `docs/screenshots/ask-${test.info().project.name}.png`, fullPage: true });
  });
  test('答えられない質問は候補つき', async ({ page }) => {
    await page.goto('/ask');
    await page.getByRole('textbox', { name: '質問' }).fill('量子コンピュータの冷却方式は？');
    await page.getByRole('button', { name: '質問する' }).click();
    await expect(page.getByTestId('verdict')).toContainText('答えられません');
    await expect(page.getByTestId('suggestions')).toBeVisible();
    await noHScroll(page);
  });
  test('空の質問は送れない', async ({ page }) => {
    await page.goto('/ask');
    await expect(page.getByRole('button', { name: '質問する' })).toBeDisabled();
  });
});

test.describe('状態', () => {
  test('読み込み中：スケルトンと「読み込み中…」', async ({ page }) => {
    await page.route('**/api/graph*', async (route) => { await new Promise((r) => setTimeout(r, 1200)); await route.continue(); });
    await page.goto('/');
    await expect(page.getByRole('status')).toContainText('読み込み中…');
    await expect(center(page)).toBeVisible({ timeout: 15000 });
  });
  test('エラー：表示 → もう一度試すで回復', async ({ page }) => {
    await page.route('**/api/graph*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"X","message":"x"}}' }));
    await page.goto('/');
    await expect(page.getByText('データを読み込めませんでした')).toBeVisible();
    await noHScroll(page);
    await page.unroute('**/api/graph*');
    await page.getByRole('button', { name: 'もう一度試す' }).click();
    await expect(center(page)).toBeVisible();
  });
  test('0 件：記事がありません', async ({ page }) => {
    await page.goto('http://127.0.0.1:5190/');
    await expect(page.getByText('記事がありません')).toBeVisible();
    await noHScroll(page);
  });
  test('データファイルが無い：案内画面（パスは出さない）', async ({ page }) => {
    await page.goto('http://127.0.0.1:5189/');
    await expect(page.getByText('ARTICLES_PATH').first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText('no-such-file');
    await noHScroll(page);
    await page.goto('http://127.0.0.1:5189/ask');
    await expect(page.getByText('ARTICLES_PATH').first()).toBeVisible();
  });
});
