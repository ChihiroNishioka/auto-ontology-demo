import { NavLink, Route, Routes } from 'react-router-dom';
import { useApi } from './api';
import { ja } from './i18n/ja';
import { ErrorBox, Loading } from './components/common';
import { Graph } from './pages/Graph';
import { Concept } from './pages/Concept';
import { Ask } from './pages/Ask';

export interface Health { status: string; dataSource: 'file' | 'sample'; counts: { articles: number; concepts: number; relations: number } }

export function App() {
  const h = useApi<Health>('/api/health');
  if (h.loading && !h.data) return <main className="wrap"><Loading /></main>;
  if (h.error && (h.error.code === 'DATA_NOT_FOUND' || h.error.code === 'DATA_INVALID')) {
    return (
      <main className="wrap">
        <div className="card guide">
          <h1>{ja.guideTitle}</h1>
          <p>{ja.guideBody}</p>
          <pre><code>{ja.guideExample}</code></pre>
        </div>
      </main>
    );
  }
  if (h.error || !h.data) return <main className="wrap"><ErrorBox error={h.error!} onRetry={h.reload} /></main>;
  const d = h.data;
  const source = d.dataSource === 'sample'
    ? `サンプルデータ（架空の記事 ${d.counts.articles} 件）／概念 ${d.counts.concepts} 件／関係 ${d.counts.relations} 件`
    : `ローカルファイル：記事 ${d.counts.articles} 件／概念 ${d.counts.concepts} 件／関係 ${d.counts.relations} 件`;
  return (
    <>
      {d.dataSource === 'sample' && <div className="banner" data-testid="sample-banner">{ja.sampleBanner}</div>}
      <header className="top">
        <strong>{ja.appTitle}</strong>
        <nav aria-label="メイン">
          <NavLink to="/" end>{ja.navGraph}</NavLink>
          <NavLink to="/ask">{ja.navAsk}</NavLink>
        </nav>
      </header>
      <main className="wrap">
        {d.counts.articles === 0 ? (
          <div className="card"><p>{ja.noArticles}</p></div>
        ) : (
          <Routes>
            <Route path="/" element={<Graph />} />
            <Route path="/concept/:id" element={<Concept />} />
            <Route path="/ask" element={<Ask />} />
            <Route path="*" element={<div className="card"><p>{ja.notFoundConcept}</p></div>} />
          </Routes>
        )}
      </main>
      <footer className="foot" data-testid="data-source">{source}</footer>
    </>
  );
}
