import type { Article, BuildOptions, Concept, Evidence, Glossary, Ontology, Relation, RelationType, Status } from './types';
import { buildLexicon, extractCandidates, findMentions, type Lexicon, type Mention } from './extract';
import { classifyPair } from './patterns';
import { normalizeText, sha1 } from './normalize';

export const DEFAULTS = { minDf: 2, maxConcepts: 300, maxRelated: 15 };
const MAX_EVIDENCE = 5;
const MAX_GAP = 12;

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const stable = (articles: Article[]): Article[] => {
  const best = new Map<string, Article>();
  for (const a of [...articles].sort((x, y) => cmp(x.id, y.id) || y.score - x.score || cmp(x.title, y.title))) {
    if (!best.has(a.id)) best.set(a.id, a);
  }
  return [...best.values()].sort((x, y) => cmp(x.id, y.id));
};
const resolve = (o?: BuildOptions) => ({ ...DEFAULTS, ...Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined)) }) as typeof DEFAULTS;

export function computeInputHash(articles: Article[], glossary: Glossary, stopwords: Iterable<string>, options?: BuildOptions): string {
  const payload = JSON.stringify([stable(articles), glossary, [...stopwords].sort(), resolve(options)]);
  return sha1(payload).slice(0, 16);
}

interface Occ { articleId: string; n: number; mentions: Mention[]; text: string }

export function buildOntology(articlesIn: Article[], glossary: Glossary, stopwords: Iterable<string>, options?: BuildOptions): Ontology {
  const opt = resolve(options);
  const stop = new Set(stopwords);
  const articles = stable(articlesIn);
  const score = new Map(articles.map((a) => [a.id, a.score]));
  const byScore = (a: Evidence, b: Evidence) => (score.get(b.articleId) ?? 0) - (score.get(a.articleId) ?? 0) || cmp(a.articleId, b.articleId) || a.n - b.n;

  // 1. 用語集（確認済み）
  const gEntries = glossary.concepts;
  const gLex = buildLexicon(gEntries);

  // 2. 自動抽出（下書き）：用語集に当たった部分を伏せてから候補を拾う
  const df = new Map<string, { label: string; articles: Set<string> }>();
  for (const a of articles) {
    for (const s of a.sentences) {
      let masked = s.text.normalize('NFKC');
      for (const m of findMentions(masked, gLex).reverse()) masked = masked.slice(0, m.start) + ' '.repeat(m.end - m.start) + masked.slice(m.end);
      for (const c of extractCandidates(masked, stop)) {
        const key = c.toLowerCase();
        const e = df.get(key) ?? { label: c, articles: new Set<string>() };
        e.articles.add(a.id);
        df.set(key, e);
      }
    }
  }
  const glossarySurfaces = new Set(gEntries.flatMap((g) => [g.label, ...g.synonyms]).map((x) => x.normalize('NFKC').toLowerCase()));
  const autos = [...df.entries()]
    .filter(([key, e]) => e.articles.size >= opt.minDf && !glossarySurfaces.has(key))
    .sort((a, b) => b[1].articles.size - a[1].articles.size || cmp(a[1].label, b[1].label))
    .slice(0, opt.maxConcepts)
    .map(([key, e]) => ({ id: 'auto-' + sha1(key).slice(0, 8), label: e.label, synonyms: [] as string[] }));

  const lexicon: Lexicon = buildLexicon([...gEntries, ...autos]);

  // 3. 文ごとの言及
  const occs: Occ[] = [];
  for (const a of articles) {
    for (const s of a.sentences) {
      const text = s.text.normalize('NFKC');
      const mentions = findMentions(text, lexicon);
      if (mentions.length) occs.push({ articleId: a.id, n: s.n, mentions, text });
    }
  }

  const refs = new Map<string, Evidence[]>();
  const arts = new Map<string, Set<string>>();
  for (const o of occs) {
    for (const id of new Set(o.mentions.map((m) => m.conceptId))) {
      (refs.get(id) ?? refs.set(id, []).get(id)!).push({ articleId: o.articleId, n: o.n });
      (arts.get(id) ?? arts.set(id, new Set()).get(id)!).add(o.articleId);
    }
  }
  const dropped = new Set(autos.filter((a) => (arts.get(a.id)?.size ?? 0) < opt.minDf).map((a) => a.id));
  const sentenceOf = (e: Evidence) => articles.find((a) => a.id === e.articleId)?.sentences.find((s) => s.n === e.n)?.text ?? '';
  const articleIdx = new Map(articles.map((a) => [a.id, a]));

  const concepts: Concept[] = [];
  const mk = (id: string, label: string, type: Concept['type'], status: Status, synonyms: string[], description: string) => {
    if (dropped.has(id) || !arts.has(id)) return;
    const r = [...refs.get(id)!].sort(byScore);
    const articleIds = [...arts.get(id)!].sort((x, y) => (score.get(y) ?? 0) - (score.get(x) ?? 0) || cmp(x, y));
    concepts.push({ id, label, type, status, synonyms, description: description || sentenceOf(r[0]), articleIds, refs: r });
  };
  for (const g of gEntries) mk(g.id, g.label, g.type, 'certified', g.synonyms, g.description);
  for (const a of autos) mk(a.id, a.label, /^[A-Za-z]/.test(a.label) ? 'product' : 'idea', 'auto', [], '');
  concepts.sort((x, y) => y.articleIds.length - x.articleIds.length || cmp(x.label, y.label) || cmp(x.id, y.id));
  const alive = new Set(concepts.map((c) => c.id));

  // 4. 関係
  const acc = new Map<string, { type: RelationType; source: string; target: string; ev: Evidence[] }>();
  const add = (type: RelationType, a: string, b: string, e: Evidence) => {
    let source = a, target = b;
    if (type === 'related_to' || type === 'compared_with') [source, target] = cmp(a, b) <= 0 ? [a, b] : [b, a];
    const key = `${type}:${source}:${target}`;
    (acc.get(key) ?? acc.set(key, { type, source, target, ev: [] }).get(key)!).ev.push(e);
  };
  for (const o of occs) {
    const ms = o.mentions.filter((m) => alive.has(m.conceptId));
    for (let i = 0; i < ms.length; i++) {
      for (let j = i + 1; j < ms.length; j++) {
        const A = ms[i], B = ms[j];
        if (A.conceptId === B.conceptId) continue;
        const e = { articleId: o.articleId, n: o.n };
        let kind = null;
        if (j === i + 1) {
          const gap = o.text.slice(A.end, B.start);
          if (gap.length <= MAX_GAP) kind = classifyPair(gap, o.text.slice(B.end, B.end + 14));
        }
        if (kind === 'compared_with') add('compared_with', A.conceptId, B.conceptId, e);
        else if (kind === 'uses_forward') add('uses', A.conceptId, B.conceptId, e);
        else if (kind === 'uses_backward') add('uses', B.conceptId, A.conceptId, e);
        else add('related_to', A.conceptId, B.conceptId, e);
      }
    }
  }
  let relations: Relation[] = [...acc.entries()].map(([id, v]) => {
    const ev = [...new Map(v.ev.map((e) => [`${e.articleId}:${e.n}`, e])).values()].sort(byScore);
    return { id, type: v.type, source: v.source, target: v.target, weight: new Set(ev.map((e) => e.articleId)).size, status: 'auto' as Status, evidence: ev.slice(0, MAX_EVIDENCE) };
  });

  // 共起だけの辺は、各概念の重み上位 maxRelated 本まで
  const label = new Map(concepts.map((c) => [c.id, c.label]));
  const keep = new Set<string>();
  const perConcept = new Map<string, Relation[]>();
  for (const r of relations.filter((x) => x.type === 'related_to')) {
    for (const end of [r.source, r.target]) (perConcept.get(end) ?? perConcept.set(end, []).get(end)!).push(r);
  }
  for (const [c, list] of perConcept) {
    list.sort((a, b) => b.weight - a.weight || cmp(label.get(a.source === c ? a.target : a.source) ?? '', label.get(b.source === c ? b.target : b.source) ?? '') || cmp(a.id, b.id));
    for (const r of list.slice(0, opt.maxRelated)) keep.add(r.id);
  }
  relations = relations.filter((r) => r.type !== 'related_to' || keep.has(r.id));

  // 用語集の関係（確認済み）
  for (const g of gEntries) {
    for (const r of g.relations) {
      if (!alive.has(g.id) || !alive.has(r.target)) continue;
      relations.push({ id: `${r.type}:${g.id}:${r.target}`, type: r.type, source: g.id, target: r.target, weight: 1, status: 'certified', evidence: [] });
    }
  }
  const order: Record<RelationType, number> = { is_a: 0, made_by: 1, uses: 2, compared_with: 3, related_to: 4 };
  relations.sort((a, b) => b.weight - a.weight || order[a.type] - order[b.type] || cmp(a.source, b.source) || cmp(a.target, b.target));
  void articleIdx; void normalizeText;

  return {
    concepts,
    relations,
    articles,
    meta: {
      inputHash: computeInputHash(articlesIn, glossary, stop, options),
      builtAt: new Date().toISOString(),
      counts: { articles: articles.length, concepts: concepts.length, relations: relations.length },
    },
  };
}
