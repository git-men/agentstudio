/**
 * E2E Helper: Mock Safety Check Server
 *
 * Starts an in-process mock HTTP server that simulates a content safety API.
 * Rules are configurable per test suite via constructor options.
 *
 * Default rules:
 *   Text  blocked  : 违规 / blocked / dangerous / 暴力 / 色情
 *   Text  sensitive: 敏感 / sensitive / secret  (allowed, filtered)
 *   Image blocked  : path/filename contains "nsfw"
 */

import { createServer } from 'http';

export const DEFAULT_BLOCKED_KEYWORDS  = ['违规', 'blocked', 'dangerous', '暴力', '色情'];
export const DEFAULT_SENSITIVE_KEYWORDS = ['敏感', 'sensitive', 'secret'];
export const DEFAULT_BLOCKED_IMG_PATTERNS = ['nsfw'];

export class MockSafetyServer {
  constructor({
    port = 9901,
    blockedKeywords  = DEFAULT_BLOCKED_KEYWORDS,
    sensitiveKeywords = DEFAULT_SENSITIVE_KEYWORDS,
    blockedImgPatterns = DEFAULT_BLOCKED_IMG_PATTERNS,
  } = {}) {
    this.port = port;
    this.blockedKeywords   = blockedKeywords;
    this.sensitiveKeywords = sensitiveKeywords;
    this.blockedImgPatterns = blockedImgPatterns;
    this.server = null;
    this.requests = []; // request log
    this.url = `http://localhost:${port}`;
    this.apiUrl = `${this.url}/api/safety-check`;
  }

  // ── Check logic ────────────────────────────────────────────────────────────

  _checkText(content) {
    const lower = (content || '').toLowerCase();
    for (const kw of this.blockedKeywords) {
      if (lower.includes(kw.toLowerCase())) {
        return { allowed: false, verdict: 1, message: `文本包含违规内容: "${kw}"`, filtered_texts: [content] };
      }
    }
    for (const kw of this.sensitiveKeywords) {
      if (lower.includes(kw.toLowerCase())) {
        const filtered = content.replace(new RegExp(kw, 'gi'), '***');
        return { allowed: true, verdict: 0, filtered_texts: [filtered] };
      }
    }
    return { allowed: true, verdict: 0, filtered_texts: [content] };
  }

  /**
   * Check image items against blocked patterns.
   *
   * The marketplace version of content-safety-check.js saves images to temp
   * files (UUID paths) and sends those paths in `item.content`.  It also
   * attaches `item.filenames` — the original filenames from the chat request —
   * so that filename-based policies can still be applied without reading the
   * temp files.  We check both arrays so this mock works for both the legacy
   * path-based hook and the marketplace hook.
   *
   * @param {string[]} paths     - temp file paths (content field)
   * @param {string[]} filenames - original filenames (filenames field, may be absent)
   */
  _checkImage(paths, filenames = []) {
    const candidates = [...paths, ...filenames];
    for (const p of candidates) {
      for (const pat of this.blockedImgPatterns) {
        if ((p || '').toLowerCase().includes(pat.toLowerCase())) {
          // Prefer the original filename in the error message if available
          const label = filenames.find(f => (f || '').toLowerCase().includes(pat.toLowerCase())) || p;
          return { allowed: false, verdict: 1, message: `图片内容违规: ${label}` };
        }
      }
    }
    return { allowed: true, verdict: 0 };
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  start() {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

        if (req.method === 'GET' && req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', requests: this.requests.length }));
          return;
        }

        if (req.method === 'DELETE' && req.url === '/requests') {
          this.requests = [];
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ cleared: true }));
          return;
        }

        if (req.method !== 'POST' || !req.url?.startsWith('/api/safety-check')) {
          res.writeHead(404); res.end(); return;
        }

        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          try {
            const { items } = JSON.parse(body);
            if (!Array.isArray(items)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'items must be an array' }));
              return;
            }

            const results = items.map(item => {
              if (item.type === 'txt') return this._checkText(item.content);
              if (item.type === 'img') {
                const paths     = Array.isArray(item.content)   ? item.content   : [item.content];
                const filenames = Array.isArray(item.filenames)  ? item.filenames : [];
                return this._checkImage(paths, filenames);
              }
              return { allowed: true, verdict: 0 };
            });

            this.requests.push({ ts: Date.now(), items, results });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ results }));
          } catch {
            res.writeHead(400); res.end(JSON.stringify({ error: 'invalid JSON' }));
          }
        });
      });

      this.server.listen(this.port, () => resolve(this));
      this.server.once('error', reject);
    });
  }

  stop() {
    return new Promise(resolve => {
      if (!this.server) { resolve(); return; }
      this.server.close(resolve);
      this.server = null;
    });
  }

  clearRequests() { this.requests = []; }
}
