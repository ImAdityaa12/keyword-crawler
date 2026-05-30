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

/**
 * Batches JSON writes so a hot path (e.g. one `addSeen` per crawled video)
 * doesn't rewrite the whole file on every call — which is O(n) per write and
 * O(n^2) over a crawl. Callers `schedule()` the current data object; all dirty
 * files are flushed once per debounce window. The live object is serialized at
 * flush time, so it always reflects the latest state.
 *
 * Tradeoff: up to `delayMs` of writes can be lost on a hard crash. Each flush
 * is still atomic (write-then-rename), and `flush()` is called on shutdown.
 */
export class DebouncedWriter {
  private dirty = new Map<string, unknown>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private delayMs: number) {}

  schedule(file: string, data: unknown): void {
    this.dirty.set(file, data);
    if (this.delayMs <= 0) {
      this.flush();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.delayMs);
      // Don't keep the event loop alive just to flush.
      this.timer.unref?.();
    }
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const [file, data] of this.dirty) writeJson(file, data);
    this.dirty.clear();
  }
}
