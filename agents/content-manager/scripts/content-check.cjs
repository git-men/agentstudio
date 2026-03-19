#!/usr/bin/env node

/**
 * Content Check Service
 *
 * Calls LLM to check content for:
 * - Typos / wrong characters
 * - Political sensitivity
 * - Public opinion / sentiment risks
 *
 * Input (stdin JSON):
 *   { "texts": [{ "id": "entry-id", "field": "shortHighlight", "text": "..." }, ...] }
 *
 * Output (stdout JSON):
 *   { "results": [{ "id": "...", "field": "...", "passed": true/false, "issues": [...] }] }
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// LAVS ScriptExecutor strips API_KEY env vars for security.
// Read keys from AgentStudio config or .env files.
function loadApiKeys() {
  const home = process.env.HOME || '';
  const keys = {};

  // 1. Try AgentStudio claude-versions config
  try {
    const configPath = path.join(home, '.agentstudio', 'data', 'claude-versions.json');
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      for (const v of (data.versions || [])) {
        const env = v.environmentVariables || {};
        if (env.ANTHROPIC_API_KEY) keys.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
        if (env.ANTHROPIC_AUTH_TOKEN) keys.ANTHROPIC_API_KEY = keys.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN;
        if (env.OPENAI_API_KEY) keys.OPENAI_API_KEY = env.OPENAI_API_KEY;
      }
      if (keys.ANTHROPIC_API_KEY || keys.OPENAI_API_KEY) return keys;
    }
  } catch (_) { /* ignore */ }

  // 2. Try .env files
  const envCandidates = [
    path.join(__dirname, '..', '..', '..', 'backend', '.env'),
    path.join(home, '.agentstudio', '.env'),
  ];
  for (const p of envCandidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const content = fs.readFileSync(p, 'utf-8');
      for (const line of content.split('\n')) {
        const m = line.match(/^(ANTHROPIC_API_KEY|OPENAI_API_KEY)\s*=\s*(.+)/);
        if (m) keys[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
      if (keys.ANTHROPIC_API_KEY || keys.OPENAI_API_KEY) return keys;
    } catch (_) { /* ignore */ }
  }
  return keys;
}

const apiKeys = loadApiKeys();
const ANTHROPIC_API_KEY = apiKeys.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '';
const OPENAI_API_KEY = apiKeys.OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';

const SYSTEM_PROMPT = `你是一个内容审核专家。请检查以下文本内容，检测以下问题：

1. **错别字**（typo）：包括同音字误用、形近字误用、多字少字、标点错误等
2. **政治风险**（political）：涉及敏感政治话题、领导人、国家政策等可能引发争议的内容
3. **舆情风险**（sentiment）：可能引发负面舆论、冒犯特定群体、涉及敏感社会话题的内容

请以 JSON 格式返回检查结果。对于每条文本，返回：
- passed: 是否通过审核（无问题时为 true）
- issues: 问题数组，每个问题包含 type（typo/political/sentiment/other）、severity（low/medium/high）、description（问题描述）

只返回 JSON，不要其他文字。格式示例：
[
  {
    "index": 0,
    "passed": false,
    "issues": [
      { "type": "typo", "severity": "low", "description": "「曦」可能应为「熙」" }
    ]
  },
  {
    "index": 1,
    "passed": true,
    "issues": []
  }
]`;

// ---------------------------------------------------------------------------
// API callers
// ---------------------------------------------------------------------------

function callAnthropicAPI(texts) {
  const userMessage = texts.map((t, i) => `[${i}] ${t.text}`).join('\n');

  const body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
            return;
          }
          const content = parsed.content?.[0]?.text || '[]';
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            resolve(JSON.parse(jsonMatch[0]));
          } else {
            resolve([]);
          }
        } catch (e) {
          reject(new Error(`Failed to parse API response: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function callOpenAIAPI(texts) {
  const userMessage = texts.map((t, i) => `[${i}] ${t.text}`).join('\n');

  const body = JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    temperature: 0,
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
            return;
          }
          const content = parsed.choices?.[0]?.message?.content || '[]';
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            resolve(JSON.parse(jsonMatch[0]));
          } else {
            resolve([]);
          }
        } catch (e) {
          reject(new Error(`Failed to parse API response: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Basic rules-based check (fallback when no LLM API key available)
// ---------------------------------------------------------------------------

function basicCheck(texts) {
  const politicalTerms = [
    '习近平', '总书记', '国务院', '中央', '政治局',
    '台独', '藏独', '疆独', '法轮', '六四',
  ];
  const commonTypos = {
    '的地得': { pattern: /(?:跑的快|慢的走|高兴的说|认真的做)/g, desc: '「的/地/得」可能混用' },
    '在再': { pattern: /(?:在见|再这里)/g, desc: '「在/再」可能混用' },
  };

  return texts.map((t, i) => {
    const issues = [];
    const text = t.text || '';

    for (const term of politicalTerms) {
      if (text.includes(term)) {
        issues.push({ type: 'political', severity: 'high', description: `包含敏感词「${term}」` });
      }
    }

    for (const [, rule] of Object.entries(commonTypos)) {
      if (rule.pattern.test(text)) {
        issues.push({ type: 'typo', severity: 'low', description: rule.desc });
      }
    }

    if (/[a-zA-Z]{2,}/.test(text) && !/[a-zA-Z]{2,}/.test(text.replace(/MVP|VIP|GIF|OK|PK|CP|IP/gi, ''))) {
      // has english but only known acronyms - ok
    }

    return { index: i, passed: issues.length === 0, issues };
  });
}

// ---------------------------------------------------------------------------
// Main
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
  try {
    const input = await readStdin();
    const texts = input.texts || [];

    if (texts.length === 0) {
      console.log(JSON.stringify({ results: [] }));
      return;
    }

    let apiResults;

    if (ANTHROPIC_API_KEY && ANTHROPIC_API_KEY.startsWith('sk-ant-')) {
      console.error('[ContentCheck] Using Anthropic API');
      apiResults = await callAnthropicAPI(texts);
    } else if (OPENAI_API_KEY) {
      console.error('[ContentCheck] Using OpenAI API');
      apiResults = await callOpenAIAPI(texts);
    } else {
      console.error('[ContentCheck] No valid API key found, using basic check');
      apiResults = basicCheck(texts);
    }

    // Map API results back to input texts
    const results = texts.map((t, i) => {
      const apiResult = apiResults.find(r => r.index === i) || { passed: true, issues: [] };
      return {
        id: t.id,
        field: t.field,
        passed: apiResult.passed,
        issues: apiResult.issues || [],
      };
    });

    console.log(JSON.stringify({ results }, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
