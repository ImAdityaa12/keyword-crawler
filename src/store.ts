import { config } from './config';
import { hammingDistance } from './phash';
import { readJson, writeJson } from './persistence';

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
}

// ---------------------------------------------------------------------------
// In-memory store (persisted to ./data/*.json)
// ---------------------------------------------------------------------------

export class MemoryStore implements Store {
  private queue: QueueItem[] = [];
  private seen: SeenRecord[] = [];
  private seenIds = new Set<string>();

  async init(): Promise<void> {
    this.queue = readJson<QueueItem[]>('queue.json', []);
    this.seen = readJson<SeenRecord[]>('seen.json', []);
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
    this.seen.push(rec);
    this.seenIds.add(rec.videoId);
    writeJson('seen.json', this.seen);
  }

  async enqueue(item: QueueItem): Promise<void> {
    this.queue.push(item);
    writeJson('queue.json', this.queue);
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
    return 'memory (persisted to ' + config.dataDir + ')';
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
    await this.redis.sadd(SEEN_IDS_KEY, rec.videoId);
    await this.redis.rpush(SEEN_PHASH_KEY, `${rec.videoId}|${rec.phash}`);
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
    return 'redis';
  }
}

export async function createStore(): Promise<Store> {
  const store: Store = config.redisUrl ? new RedisStore(config.redisUrl) : new MemoryStore();
  await store.init();
  return store;
}
