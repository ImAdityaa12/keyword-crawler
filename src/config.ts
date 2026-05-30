import dotenv from 'dotenv';

dotenv.config();

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  youtubeApiKey: process.env.YOUTUBE_API_KEY ?? '',
  keyword: process.env.KEYWORD ?? 'lofi hip hop',
  crawlIntervalMinutes: Math.min(Math.max(int('CRAWL_INTERVAL_MINUTES', 5), 1), 59),
  maxPagesPerCrawl: Math.max(int('MAX_PAGES_PER_CRAWL', 2), 1),
  resultsPerPage: Math.min(Math.max(int('RESULTS_PER_PAGE', 25), 1), 50),
  runOnStartup: (process.env.RUN_ON_STARTUP ?? 'true').toLowerCase() === 'true',
  phashThreshold: int('PHASH_THRESHOLD', 5),
  // Cap on the dedup index ("seen") so memory can't grow without bound.
  // Oldest records are evicted FIFO once the cap is exceeded. 0 = unlimited.
  maxSeenRecords: Math.max(int('MAX_SEEN_RECORDS', 50_000), 0),
  // Debounce window (ms) for flushing the in-memory store to JSON. Batches
  // many writes into one file rewrite instead of rewriting on every add.
  persistDebounceMs: Math.max(int('PERSIST_DEBOUNCE_MS', 1000), 0),
  redisUrl: process.env.REDIS_URL ?? '',
  dataDir: process.env.DATA_DIR ?? 'data',
  port: int('PORT', 8000),
};

export type Config = typeof config;
