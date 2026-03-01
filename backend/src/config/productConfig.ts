/**
 * Product Edition Configuration
 *
 * Determines which feature modules are available based on the product edition.
 * Supports preset editions (full, chat-only, lite) and custom profiles loaded
 * from a JSON configuration file.
 *
 * Configuration priority:
 *   1. PRODUCT_EDITION env var / --product CLI arg
 *   2. product-profile.json in data directory
 *   3. Default: 'full'
 *
 * For custom edition, module access is read from product-profile.json.
 * Modules not listed in the profile default to 'disabled'.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AGENTSTUDIO_HOME } from './paths.js';
import type {
  ProductEdition,
  ProductProfile,
  ProductConfig,
  FeatureModule,
  ModuleAccess,
  ProductInfoResponse,
  FeatureModuleInfo,
} from '../types/product.js';

// =============================================================================
// Feature Module Definitions
// =============================================================================

export const FEATURE_MODULES: FeatureModule[] = [
  // ── Core Modules (essential for basic operation) ─────────────────────────
  {
    id: 'core.chat',
    name: 'Chat',
    description: 'Main chat interface and interactive responses',
    category: 'core',
    routePatterns: [
      '/api/agents/chat',
      '/api/agents/user-response',
    ],
    frontendPaths: ['/chat'],
  },
  {
    id: 'core.agui',
    name: 'AGUI Protocol',
    description: 'AGUI protocol endpoints and frontend tool results',
    category: 'core',
    routePatterns: [
      '/api/agui',
      '/api/agents/frontend-tool-result',
    ],
    frontendPaths: [],
  },
  {
    id: 'core.sessions',
    name: 'Sessions',
    description: 'Session management, messages, and heartbeat',
    category: 'core',
    routePatterns: [
      '/api/agents/sessions',
      '/api/sessions',
    ],
    frontendPaths: [],
  },
  {
    id: 'core.files',
    name: 'Files',
    description: 'File read/write operations and media serving',
    category: 'core',
    routePatterns: [
      '/api/files',
      '/api/media',
      '/media',
    ],
    frontendPaths: [],
  },

  // ── Management Modules ───────────────────────────────────────────────────
  {
    id: 'manage.dashboard',
    name: 'Dashboard',
    description: 'Overview dashboard with quick actions and recent sessions',
    category: 'manage',
    routePatterns: [],
    frontendPaths: ['/dashboard'],
  },
  {
    id: 'manage.agents',
    name: 'Agent Management',
    description: 'Agent CRUD operations and configuration',
    category: 'manage',
    routePatterns: ['/api/agents'],
    frontendPaths: ['/agents'],
  },
  {
    id: 'manage.projects',
    name: 'Project Management',
    description: 'Project CRUD, import, configuration, A2A config and API keys',
    category: 'manage',
    routePatterns: [
      '/api/projects',
      '/api/projects/*/a2a-config',
      '/api/projects/*/api-keys',
    ],
    frontendPaths: ['/projects'],
  },
  {
    id: 'manage.mcp',
    name: 'MCP Management',
    description: 'MCP server configuration and validation',
    category: 'manage',
    routePatterns: ['/api/mcp'],
    frontendPaths: ['/mcp'],
  },

  // ── Extension Modules ────────────────────────────────────────────────────
  {
    id: 'extend.commands',
    name: 'Slash Commands',
    description: 'Custom slash command management',
    category: 'extend',
    routePatterns: ['/api/commands'],
    frontendPaths: ['/settings/commands'],
  },
  {
    id: 'extend.subagents',
    name: 'Subagents',
    description: 'Subagent configuration and management',
    category: 'extend',
    routePatterns: ['/api/subagents'],
    frontendPaths: ['/settings/subagents'],
  },
  {
    id: 'extend.skills',
    name: 'Skills',
    description: 'Skills management and validation',
    category: 'extend',
    routePatterns: ['/api/skills'],
    frontendPaths: ['/skills'],
  },
  {
    id: 'extend.plugins',
    name: 'Plugins & Marketplace',
    description: 'Plugin marketplace, installation, and management',
    category: 'extend',
    routePatterns: ['/api/plugins'],
    frontendPaths: ['/plugins'],
  },
  {
    id: 'extend.marketplace-skills',
    name: 'Marketplace Skills',
    description: 'Marketplace skill toggle and batch operations (used by chat UI)',
    category: 'extend',
    routePatterns: ['/api/marketplace-skills'],
    frontendPaths: [],
  },
  {
    id: 'extend.rules',
    name: 'Rules',
    description: 'Rules management for Claude Code and Cursor',
    category: 'extend',
    routePatterns: ['/api/rules'],
    frontendPaths: ['/rules'],
  },
  {
    id: 'extend.hooks',
    name: 'Hooks',
    description: 'Hooks management (Claude Code only)',
    category: 'extend',
    routePatterns: ['/api/hooks'],
    frontendPaths: ['/hooks'],
  },

  // ── System Modules ───────────────────────────────────────────────────────
  {
    id: 'system.settings',
    name: 'Settings',
    description: 'General settings, config, memory, and system info',
    category: 'system',
    routePatterns: [
      '/api/settings',
      '/api/config',
      '/api/network-info',
    ],
    frontendPaths: [
      '/settings',
      '/settings/general',
      '/settings/suppliers',
      '/settings/memory',
      '/settings/telemetry',
      '/settings/system-info',
      '/settings/cursor-config',
      '/models',
    ],
  },
  {
    id: 'system.scheduler',
    name: 'Scheduled Tasks',
    description: 'Task scheduling and execution',
    category: 'system',
    routePatterns: [
      '/api/scheduled-tasks',
      '/api/task-executor',
    ],
    frontendPaths: ['/scheduled-tasks'],
  },
  {
    id: 'system.tunnel',
    name: 'Tunnel',
    description: 'WebSocket tunnel and Cloudflare tunnel configuration',
    category: 'system',
    routePatterns: [
      '/api/tunnel',
      '/api/cloudflare-tunnel',
    ],
    frontendPaths: ['/settings/tunnel'],
  },
  {
    id: 'system.a2a',
    name: 'A2A Protocol',
    description: 'Agent-to-Agent protocol endpoints',
    category: 'system',
    routePatterns: [
      '/api/a2a',
      '/a2a',
    ],
    frontendPaths: [],
  },
  {
    id: 'system.mcp-admin',
    name: 'MCP Admin',
    description: 'MCP admin server and API key management',
    category: 'system',
    routePatterns: [
      '/api/mcp-admin',
      '/api/mcp-admin-management',
    ],
    frontendPaths: ['/settings/mcp-admin'],
  },
  {
    id: 'system.versions',
    name: 'Version Management',
    description: 'Version checking, git versions, and updates',
    category: 'system',
    routePatterns: [
      '/api/version',
      '/api/projects/*/versions',
    ],
    frontendPaths: [],
  },
  {
    id: 'system.voice',
    name: 'Voice Input',
    description: 'Speech-to-text configuration and transcription',
    category: 'system',
    routePatterns: ['/api/speech-to-text'],
    frontendPaths: ['/settings/voice'],
  },
  {
    id: 'system.integrations',
    name: 'External Integrations',
    description: 'Slack webhook and other integrations',
    category: 'system',
    routePatterns: ['/api/slack'],
    frontendPaths: [],
  },
];

// =============================================================================
// Product Edition Presets
// =============================================================================

function allModulesAccess(access: ModuleAccess): Record<string, ModuleAccess> {
  const result: Record<string, ModuleAccess> = {};
  for (const mod of FEATURE_MODULES) {
    result[mod.id] = access;
  }
  return result;
}

const EDITION_PRESETS: Record<Exclude<ProductEdition, 'custom'>, ProductProfile> = {
  full: {
    edition: 'full',
    name: 'Full Edition',
    description: 'All features enabled. Suitable for internal teams and full deployments.',
    modules: allModulesAccess('full'),
  },

  'chat-only': {
    edition: 'chat-only',
    name: 'Chat Edition',
    description: 'Chat-focused deployment for VAG. Aligned with sandbox-proxy route-guard business whitelist. Enables chat, sessions, project read, version management, and marketplace skills.',
    modules: {
      ...allModulesAccess('disabled'),
      'core.chat': 'full',
      'core.agui': 'full',
      'core.sessions': 'full',
      'manage.projects': 'readonly',
      'system.versions': 'full',
      'extend.marketplace-skills': 'full',
    },
  },

  lite: {
    edition: 'lite',
    name: 'Lite Edition',
    description: 'Core features with basic management. No marketplace, scheduler, or tunnel.',
    modules: {
      ...allModulesAccess('disabled'),
      // Core - full
      'core.chat': 'full',
      'core.agui': 'full',
      'core.sessions': 'full',
      'core.files': 'full',
      // Management - full
      'manage.dashboard': 'full',
      'manage.agents': 'full',
      'manage.projects': 'full',
      'manage.mcp': 'full',
      // Extensions - selective
      'extend.commands': 'full',
      'extend.rules': 'full',
      // System - settings only
      'system.settings': 'full',
      'system.versions': 'readonly',
    },
  },
};

// =============================================================================
// Route Pattern Matching
// =============================================================================

interface RouteMapping {
  pattern: string;
  segments: string[];
  moduleId: string;
}

let _sortedRouteMappings: RouteMapping[] | null = null;

/**
 * Build and cache sorted route mappings from feature module definitions.
 * Routes are sorted by specificity (more segments first) for correct matching.
 */
function getSortedRouteMappings(): RouteMapping[] {
  if (_sortedRouteMappings) return _sortedRouteMappings;

  const mappings: RouteMapping[] = [];
  for (const mod of FEATURE_MODULES) {
    for (const pattern of mod.routePatterns) {
      mappings.push({
        pattern,
        segments: pattern.split('/').filter(Boolean),
        moduleId: mod.id,
      });
    }
  }

  // Sort by segment count descending (most specific first)
  mappings.sort((a, b) => {
    if (b.segments.length !== a.segments.length) {
      return b.segments.length - a.segments.length;
    }
    const aNonWild = a.segments.filter(s => s !== '*').length;
    const bNonWild = b.segments.filter(s => s !== '*').length;
    return bNonWild - aNonWild;
  });

  _sortedRouteMappings = mappings;
  return mappings;
}

/**
 * Match a request path against a route pattern.
 * Supports `*` wildcard for single path segments.
 */
function matchRoute(patternSegments: string[], pathSegments: string[]): boolean {
  if (pathSegments.length < patternSegments.length) return false;

  for (let i = 0; i < patternSegments.length; i++) {
    if (patternSegments[i] === '*') continue;
    if (patternSegments[i] !== pathSegments[i]) return false;
  }

  return true;
}

/**
 * Resolve a request path to its feature module ID.
 * Returns null if no module matches (infrastructure routes like /api/auth, /api/engine).
 */
export function resolveModule(requestPath: string): string | null {
  const pathSegments = requestPath.split('/').filter(Boolean);
  const mappings = getSortedRouteMappings();

  for (const mapping of mappings) {
    if (matchRoute(mapping.segments, pathSegments)) {
      return mapping.moduleId;
    }
  }

  return null;
}

// =============================================================================
// Product Configuration Singleton
// =============================================================================

let _productConfig: ProductConfig | null = null;

function parseEditionFromArgs(): ProductEdition | null {
  for (const arg of process.argv) {
    if (arg.startsWith('--product=')) {
      return arg.split('=')[1] as ProductEdition;
    }
  }
  return null;
}

function detectEdition(): ProductEdition {
  const fromArgs = parseEditionFromArgs();
  if (fromArgs) return fromArgs;

  const fromEnv = process.env.PRODUCT_EDITION;
  if (fromEnv) return fromEnv as ProductEdition;

  return 'full';
}

function validateEdition(edition: string): ProductEdition {
  const valid: ProductEdition[] = ['full', 'chat-only', 'lite', 'custom'];
  if (valid.includes(edition as ProductEdition)) {
    return edition as ProductEdition;
  }

  const aliasMap: Record<string, ProductEdition> = {
    'chatonly': 'chat-only',
    'chat_only': 'chat-only',
    'chat': 'chat-only',
  };

  const mapped = aliasMap[edition.toLowerCase()];
  if (mapped) {
    console.log(`🏷️  Product edition alias "${edition}" resolved to "${mapped}"`);
    return mapped;
  }

  console.warn(`⚠️  Invalid PRODUCT_EDITION="${edition}", falling back to "full"`);
  return 'full';
}

function loadCustomProfile(): ProductProfile | null {
  const profilePath = path.join(AGENTSTUDIO_HOME, 'data', 'product-profile.json');
  try {
    if (!fs.existsSync(profilePath)) {
      return null;
    }
    const raw = fs.readFileSync(profilePath, 'utf-8');
    const data = JSON.parse(raw);

    const modules: Record<string, ModuleAccess> = {};
    // Start with all disabled, then override from config (pure whitelist)
    for (const mod of FEATURE_MODULES) {
      modules[mod.id] = 'disabled';
    }

    if (data.modules && typeof data.modules === 'object') {
      for (const [key, value] of Object.entries(data.modules)) {
        if (['full', 'readonly', 'disabled'].includes(value as string)) {
          modules[key] = value as ModuleAccess;
        }
      }
    }

    return {
      edition: 'custom',
      name: data.name || 'Custom Edition',
      description: data.description || 'Custom product profile loaded from product-profile.json',
      modules,
    };
  } catch (error) {
    console.error(`⚠️  Failed to load product profile from ${profilePath}:`, error);
    return null;
  }
}

/**
 * Initialize product configuration.
 * Called once at service startup after engine initialization.
 */
export function initializeProduct(): ProductConfig {
  if (_productConfig) return _productConfig;

  const edition = validateEdition(detectEdition());

  let profile: ProductProfile;

  if (edition === 'custom') {
    const customProfile = loadCustomProfile();
    if (customProfile) {
      profile = customProfile;
    } else {
      console.warn('⚠️  Custom product edition requested but no profile found. Falling back to "full".');
      profile = EDITION_PRESETS.full;
    }
  } else {
    profile = EDITION_PRESETS[edition];
  }

  _productConfig = { edition, profile };
  return _productConfig;
}

/**
 * Get current product configuration.
 */
export function getProductConfig(): ProductConfig {
  if (!_productConfig) {
    return initializeProduct();
  }
  return _productConfig;
}

/**
 * Get the product profile.
 */
export function getProductProfile(): ProductProfile {
  return getProductConfig().profile;
}

/**
 * Get the product edition.
 */
export function getProductEdition(): ProductEdition {
  return getProductConfig().edition;
}

/**
 * Check if a feature module is enabled (full or readonly).
 */
export function isModuleEnabled(moduleId: string): boolean {
  const profile = getProductProfile();
  const access = profile.modules[moduleId];
  return access === 'full' || access === 'readonly';
}

/**
 * Check if a feature module has full (write) access.
 */
export function isModuleWritable(moduleId: string): boolean {
  const profile = getProductProfile();
  return profile.modules[moduleId] === 'full';
}

/**
 * Get the access level for a feature module.
 */
export function getModuleAccess(moduleId: string): ModuleAccess {
  const profile = getProductProfile();
  return profile.modules[moduleId] || 'disabled';
}

/**
 * Check if a frontend path is accessible in the current product edition.
 */
export function isFrontendPathEnabled(pagePath: string): boolean {
  for (const mod of FEATURE_MODULES) {
    for (const fp of mod.frontendPaths) {
      if (pagePath === fp || pagePath.startsWith(fp + '/')) {
        return isModuleEnabled(mod.id);
      }
    }
  }
  return true; // Unknown paths are allowed (fail-open)
}

/**
 * Get product info for API response.
 */
export function getProductInfo(): ProductInfoResponse {
  const profile = getProductProfile();

  const availableModules: FeatureModuleInfo[] = FEATURE_MODULES.map(mod => ({
    id: mod.id,
    name: mod.name,
    description: mod.description,
    category: mod.category,
    access: profile.modules[mod.id] || 'disabled',
    frontendPaths: mod.frontendPaths,
  }));

  return {
    edition: profile.edition,
    name: profile.name,
    description: profile.description,
    modules: profile.modules,
    availableModules,
  };
}

/**
 * Log product configuration at startup.
 */
/** @internal Reset singleton state for testing. */
export function _resetProductConfig(): void {
  _productConfig = null;
}

export function logProductConfig(): void {
  const profile = getProductProfile();
  console.log('🏷️  Product Configuration:');
  console.log(`   Edition: ${profile.edition}`);
  console.log(`   Name: ${profile.name}`);

  const enabled = Object.entries(profile.modules)
    .filter(([, v]) => v === 'full')
    .map(([k]) => k);
  const readonly = Object.entries(profile.modules)
    .filter(([, v]) => v === 'readonly')
    .map(([k]) => k);
  const disabled = Object.entries(profile.modules)
    .filter(([, v]) => v === 'disabled')
    .map(([k]) => k);

  if (enabled.length > 0) {
    console.log(`   Enabled (full): ${enabled.join(', ')}`);
  }
  if (readonly.length > 0) {
    console.log(`   Enabled (readonly): ${readonly.join(', ')}`);
  }
  if (disabled.length > 0) {
    console.log(`   Disabled: ${disabled.join(', ')}`);
  }
}
