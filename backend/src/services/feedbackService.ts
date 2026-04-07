/**
 * Feedback Service
 *
 * Collects application logs and user feedback, uploads to COS.
 *
 * COS path structure:
 *   clawstudio-feedback/{YYYY-MM-DD}/{username}/{HHmmss}_{random}/
 *     report.html     – self-contained HTML report (description + images + logs)
 *     feedback.json   – structured metadata
 *     backend.log     – raw rolling backend log buffer
 *     image-0.png     – user-attached screenshot
 *     image-1.jpg     – ...
 *
 * Credentials: FEEDBACK_COS_SECRET_ID / FEEDBACK_COS_SECRET_KEY env vars.
 * If absent, feedback is saved to ~/.agentstudio/feedback/ locally.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { AGENTSTUDIO_HOME } from '../config/paths.js';
import { loadConfig } from '../config/index.js';
import cosDefaults from '../config/cos.json';

// ── COS Configuration ────────────────────────────────────────────────────────

const COS_BUCKET = 'static-76067';
const COS_REGION = 'ap-guangzhou';
const COS_ENDPOINT = 'sz.gfp.tencent-cloud.com';
const COS_PREFIX = 'clawstudio-feedback';

async function getCosCredentials(): Promise<{ secretId: string; secretKey: string } | null> {
  try {
    const config = await loadConfig();
    const secretId = config.feedbackCosSecretId || cosDefaults.feedbackCosSecretId;
    const secretKey = config.feedbackCosSecretKey || cosDefaults.feedbackCosSecretKey;
    if (secretId && secretKey) return { secretId, secretKey };
  } catch {
    // loadConfig may fail in compiled binary, fall back to bundled defaults
  }
  if (cosDefaults.feedbackCosSecretId && cosDefaults.feedbackCosSecretKey) {
    return { secretId: cosDefaults.feedbackCosSecretId, secretKey: cosDefaults.feedbackCosSecretKey };
  }
  return null;
}

// ── Rolling Log Buffer ───────────────────────────────────────────────────────

const MAX_LOG_LINES = 5000;
const logBuffer: string[] = [];

export function appendLog(level: string, message: string): void {
  const ts = new Date().toISOString();
  logBuffer.push(`[${ts}] [${level}] ${message}`);
  if (logBuffer.length > MAX_LOG_LINES) {
    logBuffer.splice(0, logBuffer.length - MAX_LOG_LINES);
  }
}

export function getLogSnapshot(): string {
  return logBuffer.join('\n');
}

/**
 * Hook into console so every log line is captured.
 * Call once at startup.
 */
export function installLogCapture(): void {
  const origLog = console.log;
  const origErr = console.error;
  const origWarn = console.warn;
  const origInfo = console.info;

  console.log = (...args: any[]) => {
    origLog.apply(console, args);
    appendLog('LOG', args.map(String).join(' '));
  };
  console.error = (...args: any[]) => {
    origErr.apply(console, args);
    appendLog('ERROR', args.map(String).join(' '));
  };
  console.warn = (...args: any[]) => {
    origWarn.apply(console, args);
    appendLog('WARN', args.map(String).join(' '));
  };
  console.info = (...args: any[]) => {
    origInfo.apply(console, args);
    appendLog('INFO', args.map(String).join(' '));
  };
}

// ── COS Signing (v5 XML API) ────────────────────────────────────────────────

function hmacSha1(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac('sha1', key).update(data).digest();
}

function sha1Hex(data: string | Buffer): string {
  return crypto.createHash('sha1').update(data).digest('hex');
}

function cosAuthorization(
  secretId: string,
  secretKey: string,
  method: string,
  cosKey: string,
  headers: Record<string, string>,
): string {
  const now = Math.floor(Date.now() / 1000);
  const keyTime = `${now - 60};${now + 3600}`;

  const signKey = hmacSha1(secretKey, keyTime).toString('hex');

  // COS v5 signing requires lowercase percent-encoding (e.g. %2f not %2F)
  const lowercaseEncode = (s: string) =>
    encodeURIComponent(s).replace(/%[0-9A-F]{2}/g, m => m.toLowerCase());

  const httpString = [
    method.toLowerCase(),
    '/' + cosKey,
    '', // query string
    Object.entries(headers)
      .map(([k, v]) => `${k.toLowerCase()}=${lowercaseEncode(v)}`)
      .sort()
      .join('&'),
    '',
  ].join('\n');

  const stringToSign = [
    'sha1',
    keyTime,
    sha1Hex(httpString),
    '',
  ].join('\n');

  const signature = hmacSha1(signKey, stringToSign).toString('hex');

  const headerList = Object.keys(headers).map(k => k.toLowerCase()).sort().join(';');
  return [
    `q-sign-algorithm=sha1`,
    `q-ak=${secretId}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    `q-header-list=${headerList}`,
    `q-url-param-list=`,
    `q-signature=${signature}`,
  ].join('&');
}

async function uploadToCos(
  cosKey: string,
  body: Buffer | string,
  contentType: string,
  creds: { secretId: string; secretKey: string },
): Promise<boolean> {
  const host = `${COS_BUCKET}.${COS_ENDPOINT}`;
  const url = `https://${host}/${cosKey}`;
  const bodyBuf = typeof body === 'string' ? Buffer.from(body, 'utf-8') : body;

  const headers: Record<string, string> = {
    Host: host,
    'Content-Type': contentType,
    'Content-Length': String(bodyBuf.length),
  };

  const auth = cosAuthorization(creds.secretId, creds.secretKey, 'PUT', cosKey, headers);

  try {
    const resp = await fetch(url, {
      method: 'PUT',
      headers: { ...headers, Authorization: auth },
      body: new Uint8Array(bodyBuf),
    });
    if (!resp.ok) {
      const text = await resp.text();
      console.error(`[Feedback] COS upload failed for ${cosKey}: ${resp.status} ${text}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[Feedback] COS upload error for ${cosKey}:`, err);
    return false;
  }
}

// ── Feedback Submission ──────────────────────────────────────────────────────

export interface FeedbackPayload {
  description: string;
  images: Array<{ data: string; filename: string; mimeType: string }>;
  frontendLogs: string;
  systemInfo: {
    appVersion: string;
    osVersion: string;
    username: string;
    platform: string;
    nodeVersion?: string;
    engineVersion?: string;
  };
}

export interface FeedbackResult {
  success: boolean;
  location: 'cos' | 'local';
  path: string;
  error?: string;
}

export async function submitFeedback(payload: FeedbackPayload): Promise<FeedbackResult> {
  const now = new Date();
  // Use China Standard Time (UTC+8) for folder naming
  const cn = new Date(now.getTime() + 8 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${cn.getUTCFullYear()}-${pad(cn.getUTCMonth() + 1)}-${pad(cn.getUTCDate())}`;
  const timeStr = `${pad(cn.getUTCHours())}-${pad(cn.getUTCMinutes())}-${pad(cn.getUTCSeconds())}`;
  const rand = crypto.randomBytes(3).toString('hex');
  const username = payload.systemInfo.username || 'anonymous';
  const folderName = `${dateStr}_${timeStr}_${rand}`;
  const relativePath = `${COS_PREFIX}/${dateStr}/${username}/${folderName}`;

  const backendLogs = getLogSnapshot();
  const frontendLogs = payload.frontendLogs || '';

  const manifest = {
    description: payload.description,
    systemInfo: payload.systemInfo,
    timestamp: now.toISOString(),
    imageCount: payload.images.length,
    images: payload.images.map((img, i) => `image-${i}-${img.filename}`),
  };

  const reportHtml = buildHtmlReport(manifest, backendLogs, frontendLogs, payload.images);
  const creds = await getCosCredentials();

  if (creds) {
    const cosResult = await uploadFeedbackToCos(relativePath, manifest, backendLogs, frontendLogs, payload.images, reportHtml, creds);
    if (cosResult.success) return cosResult;
  }

  return saveFeedbackLocally(relativePath, manifest, backendLogs, frontendLogs, payload.images, reportHtml);
}

async function uploadFeedbackToCos(
  prefix: string,
  manifest: any,
  backendLogs: string,
  frontendLogs: string,
  images: FeedbackPayload['images'],
  reportHtml: string,
  creds: { secretId: string; secretKey: string },
): Promise<FeedbackResult> {
  const results: boolean[] = [];

  results.push(await uploadToCos(
    `${prefix}/report.html`,
    reportHtml,
    'text/html; charset=utf-8',
    creds,
  ));

  results.push(await uploadToCos(
    `${prefix}/feedback.json`,
    JSON.stringify(manifest, null, 2),
    'application/json',
    creds,
  ));

  results.push(await uploadToCos(
    `${prefix}/backend.log`,
    backendLogs || '(no backend logs)',
    'text/plain',
    creds,
  ));

  results.push(await uploadToCos(
    `${prefix}/frontend.log`,
    frontendLogs || '(no frontend logs)',
    'text/plain',
    creds,
  ));

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const buf = Buffer.from(img.data, 'base64');
    results.push(await uploadToCos(
      `${prefix}/image-${i}-${img.filename}`,
      buf,
      img.mimeType,
      creds,
    ));
  }

  const allOk = results.every(Boolean);
  if (allOk) {
    return { success: true, location: 'cos', path: prefix };
  }

  console.warn('[Feedback] Some COS uploads failed, saving locally as backup');
  return saveFeedbackLocally(prefix, manifest, backendLogs, frontendLogs, images, reportHtml);
}

function saveFeedbackLocally(
  prefix: string,
  manifest: any,
  backendLogs: string,
  frontendLogs: string,
  images: FeedbackPayload['images'],
  reportHtml: string,
): FeedbackResult {
  const localDir = path.join(AGENTSTUDIO_HOME, 'feedback', prefix.replace(COS_PREFIX + '/', ''));
  try {
    fs.mkdirSync(localDir, { recursive: true });

    fs.writeFileSync(path.join(localDir, 'report.html'), reportHtml, 'utf-8');
    fs.writeFileSync(path.join(localDir, 'feedback.json'), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(localDir, 'backend.log'), backendLogs || '(no backend logs)');
    fs.writeFileSync(path.join(localDir, 'frontend.log'), frontendLogs || '(no frontend logs)');

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const buf = Buffer.from(img.data, 'base64');
      fs.writeFileSync(path.join(localDir, `image-${i}-${img.filename}`), buf);
    }

    return { success: true, location: 'local', path: localDir };
  } catch (err) {
    return {
      success: false,
      location: 'local',
      path: localDir,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── HTML Report Generator ────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build a self-contained HTML report that embeds images as base64 data-URIs
 * and renders both frontend and backend logs with syntax highlighting,
 * search, and filter capabilities.
 */
function buildHtmlReport(
  manifest: any,
  backendLogs: string,
  frontendLogs: string,
  images: FeedbackPayload['images'],
): string {
  const { description, systemInfo, timestamp } = manifest;

  const imageBlocks = images.length
    ? images.map((img, i) =>
        `<div class="img-card">
           <img src="data:${img.mimeType};base64,${img.data}" alt="screenshot-${i}" />
           <span class="img-label">${escapeHtml(img.filename)}</span>
         </div>`,
      ).join('\n')
    : '<p class="muted">用户未附加截图</p>';

  function renderLogSection(id: string, raw: string) {
    const lines = (raw || '').split('\n');
    const total = lines.length;
    const errors = lines.filter(l => /\[ERROR\]|\[UNCAUGHT\]|\[UNHANDLED/i.test(l)).length;
    const warns = lines.filter(l => /\[WARN\]/i.test(l)).length;

    const html = lines.map((line, idx) => {
      const cls = /\[ERROR\]|\[UNCAUGHT\]|\[UNHANDLED/i.test(line) ? 'log-error'
        : /\[WARN\]/i.test(line) ? 'log-warn' : '';
      const num = String(idx + 1).padStart(5, ' ');
      return `<span class="line ${cls}"><span class="ln">${num}</span>${escapeHtml(line)}</span>`;
    }).join('\n');

    return { html, total, errors, warns };
  }

  const be = renderLogSection('be', backendLogs);
  const fe = renderLogSection('fe', frontendLogs);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>反馈报告 – ${escapeHtml(systemInfo.username || 'user')} – ${timestamp}</title>
<style>
  :root { --bg:#f8f9fa; --card:#fff; --border:#e2e8f0; --text:#1a202c; --muted:#718096; --blue:#3182ce; --red:#e53e3e; --orange:#dd6b20; --green:#38a169; --purple:#805ad5; }
  @media(prefers-color-scheme:dark){
    :root { --bg:#1a202c; --card:#2d3748; --border:#4a5568; --text:#e2e8f0; --muted:#a0aec0; }
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.6;padding:24px;max-width:1000px;margin:0 auto}
  h1{font-size:22px;margin-bottom:4px}
  .subtitle{color:var(--muted);font-size:13px;margin-bottom:24px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:20px;margin-bottom:20px}
  .card h2{font-size:15px;font-weight:600;margin-bottom:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .badge{display:inline-block;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600}
  .badge-red{background:#fed7d7;color:var(--red)} .badge-orange{background:#fefcbf;color:var(--orange)}
  .badge-green{background:#c6f6d5;color:var(--green)} .badge-blue{background:#bee3f8;color:var(--blue)}
  .badge-purple{background:#e9d8fd;color:var(--purple)}
  .description{white-space:pre-wrap;font-size:14px}
  .sys-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
  .sys-item{background:var(--bg);border-radius:8px;padding:10px 14px}
  .sys-item .label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
  .sys-item .value{font-size:14px;font-weight:500;margin-top:2px;word-break:break-all}
  .img-grid{display:flex;flex-wrap:wrap;gap:12px}
  .img-card{border:1px solid var(--border);border-radius:8px;overflow:hidden;max-width:280px}
  .img-card img{display:block;width:100%;height:auto;cursor:pointer}
  .img-card img.zoomed{position:fixed;top:0;left:0;width:100vw;height:100vh;object-fit:contain;background:rgba(0,0,0,.85);z-index:999;border-radius:0;max-width:none}
  .img-label{display:block;padding:6px 10px;font-size:11px;color:var(--muted)}
  .muted{color:var(--muted);font-size:13px}

  /* Tabs */
  .tabs{display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:14px}
  .tab{padding:8px 18px;font-size:13px;font-weight:500;cursor:pointer;border:none;background:none;color:var(--muted);border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .15s}
  .tab:hover{color:var(--text)}
  .tab.active{color:var(--blue);border-bottom-color:var(--blue)}
  .tab-panel{display:none}
  .tab-panel.active{display:block}

  /* Log viewer */
  .log-toolbar{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap}
  .log-toolbar input{flex:1;min-width:180px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg);color:var(--text)}
  .filter-btns button{padding:3px 10px;border:1px solid var(--border);border-radius:6px;font-size:11px;cursor:pointer;background:var(--card);color:var(--text)}
  .filter-btns button.active{background:var(--blue);color:#fff;border-color:var(--blue)}
  .log-wrap{background:#1e1e2e;color:#cdd6f4;border-radius:8px;padding:14px;overflow-x:auto;max-height:600px;overflow-y:auto;font-family:"Cascadia Code","Fira Code","JetBrains Mono",monospace;font-size:12px;line-height:1.7}
  .log-wrap .line{display:block}
  .log-wrap .ln{display:inline-block;width:50px;text-align:right;margin-right:12px;color:#585b70;user-select:none}
  .log-wrap .log-error{color:#f38ba8}
  .log-wrap .log-warn{color:#fab387}
  .log-wrap .line.hidden{display:none}
</style>
</head>
<body>

<h1>📋 用户反馈报告</h1>
<p class="subtitle">${escapeHtml(timestamp)} · ${escapeHtml(systemInfo.username || 'anonymous')}</p>

<!-- Description -->
<div class="card">
  <h2>💬 反馈内容</h2>
  <div class="description">${escapeHtml(description)}</div>
</div>

<!-- System Info -->
<div class="card">
  <h2>ℹ️ 系统信息</h2>
  <div class="sys-grid">
    <div class="sys-item"><div class="label">App 版本</div><div class="value">${escapeHtml(systemInfo.appVersion)}</div></div>
    <div class="sys-item"><div class="label">操作系统</div><div class="value">${escapeHtml(systemInfo.osVersion)}</div></div>
    <div class="sys-item"><div class="label">平台</div><div class="value">${escapeHtml(systemInfo.platform)}</div></div>
    <div class="sys-item"><div class="label">用户</div><div class="value">${escapeHtml(systemInfo.username || 'anonymous')}</div></div>
    <div class="sys-item"><div class="label">Node 版本</div><div class="value">${escapeHtml(systemInfo.nodeVersion || 'N/A')}</div></div>
    <div class="sys-item"><div class="label">Engine 版本</div><div class="value">${escapeHtml(systemInfo.engineVersion || 'N/A')}</div></div>
  </div>
</div>

<!-- Screenshots -->
<div class="card">
  <h2>🖼️ 截图 <span class="badge badge-blue">${images.length} 张</span></h2>
  <div class="img-grid">${imageBlocks}</div>
</div>

<!-- Logs (tabbed: Backend / Frontend) -->
<div class="card">
  <h2>📄 应用日志</h2>
  <div class="tabs" id="logTabs">
    <button class="tab active" data-tab="backend">
      🖥️ 后端日志
      <span class="badge badge-green">${be.total}</span>
      ${be.errors ? `<span class="badge badge-red">${be.errors} ERR</span>` : ''}
      ${be.warns ? `<span class="badge badge-orange">${be.warns} WARN</span>` : ''}
    </button>
    <button class="tab" data-tab="frontend">
      🌐 前端日志
      <span class="badge badge-purple">${fe.total}</span>
      ${fe.errors ? `<span class="badge badge-red">${fe.errors} ERR</span>` : ''}
      ${fe.warns ? `<span class="badge badge-orange">${fe.warns} WARN</span>` : ''}
    </button>
  </div>

  <!-- Backend tab -->
  <div class="tab-panel active" id="panel-backend">
    <div class="log-toolbar">
      <input class="log-search" data-target="log-backend" type="text" placeholder="搜索后端日志…（支持正则）" />
      <div class="filter-btns" data-target="log-backend">
        <button data-level="all" class="active">全部</button>
        <button data-level="error">ERROR</button>
        <button data-level="warn">WARN</button>
      </div>
    </div>
    <div class="log-wrap" id="log-backend">${be.html}</div>
  </div>

  <!-- Frontend tab -->
  <div class="tab-panel" id="panel-frontend">
    <div class="log-toolbar">
      <input class="log-search" data-target="log-frontend" type="text" placeholder="搜索前端日志…（支持正则）" />
      <div class="filter-btns" data-target="log-frontend">
        <button data-level="all" class="active">全部</button>
        <button data-level="error">ERROR</button>
        <button data-level="warn">WARN</button>
      </div>
    </div>
    <div class="log-wrap" id="log-frontend">${fe.html}</div>
  </div>
</div>

<script>
// Image zoom
document.querySelectorAll('.img-card img').forEach(img => {
  img.addEventListener('click', () => img.classList.toggle('zoomed'));
});

// Tabs
document.querySelectorAll('#logTabs .tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('#logTabs .tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
  });
});

// Log search + filter (works for both tabs independently)
document.querySelectorAll('.log-search').forEach(input => {
  const containerId = input.dataset.target;
  const container = document.getElementById(containerId);
  const btns = document.querySelectorAll('.filter-btns[data-target="' + containerId + '"] button');
  let level = 'all';

  function apply() {
    const term = input.value.trim();
    let re = null;
    try { if (term) re = new RegExp(term, 'i'); } catch {}
    container.querySelectorAll('.line').forEach(el => {
      const text = el.textContent || '';
      const matchSearch = !re || re.test(text);
      const matchLevel = level === 'all'
        || (level === 'error' && el.classList.contains('log-error'))
        || (level === 'warn' && el.classList.contains('log-warn'));
      el.classList.toggle('hidden', !(matchSearch && matchLevel));
    });
  }
  input.addEventListener('input', apply);
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      level = btn.dataset.level;
      apply();
    });
  });
});
</script>
</body>
</html>`;
}
