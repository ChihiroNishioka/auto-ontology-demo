import { describe, expect, it } from 'vitest';
// @ts-ignore - 型宣言は scripts/check-secrets.d.mts
import { isForbiddenPath, scanText } from '../../scripts/check-secrets.mjs';
import { HEX32, NOTION_HOST } from '../helpers';

const join = (...p: string[]) => p.join('');
const kinds = (t: string) => (scanText('x.md', t) as { kind: string }[]).map((f) => f.kind);

describe('check-secrets', () => {
  it('Notion のドメイン名を見つける', () => {
    expect(kinds(`見て https://${NOTION_HOST}/x`).length).toBeGreaterThan(0);
  });
  it('32 桁の 16 進を見つける（40 桁のハッシュは対象外）', () => {
    expect(kinds(`id ${HEX32}`).length).toBeGreaterThan(0);
    expect(kinds(`hash ${'c'.repeat(40)}`)).toEqual([]);
  });
  it('メールアドレス（example.com と noreply@ は許可）', () => {
    expect(kinds(join('a', '@', 'gmail', '.com')).length).toBeGreaterThan(0);
    expect(kinds(join('a', '@', 'example', '.com'))).toEqual([]);
    expect(kinds(join('noreply', '@', 'anthropic', '.com'))).toEqual([]);
  });
  it('電話番号らしい並び', () => {
    expect(kinds(join('tel 090', '-1234-', '5678')).length).toBeGreaterThan(0);
  });
  it('キー風の値（接頭辞＋十分な長さ）', () => {
    expect(kinds(join('sk', '-', 'A'.repeat(30))).length).toBeGreaterThan(0);
    expect(kinds(join('ghp', '_', 'a'.repeat(36))).length).toBeGreaterThan(0);
    expect(kinds(join('AK', 'IA', 'A'.repeat(16))).length).toBeGreaterThan(0);
    expect(kinds(join('-----BEGIN ', 'PRIVATE KEY-----')).length).toBeGreaterThan(0);
  });
  it('接頭辞だけの説明文には当たらない', () => {
    expect(kinds('sk- や ghp_ で始まる値は禁止')).toEqual([]);
  });
  it('普通の文章は通る', () => {
    expect(kinds('Claude Code と MCP。https://example.com/a')).toEqual([]);
  });
  it('追跡してはいけないパス', () => {
    expect(isForbiddenPath('local-data/x.json')).toBe(true);
    expect(isForbiddenPath('articles-rows.json')).toBe(true);
    expect(isForbiddenPath('fixtures/articles.sample.json')).toBe(false);
  });
});
