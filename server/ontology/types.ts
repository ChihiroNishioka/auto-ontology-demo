export type ConceptType = 'product' | 'technique' | 'org' | 'idea';
export type Status = 'certified' | 'auto';
export type RelationType = 'is_a' | 'made_by' | 'compared_with' | 'uses' | 'related_to';

export interface Sentence { n: number; text: string }

export interface Article {
  id: string;
  title: string;
  url: string;
  sourceLabel: string;
  contentType: string;
  capturedAt: string;
  score: number;
  sentences: Sentence[];
  relatedIds: string[];
}

export interface Evidence { articleId: string; n: number }

export interface Concept {
  id: string;
  label: string;
  type: ConceptType;
  status: Status;
  synonyms: string[];
  description: string;
  articleIds: string[];
  refs: Evidence[];
}

export interface Relation {
  id: string;
  type: RelationType;
  source: string;
  target: string;
  weight: number;
  status: Status;
  evidence: Evidence[];
}

export interface Ontology {
  concepts: Concept[];
  relations: Relation[];
  articles: Article[];
  meta: { inputHash: string; builtAt: string; counts: { articles: number; concepts: number; relations: number } };
}

export interface GlossaryEntry {
  id: string;
  label: string;
  type: ConceptType;
  synonyms: string[];
  description: string;
  relations: { type: 'is_a' | 'made_by'; target: string }[];
}
export interface Glossary { version?: number; concepts: GlossaryEntry[] }

export interface BuildOptions { minDf?: number; maxConcepts?: number; maxRelated?: number }
