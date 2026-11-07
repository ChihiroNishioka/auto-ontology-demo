import type { Relation } from '../ontology/types';

export interface Path { nodes: string[]; edges: Relation[]; cost: number }
export interface PathOptions { maxHops?: number; maxPaths?: number }

export const edgeCost = (r: Relation) => (1 / (1 + r.weight)) * (r.status === 'certified' ? 0.8 : 1);

type Adj = Map<string, { to: string; rel: Relation; cost: number }[]>;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function buildAdjacency(relations: Relation[]): Adj {
  const adj: Adj = new Map();
  const push = (a: string, b: string, rel: Relation) => (adj.get(a) ?? adj.set(a, []).get(a)!).push({ to: b, rel, cost: edgeCost(rel) });
  for (const r of relations) { push(r.source, r.target, r); push(r.target, r.source, r); }
  for (const list of adj.values()) list.sort((x, y) => x.cost - y.cost || cmp(x.to, y.to) || cmp(x.rel.id, y.rel.id));
  return adj;
}

function shortest(adj: Adj, from: string, to: string, maxHops: number, banned: Set<string>, banDirect: boolean): Path | null {
  // 状態＝(概念, 段数)。段数の上限を守りながら最小コストを探す。
  interface St { node: string; hops: number; cost: number; prev: St | null; rel: Relation | null }
  const best = new Map<string, number>();
  const queue: St[] = [{ node: from, hops: 0, cost: 0, prev: null, rel: null }];
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost || a.hops - b.hops || cmp(a.node, b.node));
    const cur = queue.shift()!;
    if (cur.node === to) {
      const nodes: string[] = [], edges: Relation[] = [];
      for (let s: St | null = cur; s; s = s.prev) { nodes.unshift(s.node); if (s.rel) edges.unshift(s.rel); }
      return { nodes, edges, cost: cur.cost };
    }
    const key = `${cur.node}:${cur.hops}`;
    if (best.has(key) && best.get(key)! < cur.cost) continue;
    if (cur.hops >= maxHops) continue;
    for (const e of adj.get(cur.node) ?? []) {
      if (banned.has(e.to) && e.to !== to) continue;
      if (banDirect && cur.node === from && e.to === to) continue;
      const cost = cur.cost + e.cost;
      const k = `${e.to}:${cur.hops + 1}`;
      if (best.has(k) && best.get(k)! <= cost) continue;
      best.set(k, cost);
      queue.push({ node: e.to, hops: cur.hops + 1, cost, prev: cur, rel: e.rel });
    }
  }
  return null;
}

export function findPaths(relations: Relation[], from: string, to: string, opts: PathOptions = {}): Path[] {
  const { maxHops = 4, maxPaths = 3 } = opts;
  if (from === to) return [{ nodes: [from], edges: [], cost: 0 }];
  const adj = buildAdjacency(relations);
  const out: Path[] = [];
  const banned = new Set<string>();
  let banDirect = false;
  while (out.length < maxPaths) {
    const p = shortest(adj, from, to, maxHops, banned, banDirect);
    if (!p) break;
    out.push(p);
    if (p.nodes.length === 2) banDirect = true;
    else banned.add(p.nodes[1]);
  }
  return out;
}
