import { spawn } from 'node:child_process';

// 任意機能：手元の claude CLI に経路と根拠文だけを渡して要約させる。失敗しても null を返すだけ。
export function summarizeWithClaude(prompt: string, timeoutMs = 60000): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: string | null) => { if (!done) { done = true; resolve(v); } };
    try {
      const p = spawn('claude', ['-p'], { stdio: ['pipe', 'pipe', 'ignore'] });
      let out = '';
      const t = setTimeout(() => { p.kill('SIGKILL'); finish(null); }, timeoutMs);
      p.stdout.on('data', (d) => (out += d));
      p.on('error', () => { clearTimeout(t); finish(null); });
      p.on('close', (code) => { clearTimeout(t); finish(code === 0 && out.trim() ? out.trim() : null); });
      p.stdin.on('error', () => undefined);
      p.stdin.end(prompt);
    } catch {
      finish(null);
    }
  });
}
