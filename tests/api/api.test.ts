import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../../server/app';
import { FIX, SAMPLE, tmpDir } from '../helpers';

const make = (file: string) => createApp({ articlesPath: file, cacheDir: tmpDir() });
const LEAK = /notion|collection:\/\/|\b[0-9a-f]{32}\b|\/workspace|\/home\/|articles\.sample|fixtures\/|Processing Note|fixture note/i;
const ENDPOINTS = ['/api/health', '/api/concepts', '/api/graph', '/api/examples'];

describe('fixture で動く API', () => {
  let app: FastifyInstance;
  const leaks: string[] = [];
  beforeAll(async () => { app = await make(SAMPLE); await app.ready(); });
  afterAll(async () => { await app.close(); expect(leaks).toEqual([]); });
  const get = async (url: string) => {
    const r = await app.inject({ method: 'GET', url });
    if (LEAK.test(r.body)) leaks.push(url);
    return r;
  };

  it('GET /api/health', async () => {
    const r = await get('/api/health');
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.status).toBe('ok');
    expect(b.dataSource).toBe('file');
    expect(b.counts.articles).toBe(10);
    expect(b.counts.concepts).toBeGreaterThan(15);
    expect(b.inputHash).toMatch(/^[0-9a-f]{16}$/);
  });
  it('ARTICLES_PATH 未指定ならサンプル', async () => {
    const a = await createApp({ cacheDir: tmpDir() });
    expect((await a.inject({ url: '/api/health' })).json().dataSource).toBe('sample');
    await a.close();
  });
  it('GET /api/concepts（一覧・検索・絞り込み）', async () => {
    const all = (await get('/api/concepts')).json().items;
    expect(all.length).toBeGreaterThan(15);
    expect(all[0]).toEqual(expect.objectContaining({ id: expect.any(String), label: expect.any(String), type: expect.any(String), status: expect.any(String), articleCount: expect.any(Number), degree: expect.any(Number) }));
    const q = (await get('/api/concepts?q=' + encodeURIComponent('claude code'))).json().items;
    expect(q.map((x: any) => x.id)).toContain('claude-code');
    const syn = (await get('/api/concepts?q=' + encodeURIComponent('検索拡張生成'))).json().items;
    expect(syn.map((x: any) => x.id)).toContain('rag');
    const org = (await get('/api/concepts?type=org')).json().items;
    expect(org.length).toBeGreaterThan(0);
    expect(org.every((x: any) => x.type === 'org')).toBe(true);
    const cert = (await get('/api/concepts?certified=1')).json().items;
    expect(cert.every((x: any) => x.status === 'certified')).toBe(true);
    expect((await get('/api/concepts?limit=3')).json().items).toHaveLength(3);
    expect((await get('/api/concepts?q=' + encodeURIComponent('ぬるぽぬるぽ'))).json().items).toEqual([]);
  });
  it('GET /api/concepts/:id', async () => {
    const r = await get('/api/concepts/mcp');
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.concept).toEqual(expect.objectContaining({ id: 'mcp', label: 'MCP', status: 'certified', description: expect.any(String) }));
    expect(b.relations.length).toBeGreaterThan(0);
    expect(b.relations[0]).toEqual(expect.objectContaining({ type: expect.any(String), typeLabel: expect.any(String), other: expect.objectContaining({ id: expect.any(String), label: expect.any(String) }), weight: expect.any(Number), evidence: expect.any(Array) }));
    expect(b.articles.length).toBeGreaterThanOrEqual(2);
    expect(b.articles[0]).toEqual(expect.objectContaining({ title: expect.any(String), url: expect.stringMatching(/^https:\/\/example\.com\//), contentType: expect.any(String), sentences: expect.any(Array) }));
  });
  it('存在しない概念は 404', async () => {
    const r = await get('/api/concepts/no-such');
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe('NOT_FOUND');
  });
  it('GET /api/graph', async () => {
    const b = (await get('/api/graph')).json();
    expect(b.center.id).toBeTruthy();
    expect(b.nodes.length).toBeGreaterThan(1);
    expect(b.nodes.length).toBeLessThanOrEqual(13);
    expect(b.edges.length).toBeGreaterThan(0);
    const f = (await get('/api/graph?focus=claude-code&limit=3')).json();
    expect(f.center.id).toBe('claude-code');
    expect(f.nodes.length).toBeLessThanOrEqual(4);
    expect((await get('/api/graph?focus=zzz')).statusCode).toBe(404);
  });
  it('POST /api/ask：2 段の経路と根拠', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/ask', payload: { question: 'Claude Code とオントロジーはどうつながる？' } });
    expect(r.statusCode).toBe(200);
    expect(LEAK.test(r.body)).toBe(false);
    const b = r.json();
    expect(b.verdict).toBe('answerable');
    expect(b.coverage).toBeGreaterThan(0.5);
    expect(b.matched.map((m: any) => m.id)).toEqual(['claude-code', 'ontology']);
    expect(b.paths.length).toBeGreaterThanOrEqual(1);
    expect(b.paths[0].nodes.map((n: any) => n.id)).toEqual(['claude-code', 'mcp', 'ontology']);
    expect(b.paths[0].edges[0].evidence[0]).toEqual(expect.objectContaining({ text: expect.any(String), article: expect.objectContaining({ title: expect.any(String), url: expect.any(String) }) }));
    expect(b.answer).toContain('MCP');
    expect(b.aiSummary).toBeUndefined();
    expect(Array.isArray(b.sharedArticles)).toBe(true);
  });
  it('POST /api/ask：概念が 1 つなら隣接概念と出典', async () => {
    const b = (await app.inject({ method: 'POST', url: '/api/ask', payload: { question: 'MCP とは' } })).json();
    expect(b.verdict).not.toBe('unanswerable');
    expect(b.paths).toEqual([]);
    expect(b.neighbors.length).toBeGreaterThan(0);
  });
  it('POST /api/ask：答えられない質問は候補つき', async () => {
    const b = (await app.inject({ method: 'POST', url: '/api/ask', payload: { question: '量子コンピュータの冷却方式は？' } })).json();
    expect(b.verdict).toBe('unanswerable');
    expect(b.coverage).toBe(0);
    expect(b.matched).toEqual([]);
  });
  it('POST /api/ask：近い概念を候補に出す', async () => {
    const b = (await app.inject({ method: 'POST', url: '/api/ask', payload: { question: 'ナレッ' } })).json();
    expect(b.suggestions.map((s: any) => s.id)).toContain('knowledge-graph');
  });
  it('POST /api/ask：空・長すぎるは 400', async () => {
    for (const question of ['', '   ', 'あ'.repeat(501)]) {
      const r = await app.inject({ method: 'POST', url: '/api/ask', payload: { question } });
      expect(r.statusCode).toBe(400);
      expect(r.json().error.code).toBe('BAD_REQUEST');
    }
    expect((await app.inject({ method: 'POST', url: '/api/ask', payload: {} })).statusCode).toBe(400);
  });
  it('GET /api/examples：経路が 2 段ある組み合わせ', async () => {
    const items = (await get('/api/examples')).json().items as string[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(3);
    const r = await app.inject({ method: 'POST', url: '/api/ask', payload: { question: items[0] } });
    expect(r.json().paths.length).toBeGreaterThan(0);
  });
});

describe('データの異常', () => {
  it('ファイルが無い：503 DATA_NOT_FOUND、サーバーは生きている', async () => {
    const app = await make(path.join(tmpDir(), 'nope.json'));
    const h = await app.inject({ url: '/api/health' });
    expect(h.statusCode).toBe(503);
    expect(h.json().error.code).toBe('DATA_NOT_FOUND');
    expect(LEAK.test(h.body)).toBe(false);
    for (const u of ENDPOINTS.slice(1)) expect((await app.inject({ url: u })).statusCode).toBe(503);
    expect((await app.inject({ method: 'POST', url: '/api/ask', payload: { question: 'MCP' } })).statusCode).toBe(503);
    expect((await app.inject({ url: '/api/health' })).statusCode).toBe(503);
    await app.close();
  });
  it('壊れた JSON：503 DATA_INVALID', async () => {
    const app = await make(FIX('articles.broken.json'));
    const h = await app.inject({ url: '/api/health' });
    expect(h.statusCode).toBe(503);
    expect(h.json().error.code).toBe('DATA_INVALID');
    expect(LEAK.test(h.body)).toBe(false);
    await app.close();
  });
  it('0 件：全エンドポイントが 200 で空', async () => {
    const app = await make(FIX('articles.empty.json'));
    const h = await app.inject({ url: '/api/health' });
    expect(h.statusCode).toBe(200);
    expect(h.json().counts).toEqual({ articles: 0, concepts: 0, relations: 0 });
    expect((await app.inject({ url: '/api/concepts' })).json().items).toEqual([]);
    const g = await app.inject({ url: '/api/graph' });
    expect(g.statusCode).toBe(200);
    expect(g.json().nodes).toEqual([]);
    expect((await app.inject({ url: '/api/examples' })).json().items).toEqual([]);
    const a = await app.inject({ method: 'POST', url: '/api/ask', payload: { question: 'MCP とは' } });
    expect(a.statusCode).toBe(200);
    expect(a.json().verdict).toBe('unanswerable');
    await app.close();
  });
});

describe('キャッシュ', () => {
  it('同じ入力ならキャッシュを使っても同じ結果', async () => {
    const dir = tmpDir();
    const a1 = await createApp({ articlesPath: SAMPLE, cacheDir: dir });
    const h1 = (await a1.inject({ url: '/api/health' })).json();
    const c1 = (await a1.inject({ url: '/api/concepts' })).json();
    await a1.close();
    const a2 = await createApp({ articlesPath: SAMPLE, cacheDir: dir });
    expect((await a2.inject({ url: '/api/health' })).json().inputHash).toBe(h1.inputHash);
    expect((await a2.inject({ url: '/api/concepts' })).json()).toEqual(c1);
    await a2.close();
  });
});
