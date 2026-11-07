import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError, useApi } from '../api';
import { ja } from '../i18n/ja';
import { ArticleLink, ErrorBox, Loading } from '../components/common';

interface CRef { id: string; label: string }
interface Ev { text: string; article: { id: string; title: string; url: string } }
interface AskRes {
  verdict: string; verdictLabel: string; coverage: number; matched: CRef[]; unmatched: string[]; suggestions: CRef[];
  paths: { nodes: CRef[]; edges: { id: string; label: string; weight: number; status: string; evidence: Ev[] }[] }[];
  sharedArticles: { id: string; title: string; url: string; contentType: string }[];
  neighbors: (CRef & { weight: number })[]; answer: string; aiSummary?: string; aiSummaryError?: string;
}

export function Ask() {
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') ?? '';
  const [text, setText] = useState(q);
  const [res, setRes] = useState<AskRes | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const ex = useApi<{ items: string[] }>('/api/examples');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setText(q);
    if (!q.trim()) { setRes(null); return; }
    let live = true;
    setBusy(true); setErr(null);
    api<AskRes>('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: q }) })
      .then((r) => live && setRes(r), (e) => live && setErr(e))
      .finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [q, tick]);

  const submit = (s: string) => { const v = s.trim(); if (!v) return; if (v === q) setTick((t) => t + 1); else setSp({ q: v }); };

  return (
    <div className="ask">
      <form className="card" onSubmit={(e) => { e.preventDefault(); submit(text); }}>
        <label htmlFor="q">{ja.askLabel}</label>
        <div className="row">
          <input id="q" type="text" value={text} placeholder={ja.askPlaceholder} maxLength={500} onChange={(e) => setText(e.target.value)} />
          <button type="submit" disabled={busy || !text.trim()}>{ja.askButton}</button>
        </div>
        {ex.data && ex.data.items.length > 0 && (
          <div><small>{ja.examples}</small>
            <ul className="list examples">
              {ex.data.items.map((s) => <li key={s}><button type="button" data-testid="example" disabled={busy} onClick={() => submit(s)}>{s}</button></li>)}
            </ul>
          </div>
        )}
      </form>

      {busy && <Loading />}
      {err && <ErrorBox error={err} onRetry={() => setTick((t) => t + 1)} />}
      {res && !busy && !err && (
        <>
          <section className="card">
            <p className={'verdict ' + res.verdict} data-testid="verdict">{res.verdictLabel}（{ja.coverage} {Math.round(res.coverage * 100)}%）</p>
            <p>{ja.matched}：{res.matched.length ? res.matched.map((m) => <Link key={m.id} className="chip" to={`/concept/${m.id}`}>{m.label}</Link>) : 'なし'}</p>
            {res.unmatched.length > 0 && <p>{ja.unmatched}：{res.unmatched.map((u) => <span key={u} className="chip off">{u}</span>)}</p>}
            <p>{res.answer}</p>
            {res.aiSummary && <blockquote><strong>{ja.aiSummary}</strong><br />{res.aiSummary}</blockquote>}
            {res.aiSummaryError && <p><small>{res.aiSummaryError}</small></p>}
          </section>
          {res.verdict === 'unanswerable' && (
            <section className="card" data-testid="suggestions">
              <h3>{ja.suggestions}</h3>
              <ul className="list">{res.suggestions.map((s) => <li key={s.id}><Link className="button" to={`/concept/${s.id}`}>{s.label}</Link></li>)}</ul>
            </section>
          )}
          {res.paths.map((p, i) => {
            const n = new Set(p.edges.flatMap((e) => e.evidence.map((x) => x.article.id))).size;
            return (
              <section key={i} className="card path" data-testid="path">
                <h3>{ja.path} {i + 1}</h3>
                <ol className="steps">
                  {p.nodes.map((node, k) => (
                    <li key={node.id + k}>
                      <Link to={`/concept/${node.id}`} className="node">{node.label}</Link>
                      {p.edges[k] && (
                        <details className="edge">
                          <summary>↓ {p.edges[k].label}（{p.edges[k].status === 'certified' ? '確認済み' : '自動'}）・{ja.evidence} {p.edges[k].evidence.length} 件</summary>
                          {p.edges[k].evidence.length === 0 ? <p><small>用語集の定義です。</small></p> : (
                            <ul>{p.edges[k].evidence.map((e, j) => <li key={j}>{e.text} — <ArticleLink a={e.article} /></li>)}</ul>
                          )}
                        </details>
                      )}
                    </li>
                  ))}
                </ol>
                <p><small>経路全体で異なる記事 {n} 件</small></p>
              </section>
            );
          })}
          {res.neighbors.length > 0 && (
            <section className="card"><h3>{ja.neighbors}</h3>
              <ul className="list">{res.neighbors.map((n) => <li key={n.id}><Link className="button" to={`/?focus=${n.id}`}>{n.label}</Link></li>)}</ul>
            </section>
          )}
          {res.sharedArticles.length > 0 && (
            <section className="card" data-testid="shared-articles"><h3>{ja.shared}</h3>
              <ul>{res.sharedArticles.map((a) => <li key={a.id}><ArticleLink a={a} /> <small>{a.contentType}</small></li>)}</ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
