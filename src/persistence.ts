import fs from 'fs';
import path from 'path';
import { config } from './config';

function ensureDir(): void {
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }
}

export function readJson<T>(file: string, fallback: T): T {
  const p = path.join(config.dataDir, file);
  try {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
    }
  } catch {
    /* corrupt file => fall back */
  }
  return fallback;
}

export function writeJson(file: string, data: unknown): void {
  ensureDir();
  const p = path.join(config.dataDir, file);
  // write-then-rename for crash safety
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, p);
}
