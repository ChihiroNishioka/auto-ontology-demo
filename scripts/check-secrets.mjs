// 公開リポジトリに秘密・個人情報・Notion のデータが入っていないか確かめる。
// 禁止パターンはここで組み立てる（このファイル自身は走査しない）。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const j = (...p) => p.join('');
const RULES = [
  { kind: 'notion-domain', re: new RegExp(j('notion', String.raw`\.(so|com|site)\b`), 'i') },
  { kind: 'notion-collection', re: new RegExp(j('collection', String.raw`:\/\/`), 'i') },
  { kind: 'hex32-id', re: /(?<![0-9a-fA-F])[0-9a-fA-F]{32}(?![0-9a-fA-F])/ },
  { kind: 'private-key', re: new RegExp(j('-----BEGIN ', '[A-Z ]*', 'KEY-----')) },
  { kind: 'key-sk', re: new RegExp(j('\\bsk', '-[A-Za-z0-9_-]{20,}')) },
  { kind: 'key-nvapi', re: new RegExp(j('\\bnvapi', '-[A-Za-z0-9_-]{20,}')) },
  { kind: 'key-ghp', re: new RegExp(j('\\bgh[pousr]', '_[A-Za-z0-9]{30,}')) },
  { kind: 'key-github-pat', re: new RegExp(j('github', '_pat_[A-Za-z0-9_]{20,}')) },
  { kind: 'key-aws', re: new RegExp(j('\\bAK', 'IA[0-9A-Z]{16}\\b')) },
  { kind: 'key-slack', re: new RegExp(j('\\bxox[bp]', '-[A-Za-z0-9-]{10,}')) },
  { kind: 'phone', re: /(?<![\d-])(?:\+81[-\s]?|0)\d{1,4}[-\s]\d{2,4}[-\s]\d{3,4}(?![\d-])/ },
];
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;
const OK_EMAIL = (local, domain) => /(^|\.)example\.(com|org|net)$/i.test(domain) || /^noreply$/i.test(local);

export function scanText(name, text) {
  const out = [];
  for (const r of RULES) {
    const m = r.re.exec(text);
    if (m) out.push({ kind: r.kind, detail: `${name}: ${r.kind}` });
  }
  for (const m of text.matchAll(EMAIL)) {
    const local = m[0].slice(0, m[0].lastIndexOf('@'));
    if (!OK_EMAIL(local, m[1])) out.push({ kind: 'email', detail: `${name}: email` });
  }
  return out;
}

const FORBIDDEN_PATH = [/(^|\/)local-data(\/|$)/, /(^|\/)articles-rows[^/]*$/, /(^|\/)article-[^/]*\.txt$/, /\.local\.json$/, /(^|\/)\.env(\.|$)/];
export function isForbiddenPath(p) {
  return FORBIDDEN_PATH.some((re) => re.test(p));
}

const SELF = 'scripts/check-secrets.mjs';
function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const bad = [];
  for (const f of files) {
    if (f === SELF || f === 'package-lock.json' || /\.(png|jpg|ico)$/i.test(f)) continue;
    if (isForbiddenPath(f)) { bad.push(`${f}: 追跡してはいけないファイル`); continue; }
    if (!fs.existsSync(path.join(root, f))) continue;
    for (const x of scanText(f, fs.readFileSync(path.join(root, f), 'utf8'))) bad.push(x.detail);
  }
  if (bad.length) {
    console.error('秘密・個人情報チェックで見つかりました:\n' + bad.map((b) => '  - ' + b).join('\n'));
    process.exit(1);
  }
  console.log(`秘密・個人情報チェック OK（${files.length} ファイル）`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
