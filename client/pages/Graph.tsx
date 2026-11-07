import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../api';
import { ja } from '../i18n/ja';
import { ErrorBox, Loading, Status } from '../components/common';

interface Node { id: string; label: string; type: string; status: 'certified' | 'auto'; articleCount: number }
interface Edge { id: string; type: string; label: string; source: string; target: string; weight: number; status: 'certified' | 'auto'; evidenceCount: number }
interface GraphRes { center: Node | null; nodes: Node[]; edges: Edge[] }
interface ConceptsRes { items: Node[] }

const short = (s: string) => (s.length > 8 ? s.slice(0, 7) + '…' : s);

function Radial({ g, onPick }: { g: GraphRes; onPick: (id: string) => void }) {
  const c = g.center!;
  const others = g.nodes.filter((n) => n.id !== c.id);
  const R = 140, S = 400, M = S / 2;
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="graph" role="img" aria-label={`${c.label} を中心にしたグラフ`} data-testid="graph-svg">
      {others.map((n, i) => {
        const a = (2 * Math.PI * i) / others.length - Math.PI / 2;
        const x = M + R * Math.cos(a), y = M + R * Math.sin(a);
        const es = g.edges.filter((e) => e.source === n.id || e.target === n.id);
        const w = Math.max(...es.map((e) => e.weight), 1);
        const dashed = es.every((e) => e.status === 'auto');
        return (
          <g key={n.id}>
            <line x1={M} y1={M} x2={x} y2={y} stroke="#64748b" strokeWidth={1 + Math.min(w, 6)} strokeDasharray={dashed ? '6 4' : undefined} />
            <g role="button" tabIndex={0} aria-label={n.label} onClick={() => onPick(n.id)} onKeyDown={(e) => e.key === 'Enter' && onPick(n.id)} className="gnode">
              <title>{n.label}</title>
              <circle cx={x} cy={y} r={24} className={n.status} />
              <text x={x} y={y + 40} textAnchor="middle">{short(n.label)}</text>
            </g>
          </g>
        );
      })}
      <circle cx={M} cy={M} r={34} className={'center ' + c.status} />
      <text x={M} y={M + 5} textAnchor="middle" className="ctext">{short(c.label)}</text>
    </svg>
  );
}

export function Graph() {
  const [sp, setSp] = useSearchParams();
  const focus = sp.get('focus') ?? '';
  const g = useApi<GraphRes>(`/api/graph?focus=${encodeURIComponent(focus)}&limit=12`);
  const [trail, setTrail] = useState<{ id: string; label: string }[]>([]);
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [cert, setCert] = useState(false);
  const search = useApi<ConceptsRes>(q.trim() ? `/api/concepts?q=${encodeURIComponent(q)}&type=${type}&certified=${cert ? 1 : 0}&limit=8` : null);

  const center = g.data?.center;
  useEffect(() => {
    if (!center) return;
    setTrail((t) => {
      const i = t.findIndex((x) => x.id === center.id);
      if (i >= 0) return t.slice(0, i + 1);
      return [...t, { id: center.id, label: center.label }];
    });
  }, [center?.id]);

  const go = (id: string) => { setSp({ focus: id }); setQ(''); };
  const neighbors = useMemo(() => (g.data ? g.data.nodes.filter((n) => n.id !== g.data!.center?.id) : []), [g.data]);

  if (g.error) return <ErrorBox error={g.error} onRetry={g.reload} />;
  if (!g.data) return <Loading />;
  if (!g.data.center) return <div className="card"><p>{ja.noArticles}</p></div>;
  const c = g.data.center;
  const relsOf = (id: string) => g.data!.edges.filter((e) => e.source === id || e.target === id);

  return (
    <div className="graph-page">
      <section className="card search">
        <input type="search" aria-label={ja.searchLabel} placeholder={ja.searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="filters">
          <select aria-label="種類" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">{ja.allTypes}</option>
            {Object.entries(ja.types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label className="check"><input type="checkbox" checked={cert} onChange={(e) => setCert(e.target.checked)} />{ja.onlyCertified}</label>
        </div>
        {q.trim() && search.data && (
          search.data.items.length === 0 ? <p>{ja.noResults}</p> : (
            <ul role="listbox" aria-label="候補" className="options">
              {search.data.items.map((n) => (
                <li key={n.id} role="option" aria-selected={false}>
                  <button type="button" onClick={() => go(n.id)}>{n.label} <small>{ja.types[n.type]}</small></button>
                </li>
              ))}
            </ul>
          )
        )}
      </section>

      <div className="cols">
        <section className="card">
          <h2 data-testid="center-label">{c.label}</h2>
          <p><Status status={c.status} /> <small>{ja.types[c.type]}・出典 {c.articleCount} 件</small></p>
          <Radial g={g.data} onPick={go} />
          <p className="actions">
            <Link className="button" to={`/concept/${c.id}`}>{ja.detail}</Link>
            <Link className="button" to={`/ask?q=${encodeURIComponent(c.label + ' とは')}`}>{ja.askAbout}</Link>
          </p>
        </section>
        <section className="card">
          <h3>{ja.trail}</h3>
          <ol className="trail" data-testid="breadcrumb">
            {trail.map((t) => (
              <li key={t.id}><button type="button" aria-current={t.id === c.id ? 'true' : undefined} onClick={() => go(t.id)}>{t.label}</button></li>
            ))}
          </ol>
          <h3>{ja.neighbors}</h3>
          {neighbors.length === 0 ? <p>{ja.noResults}</p> : (
            <ul className="list" data-testid="neighbor-list">
              {neighbors.map((n) => (
                <li key={n.id}>
                  <button type="button" data-label={n.label} onClick={() => go(n.id)}>
                    <span className="name">{n.label}</span>
                    <small>{[...new Set(relsOf(n.id).map((e) => e.label))].join('・')}／根拠記事 {Math.max(...relsOf(n.id).map((e) => e.evidenceCount), 0)} 件</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
