import { describe, expect, it } from 'vitest';
import { judgeCoverage } from '../../server/ask/coverage';
import { findPaths } from '../../server/ask/paths';
import type { Relation } from '../../server/ontology/types';

const rel = (s: string, t: string, weight = 1, status: 'certified' | 'auto' = 'auto', type = 'related_to'): Relation => ({
  id: `${type}:${s}:${t}`, type: type as Relation['type'], source: s, target: t, weight, status, evidence: [],
});

describe('judgeCoverage', () => {
  it('1 個以上当たり 0.5 以上 → answerable', () => {
    expect(judgeCoverage(1, 1)).toEqual({ coverage: 0.5, verdict: 'answerable' });
    expect(judgeCoverage(3, 0)).toEqual({ coverage: 1, verdict: 'answerable' });
  });
  it('1 個以上当たるが 0.5 未満 → partial', () => {
    const r = judgeCoverage(1, 3);
    expect(r.verdict).toBe('partial');
    expect(r.coverage).toBeCloseTo(0.25);
  });
  it('0 個 → unanswerable（カバー率 0）', () => {
    expect(judgeCoverage(0, 4)).toEqual({ coverage: 0, verdict: 'unanswerable' });
    expect(judgeCoverage(0, 0)).toEqual({ coverage: 0, verdict: 'unanswerable' });
  });
});

describe('findPaths', () => {
  it('直接つながる', () => {
    const p = findPaths([rel('a', 'b')], 'a', 'b');
    expect(p).toHaveLength(1);
    expect(p[0].nodes).toEqual(['a', 'b']);
    expect(p[0].edges).toHaveLength(1);
  });
  it('2 段（辺の向きは問わない）', () => {
    const p = findPaths([rel('a', 'b'), rel('c', 'b')], 'a', 'c');
    expect(p[0].nodes).toEqual(['a', 'b', 'c']);
  });
  it('つながらなければ空', () => {
    expect(findPaths([rel('a', 'b'), rel('c', 'd')], 'a', 'd')).toEqual([]);
  });
  it('4 段までは見つけ、5 段は見つけない', () => {
    const chain = (n: number) => Array.from({ length: n }, (_, i) => rel(`n${i}`, `n${i + 1}`));
    expect(findPaths(chain(4), 'n0', 'n4')[0].nodes).toHaveLength(5);
    expect(findPaths(chain(5), 'n0', 'n5')).toEqual([]);
  });
  it('中継概念の異なる経路を最大 3 本返す', () => {
    const rels = [rel('a', 'x'), rel('x', 'z'), rel('a', 'y'), rel('y', 'z'), rel('a', 'w'), rel('w', 'z'), rel('a', 'v'), rel('v', 'z')];
    const p = findPaths(rels, 'a', 'z');
    expect(p).toHaveLength(3);
    expect(new Set(p.map((x) => x.nodes[1])).size).toBe(3);
  });
  it('重みが大きい辺・確認済みの辺を通る経路が先', () => {
    const rels = [rel('a', 'x', 1), rel('x', 'z', 1), rel('a', 'y', 9), rel('y', 'z', 9)];
    expect(findPaths(rels, 'a', 'z')[0].nodes[1]).toBe('y');
  });
  it('同じ概念どうしは経路 1 点', () => {
    expect(findPaths([], 'a', 'a')).toEqual([{ nodes: ['a'], edges: [], cost: 0 }]);
  });
});
