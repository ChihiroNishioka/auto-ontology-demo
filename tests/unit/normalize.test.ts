import { describe, expect, it } from 'vitest';
import { articleId, buildSentences, normalizeText } from '../../server/ontology/normalize';

describe('normalizeText', () => {
  it('NFKC に正規化する（全角英数→半角）', () => {
    expect(normalizeText('ＡＢＣ１２３')).toBe('ABC123');
  });
  it('markdown リンクは文字だけ残す', () => {
    expect(normalizeText('見る [架空ブログ](https://example.com/b) へ')).toBe('見る 架空ブログ へ');
  });
  it('エスケープされた記号を戻す', () => {
    expect(normalizeText('\\$100 と 1\\.5')).toBe('$100 と 1.5');
  });
  it('<br /> は改行にする', () => {
    expect(normalizeText('a<br />b<br/>c')).toBe('a\nb\nc');
  });
});

describe('buildSentences', () => {
  const s = buildSentences({
    title: 'タイトル',
    summary: '一つ目の文。二つ目の文！三つ目?',
    takeaways: '・要点A<br />・要点B',
    delta: 'Extend: 差分の文',
  });
  it('タイトル→要約→要点→差分の順で番号を振る', () => {
    expect(s.map((x) => x.text)).toEqual([
      'タイトル', '一つ目の文', '二つ目の文', '三つ目', '要点A', '要点B', '差分の文',
    ]);
    expect(s.map((x) => x.n)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
  it('空欄は無視する', () => {
    expect(buildSentences({ title: 'T', summary: '', takeaways: '', delta: '' })).toEqual([{ n: 0, text: 'T' }]);
  });
  it('Contrast: など他の接頭辞も外す', () => {
    const r = buildSentences({ title: 'T', summary: '', takeaways: '', delta: 'Contrast: 比べると違う' });
    expect(r[1].text).toBe('比べると違う');
  });
});

describe('articleId', () => {
  it('10 桁の 16 進で、同じ入力なら同じ', () => {
    const a = articleId('https://example.com/x', 't');
    expect(a).toMatch(/^[0-9a-f]{10}$/);
    expect(articleId('https://example.com/x', 't')).toBe(a);
  });
  it('末尾スラッシュと utm_ は無視する', () => {
    expect(articleId('https://example.com/x/?utm_source=a', 't')).toBe(articleId('https://example.com/x', 't'));
  });
  it('URL が無ければタイトルで作る', () => {
    expect(articleId('', 'タイトル')).toMatch(/^[0-9a-f]{10}$/);
    expect(articleId('', 'タイトル')).not.toBe(articleId('', '別'));
  });
});
