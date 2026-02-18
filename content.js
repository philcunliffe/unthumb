const DEFAULT_SETTINGS = { fraction: 30, random: false, fallback: "original" };
let currentSettings = { ...DEFAULT_SETTINGS };
let settingsLoaded = false;

// YouTube home uses lots of dynamic DOM; we'll observe and patch as items appear.
let seen = new WeakSet();

function hashVideoId(videoId) {
  // FNV-1a 32-bit hash → deterministic float in [0.10, 0.90]
  let hash = 0x811c9dc5;
  for (let i = 0; i < videoId.length; i++) {
    hash ^= videoId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return 0.10 + ((hash >>> 0) / 0xFFFFFFFF) * 0.80;
}

function getEffectiveFraction(videoId) {
  if (currentSettings.random) return hashVideoId(videoId);
  return currentSettings.fraction / 100;
}

// Load settings before processing any thumbnails
chrome.storage.sync.get("settings", (result) => {
  if (result.settings) {
    currentSettings = { ...DEFAULT_SETTINGS, ...result.settings };
  }
  settingsLoaded = true;
  scanAnchors();
});

// Re-process thumbnails when settings change (e.g. user adjusts popup while on YouTube)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.settings) {
    currentSettings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
    seen = new WeakSet();
    scanAnchors();
  }
});

function getVideoIdFromAnchor(a) {
  try {
    const url = new URL(a.href, location.origin);
    return url.searchParams.get("v");
  } catch {
    return null;
  }
}

const THUMB_SELECTOR = [
  'a#thumbnail[href*="/watch?v="]',                          // legacy renderer
  'a.yt-lockup-view-model__content-image[href*="/watch?v="]' // new lockup renderer
].join(", ");

function findThumbnailAnchors(root = document) {
  return Array.from(root.querySelectorAll(THUMB_SELECTOR));
}

function ensureOverlay(thumbnailAnchor) {
  // Overlay should sit inside the anchor so it's clickable
  let overlay = thumbnailAnchor.querySelector(":scope > .hp-storyboard-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "hp-storyboard-overlay";
    thumbnailAnchor.appendChild(overlay);
  }
  return overlay;
}

function markHideOriginal(thumbnailAnchor) {
  const thumbRoot = thumbnailAnchor.closest("ytd-thumbnail") || thumbnailAnchor;
  thumbRoot.classList.add("hp-hide-thumb");
}

function unmarkHideOriginal(thumbnailAnchor) {
  const thumbRoot = thumbnailAnchor.closest("ytd-thumbnail") || thumbnailAnchor;
  thumbRoot.classList.remove("hp-hide-thumb");
}

function applyFrameToOverlay(overlay, frame) {
  // frame: { url, w, h, cols, rows, col, row }
  const sizeW = frame.cols * 100;
  const sizeH = frame.rows * 100;
  const posX = frame.cols === 1 ? 0 : (frame.col / (frame.cols - 1)) * 100;
  const posY = frame.rows === 1 ? 0 : (frame.row / (frame.rows - 1)) * 100;

  overlay.style.backgroundImage = `url("${frame.url}")`;
  overlay.style.backgroundSize = `${sizeW}% ${sizeH}%`;
  overlay.style.backgroundPosition = `${posX}% ${posY}%`;
  overlay.style.backgroundColor = "";
}

async function requestFrame(videoId) {
  return chrome.runtime.sendMessage({
    type: "GET_STORYBOARD_FRAME",
    videoId,
    fraction: getEffectiveFraction(videoId)
  });
}

function handleFailure(thumbnailAnchor, overlay) {
  if (currentSettings.fallback === "black") {
    if (overlay) {
      overlay.style.backgroundColor = "#000";
      overlay.style.backgroundImage = "none";
    }
  } else {
    if (overlay) {
      overlay.style.backgroundColor = "";
      overlay.style.backgroundImage = "";
    }
    unmarkHideOriginal(thumbnailAnchor);
  }
}

async function patchAnchor(thumbnailAnchor) {
  if (seen.has(thumbnailAnchor)) return;
  seen.add(thumbnailAnchor);

  const videoId = getVideoIdFromAnchor(thumbnailAnchor);
  if (!videoId) return;

  try {
    const overlay = ensureOverlay(thumbnailAnchor);
    // Hide original immediately to avoid flash
    markHideOriginal(thumbnailAnchor);

    const res = await requestFrame(videoId);
    if (!res || !res.ok) {
      handleFailure(thumbnailAnchor, overlay);
      return;
    }

    applyFrameToOverlay(overlay, res.frame);
  } catch {
    const overlay = thumbnailAnchor.querySelector(":scope > .hp-storyboard-overlay");
    handleFailure(thumbnailAnchor, overlay);
  }
}

function scanAnchors(root = document) {
  for (const a of findThumbnailAnchors(root)) {
    patchAnchor(a);
  }
}

// Watch for new items (infinite scroll)
const mo = new MutationObserver((mutations) => {
  if (!settingsLoaded) return;
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.(THUMB_SELECTOR)) {
        patchAnchor(node);
      }
      for (const a of findThumbnailAnchors(node)) patchAnchor(a);
    }
  }
});

mo.observe(document.documentElement, { childList: true, subtree: true });

// YouTube is a SPA — re-scan after client-side navigation
window.addEventListener("yt-navigate-finish", () => {
  if (settingsLoaded) scanAnchors();
});
