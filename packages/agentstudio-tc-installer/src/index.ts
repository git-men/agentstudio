#!/usr/bin/env node

/**
 * @tencent/agentstudio-tc-installer
 *
 * 一键安装 AgentStudio 和腾讯内部 Claude Code 的安装程序
 *
 * 使用方法：
 * npx --registry=https://mirrors.tencent.com/npm/ @tencent/agentstudio-tc-installer
 */

import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir, platform } from 'os';
import { join } from 'path';

// 腾讯内部 npm registry
const TENCENT_REGISTRY = 'https://mirrors.tencent.com/npm/';

// 配置常量
const CLAUDE_AGENT_DIR = join(homedir(), '.claude-agent');
const CLAUDE_VERSIONS_FILE = join(CLAUDE_AGENT_DIR, 'claude-versions.json');

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message: string, color: string = colors.reset): void {
  console.log(`${color}${message}${colors.reset}`);
}

function logStep(step: number, total: number, message: string): void {
  log(`\n[${step}/${total}] ${message}`, colors.cyan);
}

function logSuccess(message: string): void {
  log(`✅ ${message}`, colors.green);
}

function logWarning(message: string): void {
  log(`⚠️  ${message}`, colors.yellow);
}

function logError(message: string): void {
  log(`❌ ${message}`, colors.red);
}

/**
 * 执行命令并返回输出
 */
function execCommand(command: string, options: { silent?: boolean } = {}): string {
  try {
    const result = execSync(command, {
      encoding: 'utf-8',
      stdio: options.silent ? 'pipe' : 'inherit',
    });
    return result?.trim() || '';
  } catch (error) {
    if (!options.silent) {
      throw error;
    }
    return '';
  }
}

/**
 * 检查命令是否存在
 */
function commandExists(command: string): boolean {
  try {
    const isWindows = platform() === 'win32';
    const checkCommand = isWindows ? `where ${command}` : `which ${command}`;
    execSync(checkCommand, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取命令的完整路径（解析符号链接）
 */
function getCommandPath(command: string): string {
  try {
    const isWindows = platform() === 'win32';
    const checkCommand = isWindows ? `where ${command}` : `which ${command}`;
    const path = execSync(checkCommand, { encoding: 'utf-8', stdio: 'pipe' }).trim().split('\n')[0];

    if (!path) return '';

    // 在 Unix 系统上，尝试解析真实路径以获取更稳定的路径
    if (!isWindows) {
      try {
        // 尝试使用 realpath 获取真实路径
        const realPath = execSync(`realpath "${path}" 2>/dev/null || readlink -f "${path}" 2>/dev/null || echo "${path}"`, {
          encoding: 'utf-8',
          stdio: 'pipe',
        }).trim();

        // 如果 realpath 返回的是 JS 文件，我们需要返回可执行的 bin 路径
        // 检查是否有更稳定的 npm global bin 路径
        const npmRoot = execSync('npm root -g', { encoding: 'utf-8', stdio: 'pipe' }).trim();
        const stableBinPath = npmRoot.replace('/lib/node_modules', '/bin/') + command;

        // 验证稳定路径是否存在
        try {
          execSync(`test -e "${stableBinPath}"`, { stdio: 'pipe' });
          return stableBinPath;
        } catch {
          // 如果稳定路径不存在，返回原始路径
          return path;
        }
      } catch {
        return path;
      }
    }

    return path;
  } catch {
    return '';
  }
}

/**
 * 获取已安装的 npm 包版本
 */
function getInstalledVersion(packageName: string): string | null {
  try {
    const result = execSync(`npm list -g ${packageName} --depth=0 2>/dev/null | grep ${packageName}`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();

    // 解析版本号，格式如: `-- agentstudio@0.1.17
    const match = result.match(/@(\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * 获取 npm registry 上的最新版本
 */
function getLatestVersion(packageName: string, registry?: string): string | null {
  try {
    const registryFlag = registry ? `--registry=${registry}` : '';
    const result = execSync(`npm view ${packageName} version ${registryFlag}`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();
    return result || null;
  } catch {
    return null;
  }
}

/**
 * 安装全局 npm 包（总是安装最新版本）
 */
function installGlobalPackage(packageName: string, registry?: string): void {
  const registryFlag = registry ? `--registry=${registry}` : '';
  // 使用 @latest 强制安装最新版本
  const command = `npm install -g ${packageName}@latest ${registryFlag}`.trim();
  log(`执行: ${command}`, colors.blue);
  execCommand(command);
}

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * 默认模型配置
 */
const DEFAULT_MODELS = [
  {
    id: 'sonnet',
    name: 'Sonnet',
    isVision: true,
    description: 'Claude 3.5 Sonnet - 平衡性能和成本的模型',
  },
  {
    id: 'opus',
    name: 'Opus',
    isVision: true,
    description: 'Claude 3 Opus - 最强大的模型',
  },
];

/**
 * 配置 claude-tc 版本
 */
function configureClaudeTc(claudeInternalPath: string): void {
  // 确保目录存在
  if (!existsSync(CLAUDE_AGENT_DIR)) {
    mkdirSync(CLAUDE_AGENT_DIR, { recursive: true });
  }

  // 读取现有配置或创建新配置
  let storage: {
    versions: any[];
    defaultVersionId: string | null;
  };

  if (existsSync(CLAUDE_VERSIONS_FILE)) {
    try {
      const content = readFileSync(CLAUDE_VERSIONS_FILE, 'utf-8');
      storage = JSON.parse(content);
    } catch {
      storage = { versions: [], defaultVersionId: null };
    }
  } else {
    storage = { versions: [], defaultVersionId: null };
  }

  // 查找系统版本作为模板
  const systemVersion = storage.versions.find((v) => v.isSystem === true);

  // 检查是否已存在 claude-tc 版本
  const existingTcVersion = storage.versions.find((v) => v.alias === 'claude-tc');
  if (existingTcVersion) {
    // 更新现有配置
    existingTcVersion.executablePath = claudeInternalPath;
    existingTcVersion.updatedAt = new Date().toISOString();
    logWarning('claude-tc 版本已存在，已更新可执行路径');
  } else {
    // 创建新版本
    const now = new Date().toISOString();
    const newVersion = {
      id: generateId(),
      name: 'Claude TC',
      alias: 'claude-tc',
      description: '腾讯内部 Claude Code 版本',
      executablePath: claudeInternalPath,
      isDefault: storage.versions.length === 0,
      isSystem: false,
      environmentVariables: systemVersion?.environmentVariables || {},
      models: systemVersion?.models || DEFAULT_MODELS,
      createdAt: now,
      updatedAt: now,
    };

    storage.versions.push(newVersion);

    // 如果这是第一个版本，设置为默认版本
    if (storage.versions.length === 1) {
      storage.defaultVersionId = newVersion.id;
    }
  }

  // 保存配置
  writeFileSync(CLAUDE_VERSIONS_FILE, JSON.stringify(storage, null, 2), 'utf-8');
  logSuccess(`claude-tc 版本已配置到 ${CLAUDE_VERSIONS_FILE}`);
}

/**
 * 启动 agentstudio 并打开浏览器
 */
async function startAgentStudioAndOpenBrowser(): Promise<void> {
  const open = (await import('open')).default;

  log('正在启动 AgentStudio...', colors.blue);

  // 使用 spawn 在后台启动 agentstudio
  const isWindows = platform() === 'win32';
  const agentstudioPath = getCommandPath('agentstudio');

  if (!agentstudioPath) {
    throw new Error('无法找到 agentstudio 命令');
  }

  const child = spawn(agentstudioPath, ['start'], {
    detached: true,
    stdio: 'ignore',
    shell: isWindows,
  });

  child.unref();

  // 等待服务启动
  log('等待服务启动...', colors.yellow);
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // 打开浏览器
  const url = 'http://localhost:4936';
  log(`正在打开浏览器: ${url}`, colors.blue);
  await open(url);

  logSuccess('AgentStudio 已启动！');
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  console.log(`
${colors.bright}${colors.cyan}
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║     AgentStudio + Claude TC 一键安装程序                  ║
║                                                           ║
║     @tencent/agentstudio-tc-installer                     ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
${colors.reset}
`);

  const TOTAL_STEPS = 5;

  try {
    // Step 1: 检查环境
    logStep(1, TOTAL_STEPS, '检查环境...');
    if (!commandExists('npm')) {
      throw new Error('未找到 npm，请先安装 Node.js');
    }
    if (!commandExists('node')) {
      throw new Error('未找到 node，请先安装 Node.js');
    }
    logSuccess('环境检查通过');

    // Step 2: 安装/更新 agentstudio
    logStep(2, TOTAL_STEPS, '安装/更新 agentstudio...');
    {
      const installedVersion = getInstalledVersion('agentstudio');
      const latestVersion = getLatestVersion('agentstudio');
      log(`本地版本: ${installedVersion || '未安装'}，最新版本: ${latestVersion || '未知'}`, colors.blue);

      if (installedVersion && latestVersion && installedVersion === latestVersion) {
        logSuccess(`agentstudio 已是最新版本 (${installedVersion})`);
      } else {
        installGlobalPackage('agentstudio');
        logSuccess(`agentstudio 已${installedVersion ? '更新' : '安装'}到最新版本`);
      }
    }

    // Step 3: 安装/更新 @tencent/claude-code-internal
    logStep(3, TOTAL_STEPS, '安装/更新 @tencent/claude-code-internal...');
    {
      const installedVersion = getInstalledVersion('@tencent/claude-code-internal');
      const latestVersion = getLatestVersion('@tencent/claude-code-internal', TENCENT_REGISTRY);
      log(`本地版本: ${installedVersion || '未安装'}，最新版本: ${latestVersion || '未知'}`, colors.blue);

      if (installedVersion && latestVersion && installedVersion === latestVersion) {
        logSuccess(`claude-internal 已是最新版本 (${installedVersion})`);
      } else {
        installGlobalPackage('@tencent/claude-code-internal', TENCENT_REGISTRY);
        logSuccess(`@tencent/claude-code-internal 已${installedVersion ? '更新' : '安装'}到最新版本`);
      }
    }

    // Step 4: 配置 claude-tc 版本
    logStep(4, TOTAL_STEPS, '配置 claude-tc 版本...');
    const claudeInternalPath = getCommandPath('claude-internal');
    if (!claudeInternalPath) {
      throw new Error('无法找到 claude-internal 命令路径');
    }
    log(`claude-internal 路径: ${claudeInternalPath}`, colors.blue);
    configureClaudeTc(claudeInternalPath);
    logSuccess('claude-tc 配置完成');

    // Step 5: 启动 agentstudio
    logStep(5, TOTAL_STEPS, '启动 AgentStudio...');
    await startAgentStudioAndOpenBrowser();

    console.log(`
${colors.bright}${colors.green}
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║     🎉 安装完成！                                         ║
║                                                           ║
║     AgentStudio 已启动，浏览器即将打开                    ║
║     访问地址: http://localhost:4936                       ║
║                                                           ║
║     提示：                                                ║
║     - 在 AgentStudio 设置中可以选择 claude-tc 版本        ║
║     - 下次启动只需运行: agentstudio start                 ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
${colors.reset}
`);
  } catch (error) {
    logError(`安装失败: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// 运行主函数
main().catch((error) => {
  logError(`发生错误: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
