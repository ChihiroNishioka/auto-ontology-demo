export interface LexEntry { id: string; label: string; synonyms: string[] }
export interface Mention { start: number; end: number; conceptId: string; surface: string }
export interface Lexicon { byFirst: Map<string, { s: string; id: string }[]> }

const isAlnum = (c: string | undefined) => !!c && /[A-Za-z0-9]/.test(c);

export function buildLexicon(entries: LexEntry[]): Lexicon {
  const seen = new Set<string>();
  const byFirst: Lexicon['byFirst'] = new Map();
  for (const e of entries) {
    for (const raw of [e.label, ...e.synonyms]) {
      const s = raw.normalize('NFKC').trim().toLowerCase();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      const list = byFirst.get(s[0]) ?? [];
      list.push({ s, id: e.id });
      byFirst.set(s[0], list);
    }
  }
  for (const list of byFirst.values()) list.sort((a, b) => b.s.length - a.s.length);
  return { byFirst };
}

export function findMentions(text: string, lex: Lexicon): Mention[] {
  const t = text.normalize('NFKC');
  const lower = t.toLowerCase();
  const out: Mention[] = [];
  let i = 0;
  while (i < lower.length) {
    const cands = lex.byFirst.get(lower[i]);
    let hit: { s: string; id: string } | undefined;
    if (cands) {
      for (const c of cands) {
        if (!lower.startsWith(c.s, i)) continue;
        const end = i + c.s.length;
        if (isAlnum(c.s[0]) && isAlnum(lower[i - 1])) continue;
        if (isAlnum(c.s[c.s.length - 1]) && (isAlnum(lower[end]) || (lower[end] === '.' && isAlnum(lower[end + 1])))) continue;
        hit = c;
        break;
      }
    }
    if (hit) {
      out.push({ start: i, end: i + hit.s.length, conceptId: hit.id, surface: t.slice(i, i + hit.s.length) });
      i += hit.s.length;
    } else i++;
  }
  return out;
}

const LATIN = /[A-Z][A-Za-z0-9.+-]*(?: [A-Z][A-Za-z0-9.+-]*){0,2}/g;
const KATAKANA = /[ァ-ヶー]{3,}(?:・[ァ-ヶー]{2,})*/g;
const QUOTED = /[「『]([^」』]{2,20})[」』]/g;

export function extractCandidates(text: string, stop: Set<string>): string[] {
  const t = text.normalize('NFKC');
  const found: string[] = [];
  for (const m of t.matchAll(LATIN)) found.push(m[0].replace(/[.-]+$/, ''));
  for (const m of t.matchAll(KATAKANA)) found.push(m[0]);
  for (const m of t.matchAll(QUOTED)) found.push(m[1].trim());
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of found) {
    if (c.length < 2 || /^[\d.+\-\s]+$/.test(c) || stop.has(c)) continue;
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
