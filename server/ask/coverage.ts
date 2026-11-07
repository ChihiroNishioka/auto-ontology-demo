export type Verdict = 'answerable' | 'partial' | 'unanswerable';
export const VERDICT_LABEL: Record<Verdict, string> = {
  answerable: '答えられます',
  partial: '一部だけ答えられます',
  unanswerable: 'この記事集からは答えられません',
};

export function judgeCoverage(matched: number, unmatched: number): { coverage: number; verdict: Verdict } {
  if (matched <= 0) return { coverage: 0, verdict: 'unanswerable' };
  const coverage = matched / (matched + unmatched);
  return { coverage, verdict: coverage >= 0.5 ? 'answerable' : 'partial' };
}
