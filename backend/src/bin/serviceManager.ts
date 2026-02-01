/**
 * System Service Manager for AgentStudio
 * 
 * Supports:
 * - macOS: launchd (~/Library/LaunchAgents)
 * - Linux: systemd user services (~/.config/systemd/user)
 * - Windows: Basic instructions (manual setup)
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir, platform } from 'os';

// Service configuration
const SERVICE_NAME = 'agentstudio';
const SERVICE_DESCRIPTION = 'AgentStudio - AI Agent Workspace';
const DEFAULT_PORT = 4936;

interface ServiceConfig {
  port: number;
  dataDir: string;
  envFile?: string;
}

// Get the path to the agentstudio executable
function getExecutablePath(): string {
  // In npm global install, the executable is linked to node_modules/.bin
  // We need to find the actual installed location
  try {
    const result = spawnSync('which', ['agentstudio'], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
  } catch {
    // Fall back to npm prefix
  }

  try {
    const npmPrefix = execSync('npm prefix -g', { encoding: 'utf8' }).trim();
    return join(npmPrefix, 'bin', 'agentstudio');
  } catch {
    // Fall back to current directory
    return 'agentstudio';
  }
}

// Get Node.js path
function getNodePath(): string {
  return process.execPath;
}

// =============================================================================
// macOS launchd Support
// =============================================================================

function getLaunchdPlistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `cc.${SERVICE_NAME}.plist`);
}

function generateLaunchdPlist(config: ServiceConfig): string {
  const execPath = getExecutablePath();
  const nodePath = getNodePath();
  const logDir = join(homedir(), '.agentstudio', 'logs');
  
  // Ensure log directory exists
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>cc.${SERVICE_NAME}</string>
    
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${execPath}</string>
        <string>start</string>
        <string>--port</string>
        <string>${config.port}</string>
        <string>--data-dir</string>
        <string>${config.dataDir}</string>
    </array>
    
    <key>RunAtLoad</key>
    <true/>
    
    <key>KeepAlive</key>
    <true/>
    
    <key>StandardOutPath</key>
    <string>${join(logDir, 'stdout.log')}</string>
    
    <key>StandardErrorPath</key>
    <string>${join(logDir, 'stderr.log')}</string>
    
    <key>WorkingDirectory</key>
    <string>${homedir()}</string>
    
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
        <key>HOME</key>
        <string>${homedir()}</string>
    </dict>
</dict>
</plist>`;
}

function installMacOSService(config: ServiceConfig): void {
  const plistPath = getLaunchdPlistPath();
  const plistDir = dirname(plistPath);

  // Ensure directory exists
  if (!existsSync(plistDir)) {
    mkdirSync(plistDir, { recursive: true });
  }

  // Stop existing service if running
  try {
    execSync(`launchctl unload ${plistPath} 2>/dev/null`, { stdio: 'ignore' });
  } catch {
    // Service might not exist
  }

  // Write plist file
  const plistContent = generateLaunchdPlist(config);
  writeFileSync(plistPath, plistContent);
  console.log(`✅ Created service file: ${plistPath}`);

  // Load and start service
  try {
    execSync(`launchctl load ${plistPath}`);
    console.log('✅ Service loaded and started');
  } catch (error) {
    console.error('❌ Failed to load service:', error);
    throw error;
  }
}

function uninstallMacOSService(): void {
  const plistPath = getLaunchdPlistPath();

  if (existsSync(plistPath)) {
    try {
      execSync(`launchctl unload ${plistPath}`);
    } catch {
      // Service might not be loaded
    }
    unlinkSync(plistPath);
    console.log('✅ Service uninstalled');
  } else {
    console.log('ℹ️  Service is not installed');
  }
}

function macOSServiceAction(action: string): void {
  const plistPath = getLaunchdPlistPath();
  const serviceName = `cc.${SERVICE_NAME}`;

  switch (action) {
    case 'start':
      execSync(`launchctl load ${plistPath}`);
      console.log('✅ Service started');
      break;
    case 'stop':
      execSync(`launchctl unload ${plistPath}`);
      console.log('✅ Service stopped');
      break;
    case 'restart':
      try {
        execSync(`launchctl unload ${plistPath}`);
      } catch { /* ignore */ }
      execSync(`launchctl load ${plistPath}`);
      console.log('✅ Service restarted');
      break;
    case 'status':
      try {
        const result = execSync(`launchctl list | grep ${serviceName}`, { encoding: 'utf8' });
        if (result.includes(serviceName)) {
          console.log('✅ Service is running');
          console.log(result.trim());
        }
      } catch {
        console.log('⚪ Service is not running');
      }
      break;
    case 'logs':
      const logDir = join(homedir(), '.agentstudio', 'logs');
      const stdoutLog = join(logDir, 'stdout.log');
      const stderrLog = join(logDir, 'stderr.log');
      
      console.log('\n📋 Standard Output (last 50 lines):');
      if (existsSync(stdoutLog)) {
        try {
          execSync(`tail -50 "${stdoutLog}"`, { stdio: 'inherit' });
        } catch { /* ignore */ }
      } else {
        console.log('(no logs yet)');
      }
      
      console.log('\n📋 Standard Error (last 20 lines):');
      if (existsSync(stderrLog)) {
        try {
          execSync(`tail -20 "${stderrLog}"`, { stdio: 'inherit' });
        } catch { /* ignore */ }
      } else {
        console.log('(no errors)');
      }
      break;
  }
}

// =============================================================================
// Linux systemd Support
// =============================================================================

function getSystemdServicePath(): string {
  const systemdDir = join(homedir(), '.config', 'systemd', 'user');
  return join(systemdDir, `${SERVICE_NAME}.service`);
}

function generateSystemdService(config: ServiceConfig): string {
  const execPath = getExecutablePath();
  const nodePath = getNodePath();

  return `[Unit]
Description=${SERVICE_DESCRIPTION}
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} ${execPath} start --port ${config.port} --data-dir ${config.dataDir}
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production
Environment=HOME=${homedir()}
WorkingDirectory=${homedir()}

[Install]
WantedBy=default.target
`;
}

function generateStartScript(config: ServiceConfig): string {
  const execPath = getExecutablePath();
  const nodePath = getNodePath();
  const logDir = join(config.dataDir, 'logs');
  
  return `#!/bin/bash
# AgentStudio start script
# Generated by agentstudio install

LOGDIR="${logDir}"
PIDFILE="${config.dataDir}/agentstudio.pid"

mkdir -p "$LOGDIR"

# Check if already running
if [ -f "$PIDFILE" ]; then
    PID=$(cat "$PIDFILE")
    if kill -0 "$PID" 2>/dev/null; then
        echo "AgentStudio is already running (PID: $PID)"
        exit 0
    fi
fi

# Start the service
nohup ${nodePath} ${execPath} start --port ${config.port} --data-dir ${config.dataDir} \\
    > "$LOGDIR/stdout.log" 2> "$LOGDIR/stderr.log" &

echo $! > "$PIDFILE"
echo "AgentStudio started (PID: $!)"
echo "Logs: $LOGDIR"
`;
}

function generateStopScript(config: ServiceConfig): string {
  return `#!/bin/bash
# AgentStudio stop script

PIDFILE="${config.dataDir}/agentstudio.pid"

if [ -f "$PIDFILE" ]; then
    PID=$(cat "$PIDFILE")
    if kill -0 "$PID" 2>/dev/null; then
        kill "$PID"
        rm -f "$PIDFILE"
        echo "AgentStudio stopped"
    else
        rm -f "$PIDFILE"
        echo "AgentStudio is not running (stale pid file removed)"
    fi
else
    echo "AgentStudio is not running"
fi
`;
}

// Check if systemd user session is available
function isSystemdUserAvailable(): boolean {
  try {
    // First, try to detect if XDG_RUNTIME_DIR is set
    const uid = process.getuid?.() || execSync('id -u', { encoding: 'utf8' }).trim();
    const xdgRuntime = process.env.XDG_RUNTIME_DIR || `/run/user/${uid}`;
    
    // Check if the runtime directory exists
    if (!existsSync(xdgRuntime)) {
      return false;
    }
    
    // Try a simple systemctl --user command
    const result = spawnSync('systemctl', ['--user', 'show-environment'], {
      encoding: 'utf8',
      env: { ...process.env, XDG_RUNTIME_DIR: xdgRuntime },
      timeout: 5000,
    });
    
    return result.status === 0;
  } catch {
    return false;
  }
}

// Get environment for systemd user commands
function getSystemdUserEnv(): NodeJS.ProcessEnv {
  const uid = process.getuid?.() || execSync('id -u', { encoding: 'utf8' }).trim();
  const xdgRuntime = process.env.XDG_RUNTIME_DIR || `/run/user/${uid}`;
  const dbusAddress = process.env.DBUS_SESSION_BUS_ADDRESS || `unix:path=${xdgRuntime}/bus`;
  
  return {
    ...process.env,
    XDG_RUNTIME_DIR: xdgRuntime,
    DBUS_SESSION_BUS_ADDRESS: dbusAddress,
  };
}

function installLinuxService(config: ServiceConfig): void {
  const servicePath = getSystemdServicePath();
  const serviceDir = dirname(servicePath);

  // Ensure directory exists
  if (!existsSync(serviceDir)) {
    mkdirSync(serviceDir, { recursive: true });
  }

  // Write service file (always create it for future use)
  const serviceContent = generateSystemdService(config);
  writeFileSync(servicePath, serviceContent);
  console.log(`✅ Created service file: ${servicePath}`);

  // Check if systemd user session is available
  const systemdAvailable = isSystemdUserAvailable();
  
  if (systemdAvailable) {
    // Try with proper environment
    const env = getSystemdUserEnv();
    try {
      execSync('systemctl --user daemon-reload', { env });
      execSync(`systemctl --user enable ${SERVICE_NAME}`, { env });
      execSync(`systemctl --user start ${SERVICE_NAME}`, { env });
      console.log('✅ Service enabled and started');
      return;
    } catch (error) {
      console.log('⚠️  systemd --user commands failed, falling back to script mode');
    }
  }

  // Fallback: Create start/stop scripts
  console.log('\n⚠️  systemd user session not available (common in SSH sessions)');
  console.log('   Creating shell scripts as fallback...\n');

  const scriptsDir = join(config.dataDir, 'scripts');
  if (!existsSync(scriptsDir)) {
    mkdirSync(scriptsDir, { recursive: true });
  }

  const startScriptPath = join(scriptsDir, 'start.sh');
  const stopScriptPath = join(scriptsDir, 'stop.sh');

  writeFileSync(startScriptPath, generateStartScript(config), { mode: 0o755 });
  writeFileSync(stopScriptPath, generateStopScript(config), { mode: 0o755 });

  console.log(`✅ Created start script: ${startScriptPath}`);
  console.log(`✅ Created stop script: ${stopScriptPath}`);

  // Try to start the service using the script
  console.log('\n📦 Starting AgentStudio...');
  try {
    execSync(startScriptPath, { stdio: 'inherit' });
  } catch (error) {
    console.error('❌ Failed to start service:', error);
    throw error;
  }

  console.log('\n💡 Tips for enabling systemd user service:');
  console.log('   If you want to use systemd (auto-start on boot), run these commands:');
  console.log('');
  console.log('   # Enable lingering (allows user services to run without login)');
  console.log(`   sudo loginctl enable-linger ${process.env.USER || 'your-username'}`);
  console.log('');
  console.log('   # Then log out and log back in (to get a proper user session)');
  console.log('   # Or set the environment manually:');
  console.log(`   export XDG_RUNTIME_DIR=/run/user/$(id -u)`);
  console.log('   systemctl --user daemon-reload');
  console.log(`   systemctl --user enable ${SERVICE_NAME}`);
  console.log(`   systemctl --user start ${SERVICE_NAME}`);
}

function uninstallLinuxService(): void {
  const servicePath = getSystemdServicePath();
  const dataDir = join(homedir(), '.agentstudio');
  const scriptsDir = join(dataDir, 'scripts');
  const stopScriptPath = join(scriptsDir, 'stop.sh');
  const startScriptPath = join(scriptsDir, 'start.sh');

  // Try to stop via systemd first
  if (isSystemdUserAvailable()) {
    const env = getSystemdUserEnv();
    try {
      execSync(`systemctl --user stop ${SERVICE_NAME}`, { env });
      execSync(`systemctl --user disable ${SERVICE_NAME}`, { env });
    } catch {
      // Service might not be running
    }
  }

  // Try to stop via script as fallback
  if (existsSync(stopScriptPath)) {
    try {
      execSync(stopScriptPath, { stdio: 'inherit' });
    } catch {
      // Script might fail if not running
    }
    // Clean up scripts
    try {
      unlinkSync(startScriptPath);
      unlinkSync(stopScriptPath);
    } catch {
      // Scripts might not exist
    }
  }

  // Remove service file
  if (existsSync(servicePath)) {
    unlinkSync(servicePath);
    if (isSystemdUserAvailable()) {
      const env = getSystemdUserEnv();
      try {
        execSync('systemctl --user daemon-reload', { env });
      } catch {
        // Ignore reload errors
      }
    }
    console.log('✅ Service uninstalled');
  } else {
    console.log('ℹ️  Service is not installed');
  }
}

function linuxServiceAction(action: string): void {
  const dataDir = join(homedir(), '.agentstudio');
  const scriptsDir = join(dataDir, 'scripts');
  const startScriptPath = join(scriptsDir, 'start.sh');
  const stopScriptPath = join(scriptsDir, 'stop.sh');
  const pidFile = join(dataDir, 'agentstudio.pid');
  const logDir = join(dataDir, 'logs');

  const useSystemd = isSystemdUserAvailable();
  const hasScripts = existsSync(startScriptPath) && existsSync(stopScriptPath);

  // Helper to check script-mode process status
  const getScriptModeStatus = (): { running: boolean; pid?: string } => {
    if (existsSync(pidFile)) {
      const pid = readFileSync(pidFile, 'utf8').trim();
      try {
        process.kill(parseInt(pid), 0);
        return { running: true, pid };
      } catch {
        return { running: false };
      }
    }
    return { running: false };
  };

  switch (action) {
    case 'start':
      if (useSystemd) {
        const env = getSystemdUserEnv();
        try {
          execSync(`systemctl --user start ${SERVICE_NAME}`, { env });
          console.log('✅ Service started');
          return;
        } catch {
          console.log('⚠️  systemd start failed, trying script mode...');
        }
      }
      if (hasScripts) {
        execSync(startScriptPath, { stdio: 'inherit' });
      } else {
        console.log('❌ No start method available. Run "agentstudio install" first.');
      }
      break;

    case 'stop':
      if (useSystemd) {
        const env = getSystemdUserEnv();
        try {
          execSync(`systemctl --user stop ${SERVICE_NAME}`, { env });
          console.log('✅ Service stopped');
          return;
        } catch {
          console.log('⚠️  systemd stop failed, trying script mode...');
        }
      }
      if (hasScripts) {
        execSync(stopScriptPath, { stdio: 'inherit' });
      } else if (existsSync(pidFile)) {
        // Direct kill if no script but pid file exists
        const pid = readFileSync(pidFile, 'utf8').trim();
        try {
          process.kill(parseInt(pid));
          unlinkSync(pidFile);
          console.log('✅ Service stopped');
        } catch {
          console.log('⚪ Service is not running');
        }
      } else {
        console.log('⚪ Service is not running');
      }
      break;

    case 'restart':
      if (useSystemd) {
        const env = getSystemdUserEnv();
        try {
          execSync(`systemctl --user restart ${SERVICE_NAME}`, { env });
          console.log('✅ Service restarted');
          return;
        } catch {
          console.log('⚠️  systemd restart failed, trying script mode...');
        }
      }
      if (hasScripts) {
        try { execSync(stopScriptPath, { stdio: 'inherit' }); } catch { /* ignore */ }
        execSync(startScriptPath, { stdio: 'inherit' });
      } else {
        console.log('❌ No restart method available. Run "agentstudio install" first.');
      }
      break;

    case 'status':
      if (useSystemd) {
        const env = getSystemdUserEnv();
        try {
          execSync(`systemctl --user status ${SERVICE_NAME}`, { stdio: 'inherit', env });
          return;
        } catch {
          // Status might fail, fall through to script mode check
        }
      }
      // Script mode status check
      const status = getScriptModeStatus();
      if (status.running) {
        console.log(`✅ AgentStudio is running (PID: ${status.pid})`);
      } else {
        console.log('⚪ AgentStudio is not running');
      }
      break;

    case 'logs':
      if (useSystemd) {
        const env = getSystemdUserEnv();
        try {
          execSync(`journalctl --user -u ${SERVICE_NAME} -n 50 --no-pager`, { stdio: 'inherit', env });
          return;
        } catch {
          console.log('⚠️  journalctl failed, trying log files...');
        }
      }
      // Script mode logs
      const stdoutLog = join(logDir, 'stdout.log');
      const stderrLog = join(logDir, 'stderr.log');
      
      console.log('\n📋 Standard Output (last 50 lines):');
      if (existsSync(stdoutLog)) {
        try {
          execSync(`tail -50 "${stdoutLog}"`, { stdio: 'inherit' });
        } catch { /* ignore */ }
      } else {
        console.log('(no logs yet)');
      }
      
      console.log('\n📋 Standard Error (last 20 lines):');
      if (existsSync(stderrLog)) {
        try {
          execSync(`tail -20 "${stderrLog}"`, { stdio: 'inherit' });
        } catch { /* ignore */ }
      } else {
        console.log('(no errors)');
      }
      break;
  }
}

// =============================================================================
// Windows Support (basic instructions)
// =============================================================================

function installWindowsService(config: ServiceConfig): void {
  console.log('\n📘 Windows Service Installation\n');
  console.log('Windows service installation requires additional tools.');
  console.log('Here are your options:\n');

  console.log('Option 1: Use Task Scheduler (Recommended for personal use)');
  console.log('-----------------------------------------------------------');
  console.log('1. Open Task Scheduler (taskschd.msc)');
  console.log('2. Click "Create Basic Task"');
  console.log('3. Name: AgentStudio');
  console.log(`4. Trigger: "When the computer starts"`);
  console.log(`5. Action: Start a program`);
  console.log(`   Program: ${getNodePath()}`);
  console.log(`   Arguments: ${getExecutablePath()} start --port ${config.port}`);
  console.log(`   Start in: ${homedir()}\n`);

  console.log('Option 2: Use NSSM (Non-Sucking Service Manager)');
  console.log('------------------------------------------------');
  console.log('1. Download NSSM from https://nssm.cc/');
  console.log('2. Run: nssm install AgentStudio');
  console.log(`3. Path: ${getNodePath()}`);
  console.log(`4. Arguments: ${getExecutablePath()} start --port ${config.port}\n`);

  console.log('Option 3: Use pm2 (Cross-platform process manager)');
  console.log('--------------------------------------------------');
  console.log('npm install -g pm2');
  console.log(`pm2 start ${getExecutablePath()} -- start --port ${config.port}`);
  console.log('pm2 save');
  console.log('pm2 startup\n');
}

// =============================================================================
// Public API
// =============================================================================

export function installService(options: { port?: number; dataDir?: string } = {}): void {
  const config: ServiceConfig = {
    port: options.port || DEFAULT_PORT,
    dataDir: options.dataDir || join(homedir(), '.agentstudio'),
  };

  // Ensure data directory exists
  if (!existsSync(config.dataDir)) {
    mkdirSync(config.dataDir, { recursive: true });
  }

  console.log('\n🔧 Installing AgentStudio as system service...\n');
  console.log(`   Port: ${config.port}`);
  console.log(`   Data directory: ${config.dataDir}`);
  console.log('');

  const os = platform();

  switch (os) {
    case 'darwin':
      installMacOSService(config);
      break;
    case 'linux':
      installLinuxService(config);
      break;
    case 'win32':
      installWindowsService(config);
      return; // Don't print the success message for Windows
    default:
      console.error(`❌ Unsupported operating system: ${os}`);
      process.exit(1);
  }

  console.log('\n🎉 Installation complete!\n');
  console.log(`   Access AgentStudio at: http://localhost:${config.port}`);
  console.log('   Data stored in: ' + config.dataDir);
  console.log('\n   Manage the service with:');
  console.log('     agentstudio service status');
  console.log('     agentstudio service stop');
  console.log('     agentstudio service restart');
  console.log('     agentstudio service logs');
  console.log('');
}

export function uninstallService(): void {
  console.log('\n🔧 Uninstalling AgentStudio service...\n');

  const os = platform();

  switch (os) {
    case 'darwin':
      uninstallMacOSService();
      break;
    case 'linux':
      uninstallLinuxService();
      break;
    case 'win32':
      console.log('Please manually remove the service using Task Scheduler or NSSM.');
      return;
    default:
      console.error(`❌ Unsupported operating system: ${os}`);
      process.exit(1);
  }
}

export function serviceAction(action: string): void {
  const os = platform();

  const validActions = ['start', 'stop', 'restart', 'status', 'logs'];
  if (!validActions.includes(action)) {
    console.error(`❌ Unknown action: ${action}`);
    console.log('Valid actions: ' + validActions.join(', '));
    process.exit(1);
  }

  switch (os) {
    case 'darwin':
      macOSServiceAction(action);
      break;
    case 'linux':
      linuxServiceAction(action);
      break;
    case 'win32':
      console.log('Please use Task Scheduler or your installed service manager to manage the service.');
      break;
    default:
      console.error(`❌ Unsupported operating system: ${os}`);
      process.exit(1);
  }
}

export function isServiceInstalled(): boolean {
  const os = platform();

  switch (os) {
    case 'darwin':
      return existsSync(getLaunchdPlistPath());
    case 'linux':
      // Check both systemd service file and script-mode installation
      const hasServiceFile = existsSync(getSystemdServicePath());
      const scriptsDir = join(homedir(), '.agentstudio', 'scripts');
      const hasScripts = existsSync(join(scriptsDir, 'start.sh'));
      return hasServiceFile || hasScripts;
    default:
      return false;
  }
}
