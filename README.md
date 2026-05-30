# Task 5 — Keyword Crawler + Dedup (starter)

Fill in `app/main.py`. Deploy it live, running on a schedule. Report in `RESULTS.md`.

## What to build
A FastAPI service + scheduler that:
- Every N minutes, queries the **YouTube Data API v3** for a configurable keyword.
- For each result: fetch the thumbnail, compute a **perceptual hash (pHash)**, and **dedup** against everything seen so far.
- Push only **new** items to a queue (Redis or in-memory) and persist them to a table (`scan_queue`).

## Get an API key (free)
1. Google Cloud Console → new project → enable "YouTube Data API v3".
2. Create an API key. Put it in `.env` as `YT_API_KEY=...`.
(Free quota is plenty for this task.)

## Run locally
```bash
pip install -r requirements.txt
cp .env.example .env   # add your YT_API_KEY
uvicorn app.main:app --reload
```

## Deliver
1. This repo (public GitHub, real commit history).
2. A **live URL** with the scheduler actually running.
3. `RESULTS.md` filled in (show the queue filling + a deduped re-upload).
4. `AI_LOG.md` filled in.

## Hard requirements
- Handle **pagination + rate limits/quota** (must not break past the first page of results).
- Dedup must be **perceptual** (pHash), so the same video re-uploaded under a different URL is NOT queued twice. Prove this with a concrete example.
- The schedule must actually run on the deployed host (not just locally).

Time: ~1 day. Questions → reply to the email.
