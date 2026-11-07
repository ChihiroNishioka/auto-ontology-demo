import type { RelationType } from '../ontology/types';

export const TYPE_LABEL: Record<RelationType, { fwd: string; rev: string }> = {
  is_a: { fwd: 'の一種', rev: '（下位概念）' },
  made_by: { fwd: '提供元', rev: '提供している' },
  compared_with: { fwd: '比較される', rev: '比較される' },
  uses: { fwd: '使う', rev: '使われる' },
  related_to: { fwd: '一緒に語られる', rev: '一緒に語られる' },
};
export const labelFor = (type: RelationType, reversed: boolean) => TYPE_LABEL[type][reversed ? 'rev' : 'fwd'];
