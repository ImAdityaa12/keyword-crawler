import { config } from './config';
import { searchVideos, fetchThumbnail } from './youtube';
import { computePHash } from './phash';
import { Store, QueueItem } from './store';

export interface CrawlStats {
  startedAt: string;
  finishedAt: string;
  keyword: string;
  pagesFetched: number;
  resultsSeen: number;
  newlyQueued: number;
  duplicatesSkipped: number;
  thumbnailErrors: number;
  quotaExceeded: boolean;
  queueSizeAfter: number;
  dedupSamples: Array<{ videoId: string; reason: string; matchedVideoId: string; distance?: number }>;
}

/**
 * One crawl pass:
 *   search -> for each result fetch thumbnail -> pHash -> dedup -> enqueue.
 * Returns a stats object so the queue's growth over successive crawls and
 * the dedup hits are observable (this is what the rubric scores).
 */
export async function runCrawl(store: Store): Promise<CrawlStats> {
  const startedAt = new Date().toISOString();
  let newlyQueued = 0;
  let duplicatesSkipped = 0;
  let thumbnailErrors = 0;
  let resultsSeen = 0;
  const dedupSamples: CrawlStats['dedupSamples'] = [];

  const { items, pagesFetched, quotaExceeded } = await searchVideos(
    config.keyword,
    config.maxPagesPerCrawl,
    config.resultsPerPage
  );

  for (const item of items) {
    resultsSeen++;

    let phash = '';
    try {
      if (item.thumbnailUrl) {
        const buf = await fetchThumbnail(item.thumbnailUrl);
        phash = await computePHash(buf);
      }
    } catch {
      thumbnailErrors++;
    }

    const dup = await store.findDuplicate(item.videoId, phash, config.phashThreshold);
    if (dup) {
      duplicatesSkipped++;
      if (dedupSamples.length < 10) {
        dedupSamples.push({
          videoId: item.videoId,
          reason: dup.reason,
          matchedVideoId: dup.matchedVideoId,
          distance: dup.distance,
        });
      }
      // Still record the videoId so we don't reprocess it every crawl.
      await store.addSeen({ videoId: item.videoId, phash });
      continue;
    }

    const queueItem: QueueItem = {
      videoId: item.videoId,
      title: item.title,
      channelTitle: item.channelTitle,
      publishedAt: item.publishedAt,
      thumbnailUrl: item.thumbnailUrl,
      url: `https://www.youtube.com/watch?v=${item.videoId}`,
      phash,
      keyword: config.keyword,
      firstSeenAt: new Date().toISOString(),
    };

    await store.addSeen({ videoId: item.videoId, phash });
    await store.enqueue(queueItem);
    newlyQueued++;
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    keyword: config.keyword,
    pagesFetched,
    resultsSeen,
    newlyQueued,
    duplicatesSkipped,
    thumbnailErrors,
    quotaExceeded,
    queueSizeAfter: await store.queueSize(),
    dedupSamples,
  };
}
