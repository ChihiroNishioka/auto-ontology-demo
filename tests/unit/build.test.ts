import { describe, expect, it } from 'vitest';
import { parseArticles } from '../../server/data/loader';
import { buildOntology } from '../../server/ontology/build';
import { SAMPLE, ROOT, readJson } from '../helpers';
import path from 'node:path';

const glossary = readJson(path.join(ROOT, 'ontology/glossary.ja.json'));
const stop = readJson(path.join(ROOT, 'ontology/stopwords.ja.json')).words as string[];
const articles = parseArticles(readJson(SAMPLE));
const strip = (o: any) => JSON.parse(JSON.stringify({ ...o, meta: { ...o.meta, builtAt: '' } }));

describe('buildOntology', () => {
  const o = buildOntology(articles, glossary, stop);

  it('件数が meta と一致する', () => {
    expect(o.meta.counts).toEqual({ articles: 10, concepts: o.concepts.length, relations: o.relations.length });
    expect(o.concepts.length).toBeGreaterThan(15);
  });
  it('用語集の語は確認済み、自動抽出は auto-<8桁> で下書き', () => {
    expect(o.concepts.find((c) => c.id === 'claude-code')?.status).toBe('certified');
    const g = o.concepts.find((c) => c.label === 'GraphRAG');
    expect(g?.status).toBe('auto');
    expect(g?.id).toMatch(/^auto-[0-9a-f]{8}$/);
  });
  it('MIN_DF 未満の自動抽出語は入らない', () => {
    expect(o.concepts.filter((c) => c.status === 'auto').every((c) => c.articleIds.length >= 2)).toBe(true);
  });
  it('用語集の is_a / made_by が確認済みの辺になる', () => {
    const r = o.relations.find((x) => x.type === 'made_by' && x.source === 'claude-code' && x.target === 'anthropic');
    expect(r?.status).toBe('certified');
  });
  it('「A に B を組み込み」から uses が作られる', () => {
    const r = o.relations.find((x) => x.type === 'uses' && x.source === 'claude-code' && x.target === 'mcp');
    expect(r).toBeTruthy();
    expect(r!.weight).toBeGreaterThanOrEqual(1);
    expect(r!.evidence.length).toBeGreaterThan(0);
  });
  it('「A と B を比較」から compared_with が作られる', () => {
    expect(o.relations.some((x) => x.type === 'compared_with' && [x.source, x.target].sort().join() === ['ontology', 'rag'].join())).toBe(true);
    expect(o.relations.some((x) => x.type === 'compared_with' && [x.source, x.target].sort().join() === ['claude-code', 'codex'].join())).toBe(true);
  });
  it('同じ文の共起は related_to、重み＝異なる記事の数', () => {
    const r = o.relations.find((x) => x.type === 'related_to' && [x.source, x.target].sort().join() === ['mcp', 'ontology'].join());
    expect(r).toBeTruthy();
    expect(r!.weight).toBe(new Set(r!.evidence.map((e) => e.articleId)).size);
  });
  it('Claude Code とオントロジーは直接つながらない（MCP を介する）', () => {
    expect(o.relations.some((x) => [x.source, x.target].sort().join() === ['claude-code', 'ontology'].join())).toBe(false);
  });
  it('出典記事は AI Score 降順', () => {
    const c = o.concepts.find((x) => x.id === 'mcp')!;
    const scores = c.articleIds.map((id) => o.articles.find((a) => a.id === id)!.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });
  it('根拠は 1 辺あたり最大 5 件', () => {
    expect(o.relations.every((r) => r.evidence.length <= 5)).toBe(true);
  });
  it('共起の辺は 1 概念につき MAX_RELATED 本まで', () => {
    const small = buildOntology(articles, glossary, stop, { maxRelated: 2 });
    const own = small.relations.filter((x) => x.type === 'related_to').length;
    const full = o.relations.filter((x) => x.type === 'related_to').length;
    expect(own).toBeLessThan(full);
  });
  it('決定的：2 回組み立てると builtAt 以外が一致', () => {
    expect(strip(buildOntology(articles, glossary, stop))).toEqual(strip(o));
  });
  it('記事の順番を入れ替えても一致', () => {
    expect(strip(buildOntology([...articles].reverse(), glossary, stop))).toEqual(strip(o));
  });
  it('fixture の組み立て結果のスナップショット', () => {
    const view = {
      concepts: o.concepts.map((c) => [c.id, c.label, c.status, c.articleIds.length]),
      relations: o.relations.map((r) => [r.type, r.source, r.target, r.weight, r.status]),
    };
    expect(view).toMatchSnapshot();
  });
  it('0 件でも組み立てられる', () => {
    const e = buildOntology([], glossary, stop);
    expect(e.concepts).toEqual([]);
    expect(e.relations).toEqual([]);
    expect(e.meta.counts.articles).toBe(0);
  });
  it('inputHash は入力が同じなら同じ、違えば違う', () => {
    expect(o.meta.inputHash).toMatch(/^[0-9a-f]{16}$/);
    expect(buildOntology(articles.slice(1), glossary, stop).meta.inputHash).not.toBe(o.meta.inputHash);
  });
});
