import { ja } from '../i18n/ja';
import { ApiError } from '../api';

export function Loading() {
  return (
    <div className="skeleton" aria-busy="true">
      <p role="status">{ja.loading}</p>
      <div className="bar" /><div className="bar short" /><div className="bar" />
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  return (
    <div className="card error" role="alert">
      <h2>{ja.errorTitle}</h2>
      <button type="button" onClick={onRetry}>{ja.retry}</button>
      <details><summary>{ja.errorDetail}</summary><p>{error.code}：{error.message}</p></details>
    </div>
  );
}

export function Status({ status }: { status: 'certified' | 'auto' }) {
  return <span className={'badge ' + status} title={status === 'auto' ? ja.autoNote : ''}>{status === 'certified' ? ja.certified : ja.auto}</span>;
}

export const ArticleLink = ({ a }: { a: { title: string; url: string } }) =>
  a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer">{a.title}</a> : <span>{a.title}</span>;
