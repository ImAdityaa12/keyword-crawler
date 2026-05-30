# YouTube Keyword Crawler + Dedup (TypeScript)

A scheduled TypeScript service that polls the **YouTube Data API v3** for a
keyword every N minutes, computes a **perceptual hash (pHash)** of each result's
thumbnail, deduplicates against everything seen, and queues only the **new**
uploads. A re-upload of the same content (same thumbnail, different URL / videoId)
is caught by the hash and never queued twice. The queue is exposed at `GET /queue`.

## What it does

- Every N minutes, queries the YouTube Data API v3 for a configurable keyword.
- Pages through the results and handles the API quota gracefully.
- For each result: fetches the thumbnail, computes a **pHash**, and **dedups**
  against everything seen so far.
- Pushes only **new** items to a queue (in-memory or Redis) and persists them.
- Exposes `GET /queue`.

## Tech stack

| Role               | Library                  |
| ------------------ | ------------------------ |
| Language / runtime | TypeScript on Node 18+   |
| HTTP server/routes | Express                  |
| Scheduler          | node-cron                |
| HTTP client        | axios                    |
| Perceptual hash    | Jimp + custom DCT pHash  |
| Queue/persistence  | in-memory + JSON / Redis |

## Requirements

- Node.js 18+ and npm.
- A free YouTube Data API v3 key (below).

## Get an API key (free)

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create
   (or pick) a project.
2. **APIs & Services → Library →** search **"YouTube Data API v3" → Enable**.
3. **APIs & Services → Credentials → Create credentials → API key**.
4. Copy the key — you'll paste it into `.env` in the next section.

Free quota is 10,000 units/day; each search page costs 100 units (~100 pages/day),
which is plenty for this task.

## Steps to run (local)

```bash
# 1. install dependencies
npm install

# 2. create your env file and add the API key
copy .env.example .env        # macOS/Linux: cp .env.example .env
#   then open .env and set YOUTUBE_API_KEY=your_key_here
#   (optional) set KEYWORD, CRAWL_INTERVAL_MINUTES, etc.

# 3a. run in dev (ts-node, crawls once on startup, then every N minutes)
npm run dev

#   --- or ---

# 3b. build and run the compiled output
npm run build
npm start
```

The server starts on `http://localhost:8000`. Check it:

```bash
curl http://localhost:8000/queue           # the de-duplicated queue
curl -X POST http://localhost:8000/crawl   # trigger a crawl right now
curl http://localhost:8000/stats           # per-crawl metrics + history
```

### Handy scripts

```bash
npm run crawl:once     # run a single crawl and print the stats, then exit
npm run test:dedup     # prove a re-upload is caught (same image, re-encoded)
npm run phash:demo -- <imageA-url-or-path> <imageB-url-or-path>   # compare two images
```

## Endpoints

| Method | Path      | Description                                  |
| ------ | --------- | -------------------------------------------- |
| GET    | `/queue`  | the filling queue (`count`, `seen`, `items`) |
| GET    | `/stats`  | per-crawl metrics + history                  |
| GET    | `/health` | liveness                                     |
| POST   | `/crawl`  | trigger a crawl immediately (for demos)      |

## Configuration (`.env`)

| Variable                 | Default        | Meaning                                    |
| ------------------------ | -------------- | ------------------------------------------ |
| `YOUTUBE_API_KEY`        | —              | **required**                               |
| `KEYWORD`                | `lofi hip hop` | search term                                |
| `CRAWL_INTERVAL_MINUTES` | `5`            | minutes between crawls (1–59)              |
| `MAX_PAGES_PER_CRAWL`    | `2`            | pages followed per crawl (100 units each)  |
| `RESULTS_PER_PAGE`       | `25`           | results per page (1–50)                    |
| `RUN_ON_STARTUP`         | `true`         | crawl immediately on boot                  |
| `PHASH_THRESHOLD`        | `5`            | max Hamming distance to treat as duplicate |
| `MAX_SEEN_RECORDS`       | `50000`        | cap on the dedup index; oldest evicted FIFO (`0` = unlimited) |
| `PERSIST_DEBOUNCE_MS`    | `1000`         | batch window for JSON writes (`0` = write immediately) |
| `REDIS_URL`              | —              | use Redis instead of in-memory if set      |
| `DATA_DIR`               | `data`         | where JSON persistence is written          |
| `PORT`                   | `8000`         | HTTP port                                  |

## How dedup works

- **Exact**: a `videoId` already seen is skipped.
- **Perceptual**: the thumbnail's DCT pHash is compared by Hamming distance
  against every previously seen hash. A re-upload keeps the same thumbnail, so its
  hash lands within `PHASH_THRESHOLD` of the original and the item is **not**
  queued again, even though the URL / videoId differ.

## Memory & scaling (what happens when "seen" gets large)

The dedup index grows with every unique video. Left unbounded it would eventually
exhaust the Node heap (in-memory) or Redis memory. This is handled by:

- **Bounded index** — `seen` is capped at `MAX_SEEN_RECORDS` and evicts the
  oldest records FIFO. The in-memory store bounds the Node heap; the Redis store
  bounds the key via `LTRIM` (and keeps the id set in sync). Set `0` to disable.
- **Idempotent recording** — a `videoId` is recorded once, so re-seeing the same
  video on later crawls no longer grows the index.
- **Batched persistence** — writes are debounced (`PERSIST_DEBOUNCE_MS`) instead
  of rewriting the whole JSON file on every add, and flushed on shutdown
  (`SIGINT`/`SIGTERM`). Each flush is still atomic (write-then-rename).

For an index far larger than the default cap, replace the linear pHash scan in
`findDuplicate` with band-bucketed (pigeonhole/LSH) lookup, and when using Redis
set `maxmemory` with an eviction policy so the server itself can't OOM.

## Deploy (live URL)

A `Dockerfile`, `render.yaml`, and `Procfile` are included.

On Render / Railway / Fly:
- Build command: `npm install && npm run build`
- Start command: `npm start`
- Env vars: `YOUTUBE_API_KEY` (and optionally `REDIS_URL`, `KEYWORD`, etc.)

The scheduler runs in-process, so once the service is up the crawl fires on the
deployed host automatically — no separate cron needed.

## Hard requirements (and where they're handled)

- **Pagination + quota** — `src/youtube.ts` follows `nextPageToken` up to
  `MAX_PAGES_PER_CRAWL` and stops cleanly on a 403 `quotaExceeded` instead of
  crashing.
- **Perceptual dedup** — `src/phash.ts` (DCT pHash) + `src/store.ts` (Hamming
  distance against everything seen). Prove it with `npm run test:dedup`.
- **Schedule runs on the host** — `node-cron` registers an in-process
  `*/N * * * *` job in `src/index.ts`, so it runs wherever the service is deployed.

## Project layout

```
src/
  config.ts        env-driven config
  phash.ts         DCT perceptual hash + Hamming distance
  youtube.ts       search.list pagination + quota handling + thumbnail fetch
  store.ts         queue + dedup index (MemoryStore | RedisStore)
  persistence.ts   crash-safe JSON read/write
  crawler.ts       one crawl pass (search -> hash -> dedup -> enqueue)
  server.ts        Express routes
  index.ts         scheduler + server bootstrap
  cli-crawl.ts     run one crawl from the CLI
  cli-phash.ts     compare two images
test/
  dedup-test.js    re-upload dedup proof
```
