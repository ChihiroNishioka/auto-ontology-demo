import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import fastifyStatic from '@fastify/static';
import { DataError, loadArticles } from './data/loader';
import { buildOntology, computeInputHash } from './ontology/build';
import { readCache, writeCache } from './ontology/cache';
import type { BuildOptions, Glossary, Ontology } from './ontology/types';
import { Engine, artView } from './ask/answer';
import { labelFor } from './ask/labels';
import { summarizeWithClaude } from './ask/claude';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface AppOptions extends BuildOptions {
  articlesPath?: string;
  cacheDir?: string;
  askWithClaude?: boolean;
  staticDir?: string;
}

type State = { ok: true; engine: Engine; source: 'file' | 'sample' } | { ok: false; code: string; message: string };

const err = (reply: FastifyReply, status: number, code: string, message: string) =>
  reply.code(status).send({ error: { code, message } });

export async function createApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const source = opts.articlesPath ? 'file' : 'sample';
  const file = opts.articlesPath ?? path.join(ROOT, 'fixtures/articles.sample.json');
  const cacheDir = opts.cacheDir ?? path.join(ROOT, '.cache');

  let state: State;
  try {
    const { articles } = await loadArticles(file);
    const glossary = JSON.parse(fs.readFileSync(path.join(ROOT, 'ontology/glossary.ja.json'), 'utf8')) as Glossary;
    const stop = JSON.parse(fs.readFileSync(path.join(ROOT, 'ontology/stopwords.ja.json'), 'utf8')).words as string[];
    const hash = computeInputHash(articles, glossary, stop, opts);
    let o: Ontology | null = readCache(cacheDir, hash);
    if (!o) { o = buildOntology(articles, glossary, stop, opts); writeCache(cacheDir, o); }
    state = { ok: true, engine: new Engine(o, new Set(stop)), source };
  } catch (e) {
    state = e instanceof DataError ? { ok: false, code: e.code, message: e.message } : { ok: false, code: 'DATA_INVALID', message: '記事データを処理できませんでした。' };
  }

  app.setErrorHandler((e, _req, reply) => {
    const status = (e as { statusCode?: number }).statusCode ?? 500;
    return err(reply, status >= 400 && status < 500 ? 400 : 500, status >= 500 || status < 400 ? 'INTERNAL' : 'BAD_REQUEST', status < 500 ? 'リクエストの形が正しくありません。' : 'サーバーでエラーが起きました。');
  });

  const guard = (reply: FastifyReply): Engine | null => {
    if (state.ok) return state.engine;
    err(reply, 503, state.code, state.message);
    return null;
  };

  app.get('/api/health', async (_req, reply) => {
    const eng = guard(reply); if (!eng) return;
    const s = state as Extract<State, { ok: true }>;
    return { status: 'ok', dataSource: s.source, counts: eng.o.meta.counts, inputHash: eng.o.meta.inputHash };
  });

  app.get('/api/concepts', async (req, reply) => {
    const eng = guard(reply); if (!eng) return;
    const { q = '', type = '', certified = '', limit = '50' } = req.query as Record<string, string>;
    const nq = q.normalize('NFKC').trim().toLowerCase();
    const degree = new Map<string, number>();
    for (const r of eng.o.relations) { degree.set(r.source, (degree.get(r.source) ?? 0) + 1); degree.set(r.target, (degree.get(r.target) ?? 0) + 1); }
    const rank = (c: { label: string; synonyms: string[] }) => {
      if (!nq) return 2;
      const names = [c.label, ...c.synonyms].map((s) => s.normalize('NFKC').toLowerCase());
      if (names.some((s) => s.startsWith(nq))) return 0;
      return names.some((s) => s.includes(nq)) ? 1 : -1;
    };
    const items = eng.o.concepts
      .filter((c) => (!type || c.type === type) && (certified !== '1' || c.status === 'certified') && rank(c) >= 0)
      .map((c, i) => ({ c, i, r: rank(c) }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .slice(0, Math.min(500, Math.max(1, Number(limit) || 50)))
      .map(({ c }) => ({ id: c.id, label: c.label, type: c.type, status: c.status, articleCount: c.articleIds.length, degree: degree.get(c.id) ?? 0 }));
    return { items };
  });

  app.get('/api/concepts/:id', async (req, reply) => {
    const eng = guard(reply); if (!eng) return;
    const c = eng.byId.get((req.params as { id: string }).id);
    if (!c) return err(reply, 404, 'NOT_FOUND', 'その概念は見つかりません。');
    const relations = eng.o.relations
      .filter((r) => r.source === c.id || r.target === c.id)
      .map((r) => {
        const reversed = r.target === c.id && r.type !== 'related_to' && r.type !== 'compared_with';
        const other = r.source === c.id ? r.target : r.source;
        return { id: r.id, type: r.type, typeLabel: labelFor(r.type, reversed), other: eng.cview(other), weight: r.weight, status: r.status, evidence: eng.evidence(r) };
      });
    const terms = [c.label, ...c.synonyms];
    const articles = c.articleIds.map((id) => {
      const a = eng.artById.get(id)!;
      const ns = new Set(c.refs.filter((e) => e.articleId === id).map((e) => e.n));
      return { ...artView(a), score: a.score, sentences: a.sentences.filter((s) => ns.has(s.n)), related: a.relatedIds.flatMap((rid) => { const x = eng.artById.get(rid); return x ? [{ id: x.id, title: x.title, url: x.url }] : []; }) };
    });
    return { concept: { id: c.id, label: c.label, type: c.type, status: c.status, synonyms: c.synonyms, description: c.description, articleCount: c.articleIds.length, terms }, relations, articles };
  });

  app.get('/api/graph', async (req, reply) => {
    const eng = guard(reply); if (!eng) return;
    const { focus = '', limit = '12' } = req.query as Record<string, string>;
    if (!eng.o.concepts.length) return { center: null, nodes: [], edges: [] };
    const cid = focus || eng.o.concepts[0].id;
    if (!eng.byId.has(cid)) return err(reply, 404, 'NOT_FOUND', 'その概念は見つかりません。');
    const lim = Math.min(30, Math.max(1, Number(limit) || 12));
    const nb = eng.neighbors(cid, lim);
    const ids = new Set(nb.map((n) => n.id));
    const edges = eng.o.relations.filter((r) => (r.source === cid && ids.has(r.target)) || (r.target === cid && ids.has(r.source)))
      .map((r) => ({ id: r.id, type: r.type, label: labelFor(r.type, r.target === cid && r.type !== 'related_to' && r.type !== 'compared_with'), source: r.source, target: r.target, weight: r.weight, status: r.status, evidenceCount: new Set(r.evidence.map((e) => e.articleId)).size }));
    const withArt = (v: { id: string }) => ({ ...v, articleCount: eng.byId.get(v.id)!.articleIds.length });
    return { center: withArt(eng.cview(cid)), nodes: [withArt(eng.cview(cid)), ...nb.map(withArt)], edges };
  });

  app.post('/api/ask', async (req, reply) => {
    const eng = guard(reply); if (!eng) return;
    const q = (req.body as { question?: unknown } | null)?.question;
    if (typeof q !== 'string' || !q.trim()) return err(reply, 400, 'BAD_REQUEST', '質問を入力してください。');
    if (q.length > 500) return err(reply, 400, 'BAD_REQUEST', '質問は 500 文字までです。');
    const res: ReturnType<Engine['ask']> & { aiSummary?: string; aiSummaryError?: string } = eng.ask(q.trim());
    if (opts.askWithClaude && res.verdict !== 'unanswerable') {
      const facts = res.paths.slice(0, 2).map((p) => p.nodes.map((n) => n.label).join(' → ') + '\n' + p.edges.flatMap((e) => e.evidence.slice(0, 2).map((x) => '- ' + x.text)).join('\n')).join('\n\n');
      const text = await summarizeWithClaude(`次の根拠だけを使い、質問に3文で日本語で答えてください。\n質問: ${q}\n${res.answer}\n${facts}`);
      if (text) res.aiSummary = text; else res.aiSummaryError = 'AI 要約は使えませんでした';
    }
    return res;
  });

  app.get('/api/examples', async (_req, reply) => {
    const eng = guard(reply); if (!eng) return;
    return { items: eng.examples() };
  });

  const staticDir = opts.staticDir ?? path.join(ROOT, 'dist');
  const hasStatic = fs.existsSync(path.join(staticDir, 'index.html'));
  if (hasStatic) await app.register(fastifyStatic, { root: staticDir });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || !hasStatic || req.method !== 'GET') return err(reply, 404, 'NOT_FOUND', '見つかりません。');
    return reply.type('text/html').send(fs.readFileSync(path.join(staticDir, 'index.html')));
  });
  return app;
}
