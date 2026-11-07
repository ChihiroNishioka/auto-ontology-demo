import { useCallback, useEffect, useState } from 'react';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try { res = await fetch(url, init); } catch { throw new ApiError(0, 'NETWORK', '通信に失敗しました'); }
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* 本文が JSON でない */ }
  if (!res.ok) throw new ApiError(res.status, body?.error?.code ?? 'HTTP_' + res.status, body?.error?.message ?? `HTTP ${res.status}`);
  return body as T;
}

export function useApi<T>(url: string | null) {
  const [state, setState] = useState<{ data?: T; error?: ApiError; loading: boolean }>({ loading: !!url });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let live = true;
    setState((s) => ({ data: s.data, loading: true }));
    api<T>(url).then(
      (data) => live && setState({ data, loading: false }),
      (error) => live && setState({ error, loading: false }),
    );
    return () => { live = false; };
  }, [url, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
