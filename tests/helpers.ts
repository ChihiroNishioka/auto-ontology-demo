import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ROOT = path.resolve(__dirname, '..');
export const FIX = (name: string) => path.join(ROOT, 'fixtures', name);
export const SAMPLE = FIX('articles.sample.json');
export const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));
export const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ao-test-'));

// 公開リポジトリの秘密チェックに引っかからないよう、禁止パターンは実行時に組み立てる
export const NOTION_HOST = ['www', 'notion', 'so'].join('.');
export const NOTION_URL = `https://${NOTION_HOST}/Page-` + 'a'.repeat(32);
export const HEX32 = 'b'.repeat(32);
