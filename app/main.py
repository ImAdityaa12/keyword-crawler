"""
Task 5 — Keyword Crawler + Dedup
Fill in the TODOs. Keep the endpoint contracts as-is.
"""
import os
from fastapi import FastAPI

app = FastAPI(title="Keyword Crawler + Dedup")

KEYWORD = os.getenv("KEYWORD", "your test keyword here")
INTERVAL_MIN = int(os.getenv("INTERVAL_MIN", "5"))


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/queue")
def get_queue():
    """Return the current scan_queue (the new, de-duplicated items found so far)."""
    # TODO: read from your store
    return {"count": 0, "items": []}


def crawl_once():
    """
    Runs every INTERVAL_MIN minutes (wire this into APScheduler on startup):
      1. query YouTube Data API v3 for KEYWORD  (handle pagination + quota)
      2. for each video: fetch thumbnail, compute pHash
      3. dedup against everything seen (perceptual, not exact-URL)
      4. push NEW items to queue + persist to scan_queue
    """
    # TODO
    pass


@app.on_event("startup")
def start_scheduler():
    # TODO: schedule crawl_once() every INTERVAL_MIN minutes
    pass
