import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadArticles, parseArticles } from '../../server/data/loader';
import { FIX, HEX32, NOTION_URL, SAMPLE, readJson, tmpDir } from '../helpers';

const row = (extra: Record<string, unknown> = {}) => ({
  Title: 'テスト記事',
  'userDefined:URL': 'https://example.com/a',
  Summary: '要約です。',
  ...extra,
});

describe('parseArticles', () => {
  it('{results} 形を読む', () => {
    const a = parseArticles({ results: [row()], has_more: true });
    expect(a).toHaveLength(1);
    expect(a[0].title).toBe('テスト記事');
    expect(a[0].url).toBe('https://example.com/a');
  });
  it('配列形を読む', () => {
    expect(parseArticles([row(), row({ Title: '二つ目', 'userDefined:URL': 'https://example.com/b' })])).toHaveLength(2);
  });
  it('欄が欠けていても落ちない', () => {
    const a = parseArticles([{ Title: 'だけ' }, {}]);
    expect(a[0].sentences.length).toBeGreaterThan(0);
    expect(a[0].relatedIds).toEqual([]);
    expect(a[0].score).toBe(0);
  });
  it('Canonical URL を優先し、Source のリンク記法を外す', () => {
    const a = parseArticles([row({ 'Canonical URL': 'https://example.com/canon', Source: '[架空](https://example.com/s)' })]);
    expect(a[0].url).toBe('https://example.com/canon');
    expect(a[0].sourceLabel).toBe('架空');
  });
  it('Notion の URL・ID・Processing Note・Concepts を残さない', () => {
    const raw = [
      row({ url: NOTION_URL, 'Processing Note': 'ログ ' + HEX32, Concepts: [NOTION_URL], Claims: [NOTION_URL], 'Content Fingerprint': HEX32 }),
    ];
    const out = JSON.stringify(parseArticles(raw));
    expect(out).not.toMatch(/notion/i);
    expect(out).not.toContain(HEX32);
    expect(out).not.toContain('ログ');
  });
  it('Related Articles は記事 ID に置き換える（見つからない URL は捨てる）', () => {
    const other = 'https://example.com/page/other';
    const raw = [
      row({ url: 'https://example.com/page/me', 'Related Articles': [other, NOTION_URL] }),
      row({ Title: '他', 'userDefined:URL': 'https://example.com/other', url: other }),
    ];
    const a = parseArticles(raw);
    expect(a[0].relatedIds).toEqual([a[1].id]);
    expect(JSON.stringify(a)).not.toMatch(/notion/i);
  });
  it('Summary 空でも読める（抽出対象外の目印は sentences が題名だけ）', () => {
    expect(parseArticles([{ Title: 'T', 'userDefined:URL': 'https://example.com/z' }])[0].sentences).toHaveLength(1);
  });
  it('fixture を読める', () => {
    const a = parseArticles(readJson(SAMPLE));
    expect(a).toHaveLength(10);
    expect(new Set(a.map((x) => x.id)).size).toBe(10);
  });
});

describe('loadArticles', () => {
  it('無いファイルは DATA_NOT_FOUND', async () => {
    await expect(loadArticles(path.join(tmpDir(), 'nope.json'))).rejects.toMatchObject({ code: 'DATA_NOT_FOUND' });
  });
  it('壊れた JSON は DATA_INVALID', async () => {
    await expect(loadArticles(FIX('articles.broken.json'))).rejects.toMatchObject({ code: 'DATA_INVALID' });
  });
  it('配列でも {results} でもない JSON は DATA_INVALID', async () => {
    const p = path.join(tmpDir(), 'x.json');
    fs.writeFileSync(p, '{"foo": 1}');
    await expect(loadArticles(p)).rejects.toMatchObject({ code: 'DATA_INVALID' });
  });
  it('0 件は空配列', async () => {
    expect((await loadArticles(FIX('articles.empty.json'))).articles).toEqual([]);
  });
  it('エラーメッセージにパスを含めない', async () => {
    const p = path.join(tmpDir(), 'secret-dir-name.json');
    await loadArticles(p).catch((e) => expect(String(e.message)).not.toContain('secret-dir-name'));
  });
});
