import { config } from './config';
import { hammingDistance } from './phash';
import { readJson, DebouncedWriter } from './persistence';

export interface QueueItem {
  videoId: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  thumbnailUrl: string;
  url: string;
  phash: string;
  keyword: string;
  firstSeenAt: string;
}

export interface SeenRecord {
  videoId: string;
  phash: string;
}

export interface DuplicateMatch {
  reason: 'exact-videoId' | 'phash-match';
  matchedVideoId: string;
  distance?: number;
}

/**
 * A Store owns both the dedup index ("everything seen") and the queue
 * ("only new items"). Two implementations are provided: an in-memory
 * store persisted to JSON, and a Redis-backed store.
 */
export interface Store {
  init(): Promise<void>;
  findDuplicate(videoId: string, phash: string, threshold: number): Promise<DuplicateMatch | null>;
  addSeen(rec: SeenRecord): Promise<void>;
  enqueue(item: QueueItem): Promise<void>;
  getQueue(): Promise<QueueItem[]>;
  queueSize(): Promise<number>;
  seenCount(): Promise<number>;
  backend(): string;
  /** Flush any buffered writes and release resources (called on shutdown). */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory store (persisted to ./data/*.json)
// ---------------------------------------------------------------------------

export class MemoryStore implements Store {
  private queue: QueueItem[] = [];
  // `seen` is the FIFO dedup index. It is bounded by config.maxSeenRecords so
  // the heap can't grow without limit; oldest records are evicted first.
  private seen: SeenRecord[] = [];
  private seenIds = new Set<string>();
  private writer = new DebouncedWriter(config.persistDebounceMs);

  async init(): Promise<void> {
    this.queue = readJson<QueueItem[]>('queue.json', []);
    // De-dup any repeated videoIds from legacy files (older versions appended a
    // record per crawl), keeping each id's latest record and original order.
    const loaded = readJson<SeenRecord[]>('seen.json', []);
    const byId = new Map<string, SeenRecord>();
    for (const r of loaded) byId.set(r.videoId, r);
    this.seen = [...byId.values()];
    this.enforceCap();
    this.seenIds = new Set(this.seen.map((s) => s.videoId));
  }

  async findDuplicate(
    videoId: string,
    phash: string,
    threshold: number
  ): Promise<DuplicateMatch | null> {
    if (this.seenIds.has(videoId)) {
      return { reason: 'exact-videoId', matchedVideoId: videoId };
    }
    if (phash) {
      // Linear scan, now bounded by maxSeenRecords. For a much larger index,
      // bucket phashes by band (pigeonhole/LSH) to avoid the full scan.
      for (const s of this.seen) {
        if (!s.phash) continue;
        const d = hammingDistance(s.phash, phash);
        if (d <= threshold) {
          return { reason: 'phash-match', matchedVideoId: s.videoId, distance: d };
        }
      }
    }
    return null;
  }

  async addSeen(rec: SeenRecord): Promise<void> {
    // Idempotent: a videoId is recorded once. (The crawler re-calls this for
    // duplicates; without this guard the index would grow on every crawl.)
    if (this.seenIds.has(rec.videoId)) return;
    this.seen.push(rec);
    this.seenIds.add(rec.videoId);
    this.evictOverflow();
    this.writer.schedule('seen.json', this.seen);
  }

  // Drop the single new overflow record (called after each add).
  private evictOverflow(): void {
    if (config.maxSeenRecords <= 0) return;
    while (this.seen.length > config.maxSeenRecords) {
      const evicted = this.seen.shift();
      if (evicted) this.seenIds.delete(evicted.videoId);
    }
  }

  // Trim a bulk overflow (e.g. after loading a large file or a lowered cap).
  private enforceCap(): void {
    if (config.maxSeenRecords > 0 && this.seen.length > config.maxSeenRecords) {
      this.seen.splice(0, this.seen.length - config.maxSeenRecords);
    }
  }

  async enqueue(item: QueueItem): Promise<void> {
    this.queue.push(item);
    this.writer.schedule('queue.json', this.queue);
  }

  async getQueue(): Promise<QueueItem[]> {
    return this.queue;
  }

  async queueSize(): Promise<number> {
    return this.queue.length;
  }

  async seenCount(): Promise<number> {
    return this.seen.length;
  }

  backend(): string {
    const cap = config.maxSeenRecords > 0 ? `cap ${config.maxSeenRecords}` : 'uncapped';
    return `memory (persisted to ${config.dataDir}, ${cap})`;
  }

  async close(): Promise<void> {
    this.writer.flush();
  }
}

// ---------------------------------------------------------------------------
// Redis store
// ---------------------------------------------------------------------------

const Q_KEY = 'crawler:queue';
const SEEN_IDS_KEY = 'crawler:seen:ids';
const SEEN_PHASH_KEY = 'crawler:seen:phashes';

export class RedisStore implements Store {
  private redis: any;

  constructor(private url: string) {}

  async init(): Promise<void> {
    const mod = await import('ioredis');
    const Redis = (mod as any).default ?? mod;
    this.redis = new Redis(this.url);
  }

  async findDuplicate(
    videoId: string,
    phash: string,
    threshold: number
  ): Promise<DuplicateMatch | null> {
    if (await this.redis.sismember(SEEN_IDS_KEY, videoId)) {
      return { reason: 'exact-videoId', matchedVideoId: videoId };
    }
    if (phash) {
      const entries: string[] = await this.redis.lrange(SEEN_PHASH_KEY, 0, -1);
      for (const e of entries) {
        const sep = e.indexOf('|');
        if (sep < 0) continue;
        const vid = e.slice(0, sep);
        const ph = e.slice(sep + 1);
        if (!ph) continue;
        const d = hammingDistance(ph, phash);
        if (d <= threshold) {
          return { reason: 'phash-match', matchedVideoId: vid, distance: d };
        }
      }
    }
    return null;
  }

  async addSeen(rec: SeenRecord): Promise<void> {
    // sadd returns 0 if the id was already present -> idempotent, and keeps the
    // phash list from accumulating a duplicate entry on every crawl.
    const added = await this.redis.sadd(SEEN_IDS_KEY, rec.videoId);
    if (added === 0) return;
    await this.redis.rpush(SEEN_PHASH_KEY, `${rec.videoId}|${rec.phash}`);

    if (config.maxSeenRecords <= 0) return;
    // Bound the index FIFO so Redis memory can't grow without limit. Capture the
    // ids being evicted so the membership set stays consistent with the list.
    const len: number = await this.redis.llen(SEEN_PHASH_KEY);
    if (len > config.maxSeenRecords) {
      const overflow = len - config.maxSeenRecords;
      const victims: string[] = await this.redis.lrange(SEEN_PHASH_KEY, 0, overflow - 1);
      const victimIds = victims
        .map((e) => e.slice(0, e.indexOf('|')))
        .filter((v) => v);
      const multi = this.redis.multi();
      multi.ltrim(SEEN_PHASH_KEY, overflow, -1);
      if (victimIds.length) multi.srem(SEEN_IDS_KEY, ...victimIds);
      await multi.exec();
    }
  }

  async enqueue(item: QueueItem): Promise<void> {
    await this.redis.rpush(Q_KEY, JSON.stringify(item));
  }

  async getQueue(): Promise<QueueItem[]> {
    const arr: string[] = await this.redis.lrange(Q_KEY, 0, -1);
    return arr.map((s) => JSON.parse(s) as QueueItem);
  }

  async queueSize(): Promise<number> {
    return this.redis.llen(Q_KEY);
  }

  async seenCount(): Promise<number> {
    return this.redis.scard(SEEN_IDS_KEY);
  }

  backend(): string {
    const cap = config.maxSeenRecords > 0 ? `cap ${config.maxSeenRecords}` : 'uncapped';
    return `redis (${cap})`;
  }

  async close(): Promise<void> {
    if (this.redis) await this.redis.quit();
  }
}

export async function createStore(): Promise<Store> {
  const store: Store = config.redisUrl ? new RedisStore(config.redisUrl) : new MemoryStore();
  await store.init();
  return store;
}
