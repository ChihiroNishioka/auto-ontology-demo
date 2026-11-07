import type { Article, Concept, Ontology, Relation } from '../ontology/types';
import { buildLexicon, extractCandidates, findMentions, type Lexicon } from '../ontology/extract';
import { judgeCoverage, VERDICT_LABEL } from './coverage';
import { buildAdjacency, findPaths, type Path } from './paths';
import { labelFor } from './labels';

export const artView = (a: Article) => ({ id: a.id, title: a.title, url: a.url, contentType: a.contentType, sourceLabel: a.sourceLabel, capturedAt: a.capturedAt });

export class Engine {
  byId: Map<string, Concept>;
  artById: Map<string, Article>;
  lex: Lexicon;
  constructor(public o: Ontology, public stop: Set<string>) {
    this.byId = new Map(o.concepts.map((c) => [c.id, c]));
    this.artById = new Map(o.articles.map((a) => [a.id, a]));
    this.lex = buildLexicon(o.concepts);
  }
  evidence(r: Relation) {
    return r.evidence.flatMap((e) => {
      const a = this.artById.get(e.articleId);
      const text = a?.sentences.find((s) => s.n === e.n)?.text;
      return a && text ? [{ text, article: artView(a) }] : [];
    });
  }
  cview = (id: string) => { const c = this.byId.get(id)!; return { id, label: c.label, type: c.type, status: c.status }; };
  pathView(p: Path) {
    return {
      nodes: p.nodes.map(this.cview),
      cost: p.cost,
      edges: p.edges.map((r, i) => {
        const from = p.nodes[i];
        const reversed = r.source !== from;
        return { id: r.id, type: r.type, label: labelFor(r.type, reversed), from, to: p.nodes[i + 1], weight: r.weight, status: r.status, evidence: this.evidence(r) };
      }),
    };
  }
  neighbors(id: string, limit = 5) {
    const agg = new Map<string, number>();
    for (const r of this.o.relations) {
      const other = r.source === id ? r.target : r.target === id ? r.source : null;
      if (other) agg.set(other, (agg.get(other) ?? 0) + r.weight);
    }
    return [...agg.entries()]
      .map(([oid, weight]) => ({ ...this.cview(oid), weight }))
      .sort((a, b) => b.weight - a.weight || (a.label < b.label ? -1 : 1))
      .slice(0, limit);
  }
  suggest(tokens: string[]) {
    const out: Concept[] = [];
    const seen = new Set<string>();
    const push = (c: Concept) => { if (!seen.has(c.id) && out.length < 5) { seen.add(c.id); out.push(c); } };
    const terms = tokens.map((t) => t.toLowerCase()).filter((t) => t.length >= 2);
    for (const t of terms) for (const c of this.o.concepts) if ([c.label, ...c.synonyms].some((s) => s.toLowerCase().startsWith(t))) push(c);
    for (const t of terms) for (const c of this.o.concepts) if ([c.label, ...c.synonyms].some((s) => s.toLowerCase().includes(t))) push(c);
    if (!out.length) this.o.concepts.slice(0, 5).forEach(push); // 近い語が無ければよく出る概念
    return out.map((c) => this.cview(c.id));
  }
  examples(): string[] {
    const adj = buildAdjacency(this.o.relations);
    const top = this.o.concepts.slice(0, 60);
    const cands: { a: Concept; b: Concept; score: number }[] = [];
    for (const a of top) {
      const direct = new Set((adj.get(a.id) ?? []).map((e) => e.to));
      const seen = new Set<string>();
      for (const e1 of adj.get(a.id) ?? []) for (const e2 of adj.get(e1.to) ?? []) {
        const b = this.byId.get(e2.to);
        if (!b || b.id === a.id || direct.has(b.id) || seen.has(b.id) || a.id > b.id) continue;
        seen.add(b.id);
        cands.push({ a, b, score: a.articleIds.length + b.articleIds.length + e1.rel.weight + e2.rel.weight });
      }
    }
    cands.sort((x, y) => y.score - x.score || (x.a.id + x.b.id < y.a.id + y.b.id ? -1 : 1));
    const out: string[] = [];
    const used = new Set<string>();
    for (const pass of [0, 1]) {
      for (const { a, b } of cands) {
        if (out.length >= 3) break;
        if (pass === 0 && (used.has(a.id) || used.has(b.id))) continue;
        const q = `${a.label} と ${b.label} はどうつながる？`;
        if (out.includes(q)) continue;
        const ids = findMentions(q.normalize('NFKC'), this.lex).map((m) => m.conceptId);
        if (ids.length !== 2 || !ids.includes(a.id) || !ids.includes(b.id)) continue;
        const fp = findPaths(this.o.relations, ids[0], ids[1])[0];
        if (!fp || fp.nodes.length !== 3 || fp.edges.some((e) => e.evidence.length === 0)) continue; // 根拠の文がある経路だけ例にする
        out.push(q); used.add(a.id); used.add(b.id);
      }
    }
    return out;
  }

  ask(question: string) {
    const q = question.normalize('NFKC');
    const ments = findMentions(q, this.lex);
    const matchedIds = [...new Set(ments.map((m) => m.conceptId))];
    let masked = q;
    for (const m of [...ments].reverse()) masked = masked.slice(0, m.start) + ' '.repeat(m.end - m.start) + masked.slice(m.end);
    const unmatched = extractCandidates(masked, this.stop);
    const { coverage, verdict } = judgeCoverage(matchedIds.length, unmatched.length);
    const matched = matchedIds.map(this.cview);
    const base = { verdict, verdictLabel: VERDICT_LABEL[verdict], coverage, matched, unmatched, suggestions: [] as ReturnType<Engine['suggest']>, paths: [] as ReturnType<Engine['pathView']>[], sharedArticles: [] as ReturnType<typeof artView>[], neighbors: [] as ReturnType<Engine['neighbors']>, answer: '' };
    if (!matchedIds.length) {
      base.suggestions = this.suggest([...unmatched, ...q.split(/[\s、。,.?!？！の は が を と]+/)]);
      base.answer = 'この記事集からは答えられません。近い概念の候補を下に出します。';
      return base;
    }
    const names = matched.map((m) => m.label);
    const shared = this.o.articles
      .filter((a) => matchedIds.every((id) => this.byId.get(id)!.articleIds.includes(a.id)))
      .sort((x, y) => y.score - x.score).slice(0, 5);
    base.sharedArticles = shared.map(artView);
    if (matchedIds.length === 1) {
      const c = this.byId.get(matchedIds[0])!;
      base.neighbors = this.neighbors(c.id);
      base.answer = `${c.label}：${c.description}。` + (base.neighbors.length ? `つながりが強い概念は ${base.neighbors.map((n) => n.label).join('、')} です（出典の記事 ${c.articleIds.length} 件）。` : '');
    } else {
      for (let i = 0; i + 1 < matchedIds.length; i++) {
        const ps = findPaths(this.o.relations, matchedIds[i], matchedIds[i + 1]);
        base.paths.push(...(matchedIds.length === 2 ? ps : ps.slice(0, 1)).map((p) => this.pathView(p)));
      }
      const p = base.paths[0];
      if (p) {
        const arts = new Set(p.edges.flatMap((e) => e.evidence.map((x) => x.article.id)));
        const mid = p.nodes.slice(1, -1).map((n) => n.label);
        const how = mid.length ? `${mid.join('、')} を介してつながっています` : '直接つながっています';
        base.answer = `${names[0]} と ${names[1]} は、${how}（根拠の記事 ${arts.size} 件）。`;
      } else {
        base.answer = `${names.join(' と ')} のつながりは見つかりません。` + (shared.length ? `ただし、どちらも出てくる記事が ${shared.length} 件あります。` : '');
      }
    }
    if (verdict === 'partial') base.answer += ` 一部だけ答えられます（当たらなかった語：${unmatched.join('、')}）。`;
    return base;
  }
}
