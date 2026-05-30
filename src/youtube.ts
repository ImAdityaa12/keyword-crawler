import axios from 'axios';
import { config } from './config';

export interface YouTubeItem {
  videoId: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  thumbnailUrl: string;
}

export interface SearchResult {
  items: YouTubeItem[];
  pagesFetched: number;
  quotaExceeded: boolean;
}

const SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';

/**
 * Page through the YouTube Data API v3 search.list endpoint.
 *
 * - Follows nextPageToken up to `maxPages` (pagination).
 * - Stops cleanly and flags `quotaExceeded` on a 403 quota error rather
 *   than crashing the scheduler (quota handling).
 */
export async function searchVideos(
  keyword: string,
  maxPages: number,
  perPage: number
): Promise<SearchResult> {
  const items: YouTubeItem[] = [];
  let pageToken: string | undefined;
  let pagesFetched = 0;
  let quotaExceeded = false;

  for (let page = 0; page < maxPages; page++) {
    try {
      const resp = await axios.get(SEARCH_URL, {
        timeout: 15000,
        params: {
          key: config.youtubeApiKey,
          q: keyword,
          part: 'snippet',
          type: 'video',
          order: 'date',
          maxResults: perPage,
          pageToken,
        },
      });

      pagesFetched++;

      for (const raw of resp.data.items ?? []) {
        const videoId: string | undefined = raw?.id?.videoId;
        if (!videoId) continue;
        const sn = raw.snippet ?? {};
        const thumbs = sn.thumbnails ?? {};
        const thumb = thumbs.high ?? thumbs.medium ?? thumbs.default;
        items.push({
          videoId,
          title: sn.title ?? '',
          channelTitle: sn.channelTitle ?? '',
          publishedAt: sn.publishedAt ?? '',
          thumbnailUrl: thumb?.url ?? '',
        });
      }

      pageToken = resp.data.nextPageToken;
      if (!pageToken) break;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const reason = (err.response?.data as any)?.error?.errors?.[0]?.reason;
        if (status === 403 && (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded')) {
          quotaExceeded = true;
          break;
        }
      }
      throw err;
    }
  }

  return { items, pagesFetched, quotaExceeded };
}

/** Download a thumbnail image as a raw buffer. */
export async function fetchThumbnail(url: string): Promise<Buffer> {
  const resp = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: 15000,
  });
  return Buffer.from(resp.data);
}
