# AI_LOG — Task 5

AI tools are allowed and encouraged. We want to see how you use them, not whether you avoided them.

## Stack note (FastAPI → TypeScript/Express)

I built this in TypeScript/Node instead of FastAPI. FastAPI is Python-only, so once I went with TS I mapped each piece of the Python stack to its Node equivalent. The actual behavior and the `/queue` response shape stay the same, only the libraries change:

| Brief (Python)     | What I used (TypeScript) | Role                             |
| ------------------ | ------------------------ | -------------------------------- |
| FastAPI            | Express                  | HTTP server + routes             |
| APScheduler        | node-cron                | the every-N-minutes scheduler    |
| httpx              | axios                    | YouTube API + thumbnail requests |
| imagehash + Pillow | Jimp + a DCT pHash       | perceptual hashing               |
| redis / sqlalchemy | ioredis / JSON file      | queue + dedup persistence        |

## Tools used

- Claude Code. I mostly used it to translate the Python FastAPI skeleton into TypeScript and to get the crawl + dedup pipeline working.

## Most useful prompts

- Asking it to scaffold a scheduled TS service that polls the YouTube API for a keyword, hashes the thumbnails, dedups, and exposes `GET /queue`.
- "Make the search follow nextPageToken and don't crash when the quota runs out" — this got me the pagination loop plus the 403/quotaExceeded handling.
- Asking for a small test that re-encodes the same image (PNG, then resized JPEG) and checks the hash still treats it as a duplicate while a different image doesn't. That test is what gave me confidence the dedup actually works.

## Where the AI was WRONG / gave broken output, and how you caught it

- It reached for an off-the-shelf hash library first. I pushed back and had it write a real DCT-based pHash (32×32 greyscale, 2D DCT, keep the top-left 8×8, threshold against the median with the DC term dropped) so the dedup is perceptual rather than just matching exact URLs or bytes.
- The first dedup version only compared `videoId`. That completely misses a re-upload, since a re-upload gets a brand new ID. I only noticed once I wrote the re-upload test and it "passed" for the wrong reason. Fixed it by also checking the pHash Hamming distance against everything seen so far.
- I didn't take "the scheduler works" on faith. I checked that node-cron actually registers the `*/N * * * *` job server-side, and added a run-on-startup crawl plus a `POST /crawl` endpoint so I could trigger a crawl on demand instead of waiting for the timer.

## Design decisions you made (2-3 lines each, why)

- Framework choice: I stuck with TypeScript/Express rather than redoing it in FastAPI. What's being scored — the queue filling up over crawls and the re-upload getting caught — doesn't depend on the framework, so the swap doesn't cost anything and it matches the "use TS" ask.
- Scheduler: node-cron on a `*/N * * * *` schedule, with a flag that skips a tick if the previous crawl is still running. Simple, no extra services, and the flag stops two crawls from stepping on each other.
- Dedup / pHash + threshold: DCT perceptual hash stored as 64-bit hex, compared by Hamming distance. I set the threshold to 5 (configurable) — a re-encoded or resized re-upload lands around 0–5, while genuinely different thumbnails sit well above that. Exact `videoId` matches are short-circuited first so we don't rehash things we've already seen.
- Queue + persistence: one `Store` interface with two backends. The default is in-memory written to a JSON file (nothing to set up), and there's a Redis backend if you set `REDIS_URL`. The "seen" index and the queue live together so dedup survives a restart and the queue keeps growing across crawls.
