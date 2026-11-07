import fs from 'node:fs/promises';
import { articleId, buildSentences, normalizeText, normalizeUrl } from '../ontology/normalize';
import type { Article } from '../ontology/types';

export class DataError extends Error {
  constructor(public code: 'DATA_NOT_FOUND' | 'DATA_INVALID', message: string) {
    super(message);
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

function urlList(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string' && v.trim()) {
    try {
      const p = JSON.parse(v);
      if (Array.isArray(p)) return p.filter((x): x is string => typeof x === 'string');
    } catch { /* 下へ */ }
    return v.split(/[,\s]+/).filter(Boolean);
  }
  return [];
}

export function parseArticles(raw: unknown): Article[] {
  const rows: unknown = Array.isArray(raw) ? raw : (raw as { results?: unknown } | null)?.results;
  if (!Array.isArray(rows)) throw new DataError('DATA_INVALID', '記事データの形式が違います（配列か {"results": [...]} が必要です）。');
  const objs = rows.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r));

  // Related Articles は元データでは別ページの URL。内部 ID に置き換えて元の URL は捨てる。
  const ids: string[] = [];
  const byPage = new Map<string, string>();
  const base = objs.map((r) => {
    const title = normalizeText(str(r['Title'])) || '（無題）';
    const url = str(r['Canonical URL']).trim() || str(r['userDefined:URL']).trim();
    const id = articleId(url, title);
    ids.push(id);
    const page = normalizeUrl(str(r['url']));
    if (page) byPage.set(page, id);
    return { r, title, url, id };
  });

  return base.map(({ r, title, url, id }) => {
    const related = [...new Set(urlList(r['Related Articles']).map((u) => byPage.get(normalizeUrl(u))).filter((x): x is string => !!x && x !== id))];
    const score = Number(r['AI Score']);
    return {
      id,
      title,
      url,
      sourceLabel: normalizeText(str(r['Source'])),
      contentType: str(r['Content Type']).trim(),
      capturedAt: str(r['date:Captured At:start']).trim().slice(0, 10),
      score: Number.isFinite(score) ? score : 0,
      sentences: buildSentences({
        title,
        summary: str(r['Summary']),
        takeaways: str(r['Key Takeaways']),
        delta: str(r['Knowledge Delta']),
      }),
      relatedIds: related.sort(),
    };
  });
}

export async function loadArticles(file: string): Promise<{ articles: Article[] }> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new DataError('DATA_NOT_FOUND', '記事データのファイルが見つかりません。');
    }
    throw new DataError('DATA_INVALID', '記事データのファイルを読めません。');
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new DataError('DATA_INVALID', '記事データが壊れています（JSON として読めません）。');
  }
  return { articles: parseArticles(json) };
}
