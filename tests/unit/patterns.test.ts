import { describe, expect, it } from 'vitest';
import { classifyPair } from '../../server/ontology/patterns';

describe('手がかり語の規則 classifyPair(間の文字, 後ろの文字)', () => {
  it('vs → compared_with', () => expect(classifyPair(' vs ', '')).toBe('compared_with'));
  it('対 → compared_with', () => expect(classifyPair('対', '')).toBe('compared_with'));
  it('と比較 → compared_with', () => expect(classifyPair('と比較', 'する')).toBe('compared_with'));
  it('「A と B を比較」 → compared_with', () => expect(classifyPair(' と ', ' を比較し、整理する')).toBe('compared_with'));
  it('「A に B を統合」 → 前が後ろを使う', () => expect(classifyPair(' に ', ' を統合し')).toBe('uses_forward'));
  it('「A に B サーバーを組み込み」 → 前が後ろを使う', () => expect(classifyPair(' に ', ' サーバーを組み込み、')).toBe('uses_forward'));
  it('「A で B を適用」 → 前が後ろを使う', () => expect(classifyPair('で', 'を適用した')).toBe('uses_forward'));
  it('「A を使った B」 → 後ろが前を使う', () => expect(classifyPair('を使った ', '')).toBe('uses_backward'));
  it('「A を活用した B」 → 後ろが前を使う', () => expect(classifyPair('を活用した', '')).toBe('uses_backward'));
  it('手がかりが無ければ null（共起は別処理）', () => {
    expect(classifyPair('、', '')).toBeNull();
    expect(classifyPair(' と ', ' を使う')).toBeNull();
    expect(classifyPair('に', 'は関係ない')).toBeNull();
  });
});
