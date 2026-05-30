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
  redisUrl: process.env.REDIS_URL ?? '',
  dataDir: process.env.DATA_DIR ?? 'data',
  port: int('PORT', 8000),
};

export type Config = typeof config;
