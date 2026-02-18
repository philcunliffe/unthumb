# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Chrome MV3 extension ("unthumb") that replaces YouTube homepage thumbnails with a still frame from ~30% into the video, extracted from YouTube's storyboard sprite sheets.

## Development

No build step. Load as an unpacked extension in `chrome://extensions` (enable Developer Mode). After any code change, click the reload button on the extension card and refresh YouTube.

To inspect the service worker (background.js), click "Inspect" on the extension card in `chrome://extensions`. Content script logs appear in the YouTube page's DevTools console.

## Architecture

**content.js** — Injected into YouTube pages. Finds thumbnail anchor elements, sends messages to the background worker requesting storyboard frames, and swaps the original `<img>` for a CSS background-image overlay showing the sprite tile.

**background.js** — Service worker. Receives `GET_STORYBOARD_FRAME` messages, fetches the YouTube watch page HTML, extracts `ytInitialPlayerResponse` via brace-balanced parsing, parses the storyboard spec (pipe-delimited layers of `w#h#count#cols#rows#...#...#sig`), computes which sprite tile corresponds to the target fraction, and returns the sprite URL + position. Has an in-memory cache (1h TTL) and concurrency limiter (max 6 inflight fetches).

**styles.css** — Positions the overlay absolutely inside the thumbnail anchor, hides the original `<img>` with `opacity: 0`.

### Data flow

1. content.js finds `<a>` elements matching thumbnail selectors → extracts video ID from `href`
2. Sends `{type: "GET_STORYBOARD_FRAME", videoId, fraction}` to background.js
3. background.js fetches `youtube.com/watch?v=...`, parses `ytInitialPlayerResponse` JSON, extracts storyboard spec
4. Picks the highest-resolution layer, computes tile position for the requested fraction
5. Returns `{ok, frame: {url, w, h, cols, rows, col, row}}` — the sprite sheet URL and which tile to show
6. content.js sets `background-image`, `background-size`, and `background-position` on the overlay div

### YouTube DOM considerations

YouTube frequently changes their renderer markup. Thumbnail selectors must cover both legacy (`a#thumbnail`) and current (`a.yt-lockup-view-model__content-image`) structures. YouTube is a SPA, so the content script listens for `yt-navigate-finish` events and uses a MutationObserver to catch dynamically added thumbnails.
