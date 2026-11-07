// サーバー無しでオントロジーを組み立て、件数と上位概念だけを表示する（記事本文は出さない）
import fs from 'node:fs';
import path from 'node:path';
import { loadArticles } from '../server/data/loader';
import { buildOntology } from '../server/ontology/build';

const root = path.resolve(import.meta.dirname, '..');
const file = process.env.ARTICLES_PATH || path.join(root, 'fixtures/articles.sample.json');
const { articles } = await loadArticles(file);
const glossary = JSON.parse(fs.readFileSync(path.join(root, 'ontology/glossary.ja.json'), 'utf8'));
const stop = JSON.parse(fs.readFileSync(path.join(root, 'ontology/stopwords.ja.json'), 'utf8')).words;
const o = buildOntology(articles, glossary, stop);
const c = o.meta.counts;
console.log(`記事 ${c.articles} 件／概念 ${c.concepts} 件（確認済み ${o.concepts.filter((x) => x.status === 'certified').length}）／関係 ${c.relations} 件`);
console.log('上位の概念：');
for (const x of o.concepts.slice(0, 10)) console.log(`  ${x.label}（${x.status === 'certified' ? '確認済み' : '自動'}・記事 ${x.articleIds.length} 件）`);
