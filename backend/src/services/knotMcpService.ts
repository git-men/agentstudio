import { PresetMcpServer } from '../data/preset-mcp-servers.js';
import knotMcpData from '../data/knot-mcp-market.json';

interface KnotMcpItem {
  id: string;
  server_name: string;
  display_name: string;
  description: string;
  type: string;
  transport_type: string;
  config: string;
  template: string;
}

interface KnotMcpConfig {
  url?: string;
  command?: string;
  args?: string[];
  headers?: Record<string, string>;
}

interface TemplateParam {
  name: string;
  label?: string;
  help?: string;
  default?: string;
}

interface KnotTemplate {
  parameters?: Record<string, {
    headers?: TemplateParam[];
    url_params?: TemplateParam[];
  }>;
}

function parseJson<T>(str: string): T | null {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

function buildRequiredEnvVars(
  config: KnotMcpConfig,
  template: KnotTemplate | null,
): PresetMcpServer['requiredEnvVars'] {
  const envVars: NonNullable<PresetMcpServer['requiredEnvVars']> = [];

  // Collect template param info into a lookup map
  const templateParams = new Map<string, TemplateParam>();
  if (template?.parameters) {
    for (const transport of Object.values(template.parameters)) {
      for (const h of transport.headers || []) {
        templateParams.set(h.name, h);
      }
      for (const u of transport.url_params || []) {
        templateParams.set(u.name, u);
      }
    }
  }

  // Headers that need user input
  if (config.headers) {
    for (const [key, value] of Object.entries(config.headers)) {
      const isPlaceholder = value.includes('xxx') || value.includes('<') || value.includes('your');
      const tmpl = templateParams.get(key);

      // Include if it's a placeholder in config, or has a template entry
      if (isPlaceholder || tmpl) {
        const help = tmpl?.help ? stripHtml(tmpl.help) : '';
        const isSecret = key.toLowerCase().includes('auth')
          || key.toLowerCase().includes('token')
          || key.toLowerCase().includes('secret')
          || key.toLowerCase().includes('key')
          || key.toLowerCase().includes('password');

        envVars.push({
          key: `HEADER_${key.toUpperCase().replace(/-/g, '_')}`,
          label: tmpl?.label || key,
          description: help || `Header: ${key}`,
          placeholder: tmpl?.default || undefined,
          isSecret,
        });

        templateParams.delete(key);
      }
    }
  }

  // URL params from template that aren't already covered
  if (config.url) {
    for (const [name, tmpl] of templateParams.entries()) {
      const help = tmpl.help ? stripHtml(tmpl.help) : '';
      envVars.push({
        key: `URLPARAM_${name.toUpperCase().replace(/-/g, '_')}`,
        label: tmpl.label || name,
        description: help || `URL parameter: ${name}`,
        placeholder: tmpl.default || undefined,
        isSecret: name.toLowerCase().includes('token') || name.toLowerCase().includes('key'),
      });
    }

    // Also handle inline <placeholder> in URL when no template
    if (templateParams.size === 0) {
      const placeholders = config.url.match(/<[^>]+>/g);
      if (placeholders) {
        for (const ph of placeholders) {
          const name = ph.replace(/[<>]/g, '').replace(/[-\s]/g, '_').toUpperCase();
          envVars.push({
            key: name,
            label: ph.replace(/[<>]/g, ''),
            description: `URL parameter: ${ph}`,
            isSecret: name.includes('TOKEN') || name.includes('KEY'),
          });
        }
      }
    }
  }

  return envVars.length > 0 ? envVars : undefined;
}

function mapKnotToPreset(item: KnotMcpItem): PresetMcpServer | null {
  const config = parseJson<KnotMcpConfig>(item.config);
  if (!config) return null;

  if (item.transport_type === 'stdio') {
    if (!config.command || config.command.includes('/path/to/')) return null;
  }

  if (config.url && (config.url.includes('127.0.0.1') || config.url.includes('你部署服务的地址'))) {
    return null;
  }

  const template = item.template ? parseJson<KnotTemplate>(item.template) : null;
  const isHttp = item.transport_type !== 'stdio';

  const preset: PresetMcpServer = {
    id: `knot-${item.id}`,
    name: item.display_name,
    serverName: item.server_name,
    description: item.description,
    category: 'internal',
    type: isHttp ? 'http' : 'stdio',
    official: item.type === 'official',
  };

  if (isHttp && config.url) {
    preset.url = config.url;
  }

  if (!isHttp) {
    preset.command = config.command;
    preset.args = config.args;
  }

  if (config.headers) {
    const cleanHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(config.headers)) {
      if (!value.includes('xxx') && !value.includes('<') && !value.includes('your')) {
        cleanHeaders[key] = value;
      }
    }
    if (Object.keys(cleanHeaders).length > 0) {
      preset.headers = cleanHeaders;
    }
  }

  preset.requiredEnvVars = buildRequiredEnvVars(config, template);

  preset.documentationUrl = `https://knot.woa.com/mcp/detail/${item.id}`;

  return preset;
}

let cache: PresetMcpServer[] | null = null;

export function getKnotMcpServers(): PresetMcpServer[] {
  if (cache) return cache;

  const items = knotMcpData as unknown as KnotMcpItem[];
  cache = items
    .map(mapKnotToPreset)
    .filter((p): p is PresetMcpServer => p !== null);

  console.log(`[KnotMCP] Loaded ${cache.length} MCP servers from static data`);
  return cache;
}
