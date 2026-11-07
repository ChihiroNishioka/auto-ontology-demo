import { createHash } from 'node:crypto';
import type { Sentence } from './types';

export function normalizeText(s: string): string {
  return String(s ?? '')
    .normalize('NFKC')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\\([$.\-_*#()[\]!+~`|<>])/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

const END = /[。!?\n]|\.(?=\s|$)/;
const split = (s: string): string[] =>
  s.split(new RegExp(END.source, 'g')).map((x) => x.trim()).filter(Boolean);

export function buildSentences(f: { title: string; summary: string; takeaways: string; delta: string }): Sentence[] {
  const out: string[] = [];
  const title = normalizeText(f.title);
  if (title) out.push(title);
  out.push(...split(normalizeText(f.summary)));
  for (const line of normalizeText(f.takeaways).split('\n')) {
    const t = line.replace(/^[・•\-*\s]+/, '').trim();
    if (t) out.push(t);
  }
  const delta = normalizeText(f.delta).replace(/^[A-Za-z]+\s*:\s*/, '').trim();
  if (delta) out.push(delta);
  return out.map((text, n) => ({ n, text }));
}

export function normalizeUrl(url: string): string {
  const u = String(url ?? '').trim();
  if (!u) return '';
  try {
    const p = new URL(u);
    for (const k of [...p.searchParams.keys()]) if (k.startsWith('utm_')) p.searchParams.delete(k);
    p.hash = '';
    return p.toString().replace(/\/+$/, '');
  } catch {
    return u.replace(/\/+$/, '');
  }
}

export const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

export function articleId(url: string, title: string): string {
  const u = normalizeUrl(url);
  return sha1(u ? `url:${u}` : `title:${normalizeText(title)}`).slice(0, 10);
}
