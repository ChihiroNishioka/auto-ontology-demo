import { Link, useParams } from 'react-router-dom';
import { useApi } from '../api';
import { ja } from '../i18n/ja';
import { ArticleLink, ErrorBox, Loading, Status } from '../components/common';

interface Ev { text: string; article: { id: string; title: string; url: string } }
interface Rel { id: string; typeLabel: string; other: { id: string; label: string }; weight: number; status: 'certified' | 'auto'; evidence: Ev[] }
interface Art { id: string; title: string; url: string; contentType: string; sourceLabel: string; capturedAt: string; sentences: { n: number; text: string }[]; related: { id: string; title: string; url: string }[] }
interface Res { concept: { id: string; label: string; type: string; status: 'certified' | 'auto'; synonyms: string[]; description: string; terms: string[] }; relations: Rel[]; articles: Art[] }

function Marked({ text, terms }: { text: string; terms: string[] }) {
  const esc = terms.filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!esc.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${esc.join('|')})`, 'i'));
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}</>;
}

export function Concept() {
  const { id = '' } = useParams();
  const r = useApi<Res>(`/api/concepts/${encodeURIComponent(id)}`);
  if (r.error?.status === 404) return <div className="card"><p>{ja.notFoundConcept}</p><Link className="button" to="/">{ja.backToGraph}</Link></div>;
  if (r.error) return <ErrorBox error={r.error} onRetry={r.reload} />;
  if (!r.data) return <Loading />;
  const { concept: c, relations, articles } = r.data;
  const groups = new Map<string, Rel[]>();
  for (const x of relations) groups.set(x.typeLabel, [...(groups.get(x.typeLabel) ?? []), x]);
  return (
    <div className="detail">
      <section className="card">
        <h2>{c.label}</h2>
        <p><Status status={c.status} /> <small>{ja.types[c.type]}</small></p>
        {c.synonyms.length > 0 && <p><small>{ja.synonyms}：{c.synonyms.join('、')}</small></p>}
        <p>{c.description}</p>
        <p className="actions">
          <Link className="button" to={`/?focus=${c.id}`}>{ja.navGraph}</Link>
          <Link className="button" to={`/ask?q=${encodeURIComponent(c.label + ' とは')}`}>{ja.askAbout}</Link>
        </p>
      </section>
      <section className="card" data-testid="relations">
        <h3>{ja.relations}</h3>
        {groups.size === 0 && <p>{ja.noResults}</p>}
        {[...groups.entries()].map(([label, rs]) => (
          <div key={label}>
            <h4>{label}</h4>
            <ul className="list">
              {rs.map((x) => (
                <li key={x.id}>
                  <details>
                    <summary>{x.other.label} <small>重み {x.weight}・根拠 {x.evidence.length} 件{x.status === 'certified' ? '・確認済み' : ''}</small></summary>
                    <Link className="button" to={`/concept/${x.other.id}`}>{x.other.label} の詳細</Link>
                    {x.evidence.length === 0 ? <p><small>用語集の定義です。</small></p> : (
                      <ul>{x.evidence.map((e, i) => <li key={i}>{e.text} — <ArticleLink a={e.article} /></li>)}</ul>
                    )}
                  </details>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
      <section className="card" data-testid="articles">
        <h3>{ja.articles}（{articles.length}）</h3>
        {articles.map((a) => (
          <article key={a.id} className="art">
            <h4><ArticleLink a={a} /></h4>
            <p><small>{a.sourceLabel}・{a.contentType}・{a.capturedAt}</small></p>
            {a.sentences.map((s) => <p key={s.n} className="sent"><Marked text={s.text} terms={c.terms} /></p>)}
            {a.related.length > 0 && <p><small>{ja.related}：{a.related.map((x, i) => <span key={x.id}>{i ? '、' : ''}<ArticleLink a={x} /></span>)}</small></p>}
          </article>
        ))}
      </section>
    </div>
  );
}
