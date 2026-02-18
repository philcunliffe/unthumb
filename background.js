const CACHE = new Map(); // videoId -> { ts, value }
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_CONCURRENT = 6;

let inflight = 0;
const queue = [];

function withConcurrency(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    pump();
  });
}

function pump() {
  while (inflight < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    inflight++;
    job.fn()
      .then(job.resolve, job.reject)
      .finally(() => {
        inflight--;
        pump();
      });
  }
}

function cacheGet(videoId) {
  const hit = CACHE.get(videoId);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    CACHE.delete(videoId);
    return null;
  }
  return hit.value;
}

function cacheSet(videoId, value) {
  CACHE.set(videoId, { ts: Date.now(), value });
}

function pickBestLayer(layers) {
  // layers: [{w,h,count,cols,rows,sig, ...}, ...]
  // Choose the one with the largest tile area.
  return layers
    .slice()
    .sort((a, b) => (b.w * b.h) - (a.w * a.h))[0];
}

/**
 * Extract a JS object assigned to `varName` using brace balancing.
 * Handles strings and escapes so we don’t get fooled by "}" inside strings.
 */
function extractAssignedObject(text, varName) {
  const idx = text.indexOf(varName);
  if (idx === -1) return null;

  // Find first '{' after the variable name
  const braceStart = text.indexOf("{", idx);
  if (braceStart === -1) return null;

  let i = braceStart;
  let depth = 0;
  let inStr = false;
  let strChar = "";
  let escape = false;

  for (; i < text.length; i++) {
    const c = text[i];

    if (inStr) {
      if (escape) {
        escape = false;
      } else if (c === "\\") {
        escape = true;
      } else if (c === strChar) {
        inStr = false;
        strChar = "";
      }
      continue;
    }

    if (c === '"' || c === "'") {
      inStr = true;
      strChar = c;
      continue;
    }

    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        const jsonLike = text.slice(braceStart, i + 1);
        return jsonLike;
      }
    }
  }

  return null;
}

function parseStoryboardSpec(spec) {
  // Spec format example: baseUrl | layer1 | layer2 | layer3 ...
  // layer format: w#h#count#cols#rows#...#...#sig
  // Common technique shown in storyboard snippets/parsers. :contentReference[oaicite:2]{index=2}
  const parts = spec.split("|");
  const urlTemplate = parts[0];

  const layers = [];
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    const fields = seg.split("#");
    if (fields.length < 8) continue;

    const w = Number(fields[0]);
    const h = Number(fields[1]);
    const count = Number(fields[2]);
    const cols = Number(fields[3]);
    const rows = Number(fields[4]);
    const sig = fields[7];

    if (![w, h, count, cols, rows].every(Number.isFinite)) continue;

    layers.push({ w, h, count, cols, rows, sig, layerIndex: i - 1 });
  }

  if (!layers.length) return null;
  return { urlTemplate, layers };
}

function makeStoryboardImageUrl(urlTemplate, layerSig, boardIndex, qualityLevel = "2") {
  // Typical pattern:
  // - replace $L with a quality level like '2'
  // - replace $N with 'M{boardIndex}'
  // - append &sigh=... (often required)
  // This is the same general construction used in common storyboard code snippets. :contentReference[oaicite:3]{index=3}
  const base = urlTemplate
    .replace("$L", String(qualityLevel))
    .replace("$N", "M" + boardIndex);

  const joiner = base.includes("?") ? "&" : "?";
  return base + joiner + "sigh=" + encodeURIComponent(layerSig);
}

function computeFrameAtFraction(lengthSeconds, layer, fraction) {
  const L = Math.max(1, Number(lengthSeconds) || 1);
  const count = Math.max(1, layer.count);

  const targetTime = Math.max(0, Math.min(L, L * fraction));
  const tileIndex = Math.min(count - 1, Math.floor((targetTime * count) / L));

  const perBoard = layer.cols * layer.rows;
  const boardIndex = Math.floor(tileIndex / perBoard);
  const indexInBoard = tileIndex % perBoard;

  const col = indexInBoard % layer.cols;
  const row = Math.floor(indexInBoard / layer.cols);

  return { tileIndex, boardIndex, col, row };
}

async function fetchPlayerResponse(videoId) {
  // Fetch watch page HTML and extract ytInitialPlayerResponse
  const url = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const res = await fetch(url, {
    method: "GET",
    credentials: "omit",
    cache: "no-store"
  });
  if (!res.ok) throw new Error(`watch fetch failed: ${res.status}`);
  const html = await res.text();

  // Usually present as: var ytInitialPlayerResponse = {...};
  // We find the object via brace balancing.
  const objText = extractAssignedObject(html, "ytInitialPlayerResponse");
  if (!objText) throw new Error("ytInitialPlayerResponse not found");

  // It is valid JSON in most cases (double quotes). If it ever isn’t, this will fail.
  return JSON.parse(objText);
}

async function getStoryboardData(videoId) {
  const cached = cacheGet(videoId);
  if (cached) return cached;

  const pr = await fetchPlayerResponse(videoId);

  const spec = pr?.storyboards?.playerStoryboardSpecRenderer?.spec;
  const lengthSeconds = pr?.videoDetails?.lengthSeconds;

  if (!spec || !lengthSeconds) {
    const out = { ok: false, reason: "no_storyboard_or_length" };
    cacheSet(videoId, out);
    return out;
  }

  const parsed = parseStoryboardSpec(spec);
  if (!parsed) {
    const out = { ok: false, reason: "spec_parse_failed" };
    cacheSet(videoId, out);
    return out;
  }

  const layer = pickBestLayer(parsed.layers);
  const out = { ok: true, layer, urlTemplate: parsed.urlTemplate, lengthSeconds: Number(lengthSeconds) };
  cacheSet(videoId, out);
  return out;
}

async function getFrameForVideo(videoId, fraction) {
  const data = await getStoryboardData(videoId);
  if (!data.ok) return data;

  const pos = computeFrameAtFraction(data.lengthSeconds, data.layer, fraction);
  const spriteUrl = makeStoryboardImageUrl(data.urlTemplate, data.layer.sig, pos.boardIndex, String(data.layer.layerIndex));

  return {
    ok: true,
    frame: {
      url: spriteUrl,
      w: data.layer.w,
      h: data.layer.h,
      cols: data.layer.cols,
      rows: data.layer.rows,
      col: pos.col,
      row: pos.row
    }
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "GET_STORYBOARD_FRAME") return;

  const videoId = String(msg.videoId || "");
  const fraction = Number(msg.fraction);

  // Must return true to keep sendResponse alive for async.
  withConcurrency(() => getFrameForVideo(videoId, fraction))
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, reason: String(err?.message || err) }));

  return true;
});

