import fs from 'node:fs';
import path from 'node:path';
import type { Ontology } from './types';

const file = (dir: string, hash: string) => path.join(dir, `ontology-${hash}.json`);

export function readCache(dir: string, hash: string): Ontology | null {
  try {
    const o = JSON.parse(fs.readFileSync(file(dir, hash), 'utf8')) as Ontology;
    return o?.meta?.inputHash === hash ? o : null;
  } catch {
    return null;
  }
}

export function writeCache(dir: string, o: Ontology): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file(dir, o.meta.inputHash) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(o));
    fs.renameSync(tmp, file(dir, o.meta.inputHash));
  } catch {
    // キャッシュに書けなくても動く
  }
}
