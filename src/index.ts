import cron from 'node-cron';
import { config } from './config';
import { createStore } from './store';
import { runCrawl, CrawlStats } from './crawler';
import { createServer } from './server';

async function main(): Promise<void> {
  if (!config.youtubeApiKey) {
    console.warn('[warn] YOUTUBE_API_KEY is not set — crawls will fail until you add it to .env');
  }

  const store = await createStore();
  console.log(`[init] store backend: ${store.backend()}`);

  const history: CrawlStats[] = [];
  let running = false;

  const doCrawl = async (): Promise<CrawlStats | null> => {
    if (running) {
      console.log('[crawl] skipped — previous crawl still running');
      return null;
    }
    running = true;
    const tick = new Date().toISOString();
    console.log(`[crawl] starting (${tick}) keyword="${config.keyword}"`);
    try {
      const stats = await runCrawl(store);
      history.push(stats);
      if (history.length > 200) history.shift();
      console.log(
        `[crawl] done: seen=${stats.resultsSeen} new=${stats.newlyQueued} ` +
          `dup=${stats.duplicatesSkipped} queue=${stats.queueSizeAfter}` +
          (stats.quotaExceeded ? ' (quota exceeded)' : '')
      );
      return stats;
    } catch (err) {
      console.error('[crawl] error:', (err as Error).message);
      return null;
    } finally {
      running = false;
    }
  };

  const app = createServer({
    store,
    history: () => history,
    triggerCrawl: doCrawl,
    isRunning: () => running,
  });

  app.listen(config.port, () => {
    console.log(`[http] listening on http://localhost:${config.port}`);
    console.log(`[http]   GET  /queue   — the filling queue`);
    console.log(`[http]   GET  /stats   — per-crawl metrics`);
    console.log(`[http]   POST /crawl   — trigger a crawl now`);
  });

  const expr = `*/${config.crawlIntervalMinutes} * * * *`;
  cron.schedule(expr, () => {
    void doCrawl();
  });
  console.log(`[sched] crawling every ${config.crawlIntervalMinutes} min (cron "${expr}")`);

  // Flush buffered writes / close connections cleanly on shutdown so we don't
  // lose the last debounce window of the queue or dedup index.
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[exit] ${signal} — flushing store`);
    try {
      await store.close();
    } catch (err) {
      console.error('[exit] error closing store:', (err as Error).message);
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  if (config.runOnStartup) {
    void doCrawl();
  }
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
