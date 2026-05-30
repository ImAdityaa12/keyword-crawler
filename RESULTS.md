# RESULTS — Task 5

Measured locally against the live YouTube Data API v3 on 2026-05-30.
(Update the "live deployment" line once deployed.)

## Setup
- Keyword used: `cricket`
- Interval (minutes): 5
- Pages per crawl: 2 (50 results/crawl), pHash threshold: 5
- Store: in-memory (persisted to `./data/*.json`)
- Live URL: _<paste your deployed URL here, e.g. https://…/queue>_

## Queue filling (over time)
The queue fills on the first crawl, then stays flat as later crawls re-see the
same videos and dedup them. Numbers from `GET /stats` / `npm run crawl:once`:

| Crawl # | results seen | new items added | duplicates skipped | total in queue |
|---------|--------------|-----------------|--------------------|----------------|
| 1       | 50           | 45              | 5                  | 45             |
| 2       | 50           | 0               | 50                 | 45             |
| 3       | 50           | 0               | 50                 | 45             |

- Crawl 1: 45 of 50 results were new. The 5 skipped were **perceptual** matches
  (`reason: "phash-match", distance: 0`) — i.e. distinct videoIds that share an
  identical thumbnail (real re-uploads already present in the live results).
- Crawls 2–3: all 50 results were already seen (`reason: "exact-videoId"`), so 0
  new items and the queue held steady at 45 — dedup works across crawls.

## Dedup proof (the important one)
Same content under a different URL / videoId is NOT queued twice. Reproduce with
`npm run test:dedup`.

- Original video: `XNbzA2jIAy4` — https://www.youtube.com/watch?v=XNbzA2jIAy4
  - thumbnail pHash: `cf253367d8709a61`
- "Re-upload": the same thumbnail re-encoded to JPEG (q72) and resized to 320×180
  (different bytes / URL, identical content)
  - pHash: `cf253367d8709a61`  → **distance from original = 0**  (≤ 5 ⇒ DUPLICATE, not queued)
- Control — a genuinely different video `9bryKVHWVDg`:
  - distance from original = **24**  (> 5 ⇒ kept, queued normally)

Extra real-world evidence from crawl 1 (`/stats` → `latest.dedupSamples`): two
different videos hashed to the same thumbnail and the second was skipped:

```json
{ "videoId": "LLx7vbTYQ4s", "reason": "phash-match", "matchedVideoId": "5AM4z35i_f8", "distance": 0 }
```

Robustness check on a real thumbnail (`XNbzA2jIAy4`): JPEG re-encode q85 → distance 0,
q60 → distance 0, PNG re-encode → distance 0, resize to 160×90 → distance 2. All
within threshold, so re-encodings of the same image dedup reliably.

## Pagination + quota
- Each crawl follows `nextPageToken` for `MAX_PAGES_PER_CRAWL=2` pages (50 results).
- `search.list` costs 100 units/page ⇒ 200 units/crawl. At a 5-min interval that's
  well under the 10,000 units/day free quota.
- A 403 `quotaExceeded` is caught in `src/youtube.ts`; the crawl stops and sets
  `quotaExceeded: true` in the stats instead of crashing the scheduler.
  (`quotaExceeded` was `false` for every crawl above.)

## Notes
- Anything I'd improve with more time:
  - Replace the linear pHash scan with a BK-tree / LSH bucket so dedup stays fast
    as "seen" grows into the thousands.
  - Add a small web UI for the queue and per-crawl stats.
  - Hash multiple thumbnail resolutions and a frame or two to catch re-uploads
    that change the thumbnail but keep the video.
