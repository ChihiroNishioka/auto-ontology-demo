import { describe, expect, it } from 'vitest';
import { buildLexicon, extractCandidates, findMentions } from '../../server/ontology/extract';

const lex = buildLexicon([
  { id: 'claude-code', label: 'Claude Code', synonyms: ['ClaudeCode'] },
  { id: 'claude', label: 'Claude', synonyms: [] },
  { id: 'rag', label: 'RAG', synonyms: ['検索拡張生成'] },
  { id: 'agent', label: 'エージェント', synonyms: ['agents'] },
  { id: 'agents-md', label: 'AGENTS.md', synonyms: [] },
]);
const ids = (t: string) => findMentions(t, lex).map((m) => m.conceptId);

describe('findMentions（最長一致）', () => {
  it('長い方を採る（Claude Code は Claude にならない）', () => {
    expect(ids('Claude Code を使う')).toEqual(['claude-code']);
  });
  it('同義語でも当たる', () => {
    expect(ids('ClaudeCode と 検索拡張生成')).toEqual(['claude-code', 'rag']);
  });
  it('英字は大文字小文字を無視する', () => {
    expect(ids('rag と Rag')).toEqual(['rag', 'rag']);
  });
  it('英数字の語境界を守る（Fragile の中の rag には当たらない）', () => {
    expect(ids('Fragile storage')).toEqual([]);
    expect(ids('RAGs')).toEqual([]);
  });
  it('日本語は境界を要求しない', () => {
    expect(ids('エージェントがRAGを呼ぶ')).toEqual(['agent', 'rag']);
  });
  it('AGENTS.md は agents より優先される', () => {
    expect(ids('AGENTS.md に書く')).toEqual(['agents-md']);
  });
  it('位置を返す', () => {
    const m = findMentions('x Claude Code y', lex)[0];
    expect([m.start, m.end, m.surface]).toEqual([2, 13, 'Claude Code']);
  });
  it('NFKC で全角も当たる', () => {
    expect(ids('ＲＡＧ')).toEqual(['rag']);
  });
});

describe('extractCandidates（自動抽出の規則）', () => {
  const stop = new Set(['Code', 'MIT', 'Apache-2.0', 'データ']);
  const c = (t: string) => extractCandidates(t, stop);
  it('英字で始まる製品風の語と、つながった 2〜3 語', () => {
    expect(c('GraphRAG と GitHub Copilot を使う')).toEqual(expect.arrayContaining(['GraphRAG', 'GitHub Copilot']));
  });
  it('*.md を拾う', () => {
    expect(c('CLAUDE.md を置く')).toContain('CLAUDE.md');
  });
  it('カタカナ 3 文字以上（中黒でつながる複合語を含む）', () => {
    const r = c('スマホとベクトル・データ、そしてア');
    expect(r).toContain('スマホ');
    expect(r).toContain('ベクトル・データ');
    expect(r).not.toContain('ア');
  });
  it('「」で囲まれた 2〜20 文字', () => {
    expect(c('これは「評価データ」だ')).toContain('評価データ');
    expect(c('「あ」だ')).not.toContain('あ');
  });
  it('除外語・数字だけ・1 文字は拾わない', () => {
    const r = c('MIT と Apache-2.0 と 2026 と A と データ');
    expect(r).toEqual([]);
  });
  it('小文字だけの英単語は拾わない', () => {
    expect(c('the quick fox')).toEqual([]);
  });
});
