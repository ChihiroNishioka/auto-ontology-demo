import { createApp } from './app';

const num = (v: string | undefined) => (v && Number.isFinite(Number(v)) ? Number(v) : undefined);
const app = await createApp({
  articlesPath: process.env.ARTICLES_PATH || undefined,
  cacheDir: process.env.ONTOLOGY_CACHE_DIR || undefined,
  askWithClaude: process.env.ASK_WITH_CLAUDE === '1',
  minDf: num(process.env.MIN_DF),
  maxConcepts: num(process.env.MAX_CONCEPTS),
  maxRelated: num(process.env.MAX_RELATED),
});
const port = num(process.env.PORT) ?? 5178;
const host = process.env.HOST || '127.0.0.1';
await app.listen({ port, host });
const h = (await app.inject({ url: '/api/health' })).json();
console.log(h.status === 'ok'
  ? `起動しました：http://${host}:${port}（${h.dataSource === 'sample' ? 'サンプルデータ' : 'ローカルファイル'}／記事 ${h.counts.articles}／概念 ${h.counts.concepts}／関係 ${h.counts.relations}）`
  : `起動しました：http://${host}:${port}（データを読めません：${h.error.code}。ARTICLES_PATH を確認してください）`);
