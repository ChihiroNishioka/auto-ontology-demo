// 手がかり語の規則表。各規則は tests/unit/patterns.test.ts で確かめる。
export type PairKind = 'compared_with' | 'uses_forward' | 'uses_backward';

interface Rule {
  kind: PairKind;
  gap: RegExp;       // 2 つの概念の間の文字（前後の空白を除く）
  after?: RegExp;    // 後ろの概念の直後の文字（任意）
}

export const RULES: Rule[] = [
  { kind: 'compared_with', gap: /^(vs\.?|対|と比較|と比べ|と対比)$/i },
  { kind: 'compared_with', gap: /^(と|や)$/, after: /^\s*(を|の)?\s*(比較|比べ|対比)/ },
  { kind: 'uses_forward', gap: /^(に|で|の中で|上で)$/, after: /^\s*[^、。,.\s]{0,10}?\s*(を|が)?\s*(統合|組み込|適用|使|利用|呼び出|連携)/ },
  { kind: 'uses_backward', gap: /^(を使った|を使って|を利用した|を活用した|を用いた|を組み込んだ|を統合した)$/ },
];

export function classifyPair(gap: string, after: string): PairKind | null {
  const g = gap.trim();
  for (const r of RULES) {
    if (r.gap.test(g) && (!r.after || r.after.test(after))) return r.kind;
  }
  return null;
}
