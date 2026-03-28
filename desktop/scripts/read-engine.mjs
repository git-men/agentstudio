#!/usr/bin/env node
/**
 * Read the saved launch engine from Tauri's app config directory.
 * Prints the engine value (e.g. "claude-sdk", "claude-internal-sdk") to stdout.
 * Falls back to "claude-sdk" if the config doesn't exist.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';

function getConfigDir() {
  const home = homedir();
  if (platform() === 'darwin') {
    return join(home, 'Library', 'Application Support', 'com.clawstudio.desktop');
  } else if (platform() === 'win32') {
    return join(home, 'AppData', 'Roaming', 'com.clawstudio.desktop');
  }
  return join(home, '.config', 'com.clawstudio.desktop');
}

try {
  const configPath = join(getConfigDir(), 'launch-config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  process.stdout.write(config.engine || 'claude-sdk');
} catch {
  process.stdout.write('claude-sdk');
}
