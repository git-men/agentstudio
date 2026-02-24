/**
 * Content Safety Interceptor  [E2E Test Fixture Copy]
 *
 * This file is a verbatim copy of:
 *   verticals/vag/marketplace/plugins/content-safety/hooks/scripts/content-safety-check.js
 *
 * Keep in sync when the canonical version is updated.
 * The fixture exists so E2E tests are fully self-contained and do not depend
 * on the VAG marketplace directory structure.
 *
 * Platform Hook script for message.pre_send event.
 * Called by ScriptExecutor in interceptor mode — must export a default
 * async function that receives HookContext and returns a HookDecision.
 *
 * Behaviour:
 *   1. Split message text into chunks (one item per non-empty paragraph).
 *   2. If images are present, save each base64 image as a temp file.
 *   3. POST all items in a single batch request to the safety API.
 *   4. If ANY item has allowed=false, block the message.
 *   5. Clean up temp image files after the API call.
 *   6. Fail-open: any network/API error results in `allow`.
 *
 * Safety API contract:
 *   POST { items: Array<TxtItem | ImgItem> }
 *   TxtItem: { type: "txt", content: string }
 *   ImgItem: { type: "img", content: string[] }   ← array of file paths
 *
 *   Response: { results: Array<{ allowed: boolean, verdict: number, message?: string }> }
 *
 * Environment variables:
 *   CONTENT_SAFETY_API_URL   — Safety check endpoint, e.g. http://localhost:3000/api/safety-check
 *   CONTENT_SAFETY_API_KEY   — Bearer token (optional)
 *   CONTENT_SAFETY_TIMEOUT   — Request timeout in ms (default: 8000)
 *   CONTENT_SAFETY_IMG_DIR   — Temp directory for image files
 *                              (default: OS temp / content-safety-images)
 */

import { writeFileSync, mkdirSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

const API_URL = process.env.CONTENT_SAFETY_API_URL;
const API_KEY = process.env.CONTENT_SAFETY_API_KEY;
const TIMEOUT = parseInt(process.env.CONTENT_SAFETY_TIMEOUT || '8000', 10);
const IMG_DIR = process.env.CONTENT_SAFETY_IMG_DIR || join(tmpdir(), 'content-safety-images');

const MEDIA_TYPE_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

function saveImageTemp(base64Data, mediaType) {
  mkdirSync(IMG_DIR, { recursive: true });
  const ext = MEDIA_TYPE_EXT[mediaType] || '.bin';
  const filePath = join(IMG_DIR, `${randomUUID()}${ext}`);
  writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
  return filePath;
}

function cleanupTempFiles(paths) {
  for (const p of paths) {
    try {
      if (existsSync(p)) unlinkSync(p);
    } catch {
      // Ignore cleanup failures
    }
  }
}

export default async function contentSafetyCheck(context) {
  const message = context.data?.message ?? '';
  const rawImages = Array.isArray(context.data?.images) ? context.data.images : [];

  const hasText = typeof message === 'string' && message.trim().length > 0;
  const hasImages = rawImages.length > 0;

  if (!hasText && !hasImages) {
    return { decision: 'allow', reason: 'No content to check' };
  }

  if (!API_URL) {
    console.warn('[content-safety] CONTENT_SAFETY_API_URL not configured, allowing message');
    return { decision: 'allow', reason: 'Safety API not configured' };
  }

  // ── Build request items ────────────────────────────────────────────────────

  const items = [];

  // Split text into paragraphs — one txt item per paragraph so the API can
  // return per-paragraph verdicts (empty paragraphs are skipped).
  if (hasText) {
    const paragraphs = message.split('\n').map(p => p.trim()).filter(Boolean);
    for (const para of paragraphs) {
      items.push({ type: 'txt', content: para });
    }
  }

  // Save images to temp files and add a single img item with all paths.
  // Note: the chat API sends images with { data, mediaType, filename? } (ImageSchema).
  // Older/legacy formats may use { base64, mediaType }.
  const savedPaths = [];
  const savedFilenames = [];
  if (hasImages) {
    for (const img of rawImages) {
      // Support both legacy `base64` field and current `data` field from ImageSchema
      const base64Data = img.data || img.base64;
      const mediaType  = img.mediaType;
      if (base64Data && mediaType) {
        try {
          const p = saveImageTemp(base64Data, mediaType);
          savedPaths.push(p);
          // Preserve original filename for downstream testability (e.g. mock servers
          // that use filename patterns to simulate blocking rules)
          savedFilenames.push(img.filename || img.filePath || p);
          console.log(`[content-safety] Saved temp image: ${p} (${img.filename ?? 'no filename'})`);
        } catch (err) {
          console.warn(`[content-safety] Failed to save image: ${err.message}`);
        }
      }
    }
    if (savedPaths.length > 0) {
      // API expects a single img item whose content is an array of file paths.
      // `filenames` carries the original names so safety APIs / mocks can apply
      // filename-based policies without re-reading the temp files.
      items.push({ type: 'img', content: savedPaths, filenames: savedFilenames });
    }
  }

  if (items.length === 0) {
    return { decision: 'allow', reason: 'No checkable items after processing' };
  }

  // ── Call safety API ────────────────────────────────────────────────────────

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
      body: JSON.stringify({ items }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      console.warn(`[content-safety] API returned ${response.status}, allowing message`);
      return { decision: 'allow', reason: `Safety API error: HTTP ${response.status}` };
    }

    const { results } = await response.json();

    if (!Array.isArray(results)) {
      console.warn('[content-safety] Unexpected API response shape, allowing message');
      return { decision: 'allow', reason: 'Unexpected API response' };
    }

    // Block if ANY item is not allowed
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.allowed === false) {
        const itemType = items[i]?.type ?? 'unknown';
        const reason = result.message || `Content violation (verdict ${result.verdict})`;
        console.warn(`[content-safety] Blocked — item[${i}] type=${itemType}: ${reason}`);
        return {
          decision: 'block',
          reason: `[${itemType}] ${reason}`,
        };
      }
    }

    return { decision: 'allow' };

  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn('[content-safety] Request timed out, allowing message');
      return { decision: 'allow', reason: 'Safety check timed out' };
    }
    console.warn(`[content-safety] Request failed: ${err.message}`);
    return { decision: 'allow', reason: `Safety check error: ${err.message}` };

  } finally {
    if (savedPaths.length > 0) {
      cleanupTempFiles(savedPaths);
      console.log(`[content-safety] Cleaned up ${savedPaths.length} temp image(s)`);
    }
  }
}
