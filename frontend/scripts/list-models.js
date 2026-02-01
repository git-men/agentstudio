#!/usr/bin/env node

/**
 * List Models CLI Tool
 * 
 * A command-line utility to query and display available AI models from the AGUI backend.
 * 
 * Usage:
 *   node scripts/list-models.js [options]
 * 
 * Options:
 *   --api-url <url>    Backend API URL (default: http://127.0.0.1:4936)
 *   --engine <type>    Filter by engine type (claude|cursor)
 *   --json            Output in JSON format
 *   --help            Show this help message
 */

const http = require('http');
const https = require('https');

// Parse command line arguments
const args = process.argv.slice(2);
let apiUrl = 'http://127.0.0.1:4936';
let engineFilter = null;
let jsonOutput = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--api-url' && i + 1 < args.length) {
    apiUrl = args[++i];
  } else if (args[i] === '--engine' && i + 1 < args.length) {
    engineFilter = args[++i];
  } else if (args[i] === '--json') {
    jsonOutput = true;
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log(`
List Models CLI Tool

Usage:
  node scripts/list-models.js [options]

Options:
  --api-url <url>    Backend API URL (default: http://127.0.0.1:4936)
  --engine <type>    Filter by engine type (claude|cursor)
  --json            Output in JSON format
  --help            Show this help message

Examples:
  node scripts/list-models.js
  node scripts/list-models.js --engine claude
  node scripts/list-models.js --json
  node scripts/list-models.js --api-url http://localhost:4936
`);
    process.exit(0);
  }
}

// Fetch data from API
async function fetchEngines() {
  return new Promise((resolve, reject) => {
    const url = `${apiUrl}/api/agui/engines`;
    const client = url.startsWith('https') ? https : http;

    client.get(url, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error(`Failed to parse JSON: ${error.message}`));
          }
        } else {
          reject(new Error(`API returned status ${res.statusCode}: ${data}`));
        }
      });
    }).on('error', (error) => {
      reject(new Error(`Request failed: ${error.message}`));
    });
  });
}

// Format output
function formatOutput(data) {
  if (jsonOutput) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                    Available AI Models                        ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  const { engines, defaultEngine, totalActiveSessions } = data;

  // Filter engines if specified
  const filteredEngines = engineFilter
    ? engines.filter(e => e.type === engineFilter)
    : engines;

  if (filteredEngines.length === 0) {
    console.log(`  ⚠️  No engines found matching filter: ${engineFilter}\n`);
    return;
  }

  // Display summary
  console.log(`📊 Summary:`);
  console.log(`   • Total Engines: ${filteredEngines.length}`);
  console.log(`   • Default Engine: ${defaultEngine}`);
  console.log(`   • Active Sessions: ${totalActiveSessions}\n`);

  // Display each engine and its models
  filteredEngines.forEach((engine, idx) => {
    const isDefault = engine.type === defaultEngine;
    const defaultLabel = isDefault ? ' [DEFAULT]' : '';

    console.log(`${'─'.repeat(65)}`);
    console.log(`🚀 Engine: ${engine.type.toUpperCase()}${defaultLabel}`);
    console.log(`${'─'.repeat(65)}`);

    // Engine capabilities summary
    const caps = engine.capabilities;
    console.log(`\n   Capabilities:`);
    console.log(`   • Multi-turn: ${caps.features.multiTurn ? '✓' : '✗'}`);
    console.log(`   • Thinking: ${caps.features.thinking ? '✓' : '✗'}`);
    console.log(`   • Vision: ${caps.features.vision ? '✓' : '✗'}`);
    console.log(`   • Streaming: ${caps.features.streaming ? '✓' : '✗'}`);
    console.log(`   • Subagents: ${caps.features.subagents ? '✓' : '✗'}`);
    console.log(`   • MCP: ${caps.mcp.supported ? '✓' : '✗'}`);
    console.log(`   • Active Sessions: ${engine.activeSessions || 0}\n`);

    // Models
    console.log(`   Available Models (${engine.models.length}):`);
    engine.models.forEach((model, modelIdx) => {
      const visionIcon = model.isVision ? '👁️ ' : '  ';
      const thinkingIcon = model.isThinking ? '🧠 ' : '  ';
      console.log(`   ${modelIdx + 1}. ${visionIcon}${thinkingIcon}${model.name}`);
      console.log(`      ID: ${model.id}`);
      if (model.description) {
        console.log(`      ${model.description}`);
      }
    });

    console.log('');
  });

  console.log(`${'═'.repeat(65)}\n`);
}

// Main
async function main() {
  try {
    console.log(`\n🔍 Fetching models from ${apiUrl}...`);
    const data = await fetchEngines();
    formatOutput(data);
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}\n`);
    console.error('   Please ensure the backend is running and accessible.\n');
    process.exit(1);
  }
}

main();
