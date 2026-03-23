#!/usr/bin/env node

/**
 * Content Manager Data Service
 *
 * Manages content entries in daily JSONL files.
 * Usage:
 *   echo '{"date":"2026-03-18"}' | node content-service.cjs list
 *   echo '{"entries":[...]}' | node content-service.cjs add
 *   echo '{"id":"...","updates":{}}' | node content-service.cjs update
 *   echo '{"id":"..."}' | node content-service.cjs delete
 *   echo '{"cidOrder":["cid1","cid2"]}' | node content-service.cjs reorder
 *   echo '{"text":"..."}' | node content-service.cjs parse
 *   echo '{"date":"...","format":"text"}' | node content-service.cjs export
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Data directory resolution
// ---------------------------------------------------------------------------

function getDataDir() {
  const projectPath = process.env.LAVS_PROJECT_PATH;
  if (projectPath) {
    return path.join(projectPath, '.content-manager');
  }
  return path.join(__dirname, '..', 'data');
}

const DATA_DIR = getDataDir();
console.error(`[ContentService] DATA_DIR: ${DATA_DIR}`);

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dataFile(date) {
  return path.join(DATA_DIR, `${date}.jsonl`);
}

// ---------------------------------------------------------------------------
// JSONL helpers
// ---------------------------------------------------------------------------

function readEntries(date) {
  const file = dataFile(date);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(l => l.trim());
  const entries = [];
  for (const line of lines) {
    try { entries.push(JSON.parse(line)); } catch (_) { /* skip bad lines */ }
  }
  return entries;
}

function writeEntries(date, entries) {
  const file = dataFile(date);
  const content = entries.map(e => JSON.stringify(e)).join('\n');
  fs.writeFileSync(file, content ? content + '\n' : '', 'utf-8');
}

// ---------------------------------------------------------------------------
// Image key normalization
// ---------------------------------------------------------------------------

const IMG_KEY_MAP = [
  { key: '1920', patterns: ['1920'] },
  { key: '1280_pure', patterns: ['1280纯净', '1280净图', '1280净版', '1280净', '拼图净', '1280_pure', 'pure'] },
  { key: '1280_mark', patterns: ['1280独播', '1280首播', '拼图独播', '1280_mark', 'mark'] },
  { key: 'ott', patterns: ['ott', 'ott1704', 'OTT'] },
  { key: 'gif', patterns: ['gif', 'GIF', '动图', 'Gif'] },
];

function normalizeImageKeys(images) {
  if (!images || typeof images !== 'object') return {};
  const result = {};
  for (const [rawKey, url] of Object.entries(images)) {
    const lower = rawKey.toLowerCase().trim();
    let matched = false;
    for (const { key, patterns } of IMG_KEY_MAP) {
      if (patterns.some(p => p.toLowerCase() === lower || lower.includes(p.toLowerCase()))) {
        if (!result[key]) result[key] = url;
        matched = true;
        break;
      }
    }
    if (!matched && !result[rawKey]) {
      result[rawKey] = url;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function actionList(input) {
  const date = input.date || todayStr();
  const entries = readEntries(date);
  return { date, entries, total: entries.length };
}

function actionAdd(input) {
  const date = input.date || todayStr();
  const existing = readEntries(date);

  const cidSet = new Set(existing.map(e => e.cid));
  let maxCidOrder = existing.reduce((m, e) => Math.max(m, e.cidOrder || 0), -1);

  const added = [];
  for (const entry of (input.entries || [])) {
    if (!cidSet.has(entry.cid)) {
      maxCidOrder++;
      cidSet.add(entry.cid);
    }

    const cidOrder = existing
      .filter(e => e.cid === entry.cid)
      .concat(added.filter(e => e.cid === entry.cid))
      .reduce((m, e) => Math.max(m, e.cidOrder || 0), maxCidOrder);

    const orderInCid = existing
      .filter(e => e.cid === entry.cid)
      .concat(added.filter(e => e.cid === entry.cid))
      .length;

    const newEntry = {
      id: crypto.randomUUID(),
      cid: entry.cid || '',
      showName: entry.showName || '',
      title: entry.title || '',
      section: entry.section || entry.category || '',
      updateTime: entry.updateTime || '',
      shortHighlight: entry.shortHighlight || entry.shortTitle || entry.short_highlight || '',
      longHighlight: entry.longHighlight || entry.longTitle || entry.long_highlight || '',
      pcAutoPlay: entry.pcAutoPlay || entry.pcAutoplay || entry.autoPlay || '',
      images: normalizeImageKeys(entry.images || {}),
      peoplePackage: entry.peoplePackage || '',
      contentCheck: null,
      order: orderInCid,
      cidOrder: cidOrder,
      createdAt: new Date().toISOString(),
    };

    // Preserve any extra fields for extensibility
    for (const key of Object.keys(entry)) {
      if (!(key in newEntry)) {
        newEntry[key] = entry[key];
      }
    }

    added.push(newEntry);
  }

  writeEntries(date, [...existing, ...added]);
  return { added: added.length, entries: added };
}

const UPDATE_FIELD_ALIASES = {
  shortTitle: 'shortHighlight',
  short_highlight: 'shortHighlight',
  longTitle: 'longHighlight',
  long_highlight: 'longHighlight',
  pcAutoplay: 'pcAutoPlay',
  autoPlay: 'pcAutoPlay',
  category: 'section',
};

function actionUpdate(input) {
  const date = input.date || todayStr();
  const entries = readEntries(date);
  const idx = entries.findIndex(e => e.id === input.id);
  if (idx === -1) throw new Error(`Entry not found: ${input.id}`);

  const updates = input.updates || {};
  console.error(`[Update] id=${input.id} date=${date} updateKeys=${Object.keys(updates).join(',')}`);

  if (updates.contentCheck) {
    const cc = updates.contentCheck;
    const sp = cc.shortHighlight?.passed;
    const lp = cc.longHighlight?.passed;
    const issues = [...(cc.shortHighlight?.issues||[]), ...(cc.longHighlight?.issues||[])];
    console.error(`[Update] contentCheck: short.passed=${sp} long.passed=${lp} issues=${issues.length}`);
    if (issues.length > 0) {
      console.error(`[Update] issues: ${JSON.stringify(issues)}`);
    }
  }

  for (const [k, v] of Object.entries(updates)) {
    if (k === 'id') continue;
    const canonicalKey = UPDATE_FIELD_ALIASES[k] || k;
    entries[idx][canonicalKey] = v;
  }

  writeEntries(date, entries);

  const saved = readEntries(date).find(e => e.id === input.id);
  if (saved?.contentCheck) {
    console.error(`[Update] VERIFY saved: short.passed=${saved.contentCheck.shortHighlight?.passed} long.passed=${saved.contentCheck.longHighlight?.passed}`);
  }

  return entries[idx];
}

function actionDelete(input) {
  const date = input.date || todayStr();
  const entries = readEntries(date);
  const idx = entries.findIndex(e => e.id === input.id);
  if (idx === -1) throw new Error(`Entry not found: ${input.id}`);

  entries.splice(idx, 1);
  writeEntries(date, entries);
  return { success: true };
}

function actionReorder(input) {
  const date = input.date || todayStr();
  const entries = readEntries(date);
  const cidOrder = input.cidOrder || [];

  for (let i = 0; i < cidOrder.length; i++) {
    for (const entry of entries) {
      if (entry.cid === cidOrder[i]) {
        entry.cidOrder = i;
      }
    }
  }

  writeEntries(date, entries);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Text parser
// ---------------------------------------------------------------------------

const KNOWN_TEXT_FIELDS = new Set([
  '短看点', '长看点', 'cid', 'pc自动播', 'pc自动播放',
]);

function actionParse(input) {
  const text = input.text || '';
  const entries = [];
  const parseErrors = [];

  // Split by update time sections (————…更新————…)
  const sections = text.split(/————+/);

  let currentUpdateTime = '';

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;

    // Check if this section is an update time header
    const timeMatch = trimmed.match(/^(\d+点更新)$/m);
    if (timeMatch && trimmed === timeMatch[0]) {
      currentUpdateTime = timeMatch[1];
      continue;
    }

    // Extract update time if embedded at start
    const embeddedTime = trimmed.match(/^(\d+点更新)\s*\n/);
    let sectionBody = trimmed;
    if (embeddedTime) {
      currentUpdateTime = embeddedTime[1];
      sectionBody = trimmed.substring(embeddedTime[0].length);
    }

    // Parse entries from this section
    parseSection(sectionBody, currentUpdateTime, entries, parseErrors);
  }

  return { entries, parseErrors };
}

function parseSection(text, updateTime, entries, parseErrors) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  if (lines.length === 0) return;

  // Detect show-level header: "ShowName·更新" pattern
  let currentShowName = '';
  let currentCid = '';
  let currentSection = ''; // 【点映集】、【会员集】 etc.
  let currentEntry = null;

  function flushEntry() {
    if (currentEntry && currentEntry.cid) {
      entries.push(currentEntry);
    }
    currentEntry = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Section tag: 【点映集】、【会员集】
    const sectionMatch = line.match(/^【(.+?)】$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      continue;
    }

    // Show-level header: "ShowName·更新" (sets showName context, resets section)
    if (line.match(/[·]更新\s*$/)) {
      flushEntry();
      currentShowName = line.replace(/[·]更新\s*$/, '');
      currentSection = '';
      continue;
    }

    // CID line
    const cidMatch = line.match(/^cid[：:]\s*(.+)$/i);
    if (cidMatch) {
      if (currentEntry && !currentEntry.cid) {
        currentEntry.cid = cidMatch[1].trim();
      } else if (currentEntry && currentEntry.cid) {
        // Same CID repeated or new CID for next entry — keep current
        currentCid = cidMatch[1].trim();
      } else {
        currentCid = cidMatch[1].trim();
      }
      continue;
    }

    // Short highlight
    const shortMatch = line.match(/^短看点[：:]\s*(.+)$/);
    if (shortMatch) {
      if (currentEntry) {
        currentEntry.shortHighlight = shortMatch[1].trim();
      }
      continue;
    }

    // Long highlight
    const longMatch = line.match(/^长看点[：:]\s*(.+)$/);
    if (longMatch) {
      if (currentEntry) {
        currentEntry.longHighlight = longMatch[1].trim();
      }
      continue;
    }

    // PC auto play
    const pcMatch = line.match(/^pc自动播[放]?[：:]\s*(.+)$/i);
    if (pcMatch) {
      if (currentEntry) {
        currentEntry.pcAutoPlay = pcMatch[1].trim();
      }
      continue;
    }

    // Image link: "ImageType：URL" or "ImageType: URL"
    const imgMatch = line.match(/^(.+?)[：:]\s*(https?:\/\/.+)$/);
    if (imgMatch) {
      const imgType = imgMatch[1].trim();
      const imgUrl = imgMatch[2].trim();
      if (currentEntry && !KNOWN_TEXT_FIELDS.has(imgType)) {
        currentEntry.images[imgType] = imgUrl;
      }
      continue;
    }

    // Entry title line: "ShowName·EntryTitle" or just "EntryTitle" (with context)
    // This is a title line if it contains a · separator or comes after a showName header
    const titleMatch = line.match(/^(.+?)[·](.+)$/);
    if (titleMatch) {
      flushEntry();
      const showPart = titleMatch[1].trim();
      const titlePart = titleMatch[2].trim();
      currentShowName = showPart;
      currentEntry = createEmptyEntry(showPart, titlePart, currentCid, currentSection, updateTime);
      continue;
    }

    // Could be a standalone short/long highlight line (without prefix)
    // If we have an entry and this line doesn't match anything else,
    // check if it looks like a highlight (for entries where short/long highlights have no label)
    if (currentEntry) {
      if (!currentEntry.shortHighlight && !line.startsWith('http') && line.length <= 20) {
        currentEntry.shortHighlight = line;
        continue;
      }
      if (!currentEntry.longHighlight && !line.startsWith('http') && line.length > 0) {
        currentEntry.longHighlight = line;
        continue;
      }
    }

    // Unrecognized line — could be an entry title without · separator
    // If there's no current entry, treat it as a new entry title
    if (!currentEntry && currentShowName) {
      currentEntry = createEmptyEntry(currentShowName, line, currentCid, currentSection, updateTime);
      continue;
    }
  }

  flushEntry();
}

function createEmptyEntry(showName, title, cid, section, updateTime) {
  return {
    cid: cid || '',
    showName: showName || '',
    title: title || '',
    section: section || '',
    updateTime: updateTime || '',
    shortHighlight: '',
    longHighlight: '',
    pcAutoPlay: '',
    images: {},
  };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function actionExport(input) {
  const date = input.date || todayStr();
  const format = input.format || 'text';
  const entries = readEntries(date);

  if (format === 'json') {
    return { content: JSON.stringify(entries, null, 2), format: 'json' };
  }

  // Reconstruct original text format
  const grouped = groupByCid(entries);
  const lines = [];

  for (const group of grouped) {
    if (group.entries.length === 0) continue;
    const first = group.entries[0];

    if (first.updateTime && lines.length > 0) {
      lines.push('');
    }

    for (const entry of group.entries) {
      // Title line
      lines.push(`${entry.showName}·${entry.title}`);

      if (entry.cid) lines.push(`cid：${entry.cid}`);
      if (entry.pcAutoPlay) lines.push(`pc自动播：${entry.pcAutoPlay}`);
      if (entry.shortHighlight) lines.push(`短看点：${entry.shortHighlight}`);
      if (entry.longHighlight) lines.push(`长看点：${entry.longHighlight}`);

      // Images
      if (entry.images) {
        for (const [type, url] of Object.entries(entry.images)) {
          lines.push(`${type}：${url}`);
        }
      }

      lines.push(''); // blank line between entries
    }
  }

  return { content: lines.join('\n').trim(), format: 'text' };
}

function groupByCid(entries) {
  const cidMap = new Map();
  for (const entry of entries) {
    if (!cidMap.has(entry.cid)) {
      cidMap.set(entry.cid, {
        cid: entry.cid,
        showName: entry.showName,
        cidOrder: entry.cidOrder || 0,
        entries: [],
      });
    }
    cidMap.get(entry.cid).entries.push(entry);
  }

  const groups = Array.from(cidMap.values());
  groups.sort((a, b) => a.cidOrder - b.cidOrder);
  return groups;
}

// ---------------------------------------------------------------------------
// stdin reader & main
// ---------------------------------------------------------------------------

async function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => {
      try {
        resolve(data.trim() ? JSON.parse(data) : {});
      } catch (e) {
        reject(new Error(`Invalid JSON input: ${e.message}`));
      }
    });
    process.stdin.on('error', reject);
  });
}

async function main() {
  const action = process.argv[2];
  if (!action) {
    console.error('Error: No action specified');
    process.exit(1);
  }

  try {
    const input = await readStdin();
    let result;

    switch (action) {
      case 'list':    result = actionList(input); break;
      case 'add':     result = actionAdd(input); break;
      case 'update':  result = actionUpdate(input); break;
      case 'delete':  result = actionDelete(input); break;
      case 'reorder': result = actionReorder(input); break;
      case 'parse':   result = actionParse(input); break;
      case 'export':  result = actionExport(input); break;
      default: throw new Error(`Unknown action: ${action}`);
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
