import { execSync } from "child_process";
import { resolve, dirname } from "path";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..", "..");
const tauriDir = resolve(root, "desktop", "src-tauri");

const isWin = process.platform === "win32";
const pnpm = isWin ? "pnpm.cmd" : "pnpm";

// 0. 从 versions.json 注入当前平台版本到 tauri.conf.json
const platformKey = (() => {
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "darwin-aarch64" : "darwin-x86_64";
  }
  if (process.platform === "win32") return "windows-x86_64";
  throw new Error(`不支持的平台: ${process.platform}`);
})();

const versionsPath = resolve(tauriDir, "versions.json");
const versions = JSON.parse(readFileSync(versionsPath, "utf-8"));
const platformVersion = versions[platformKey];
if (!platformVersion) {
  throw new Error(`versions.json 中未找到平台 ${platformKey} 的版本号`);
}

const tauriConfPath = resolve(tauriDir, "tauri.conf.json");
const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf-8"));
if (tauriConf.version !== platformVersion) {
  console.log(
    `🔄 注入版本: ${tauriConf.version} → ${platformVersion} (${platformKey})`
  );
  tauriConf.version = platformVersion;
  writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n");
} else {
  console.log(`✅ 版本已匹配: ${platformVersion} (${platformKey})`);
}

// 1. 构建 sidecar
console.log("📦 构建 sidecar...");
const sidecarScript = resolve(__dirname, "build-sidecar.mjs");
execSync(`node "${sidecarScript}"`, {
  cwd: resolve(root, "desktop", "src-tauri"),
  stdio: "inherit",
});

// 2. 构建 frontend（设置 VITE_TAURI=true）
console.log("🔨 构建 frontend...");
execSync(`${pnpm} --filter frontend build`, {
  cwd: root,
  env: { ...process.env, VITE_TAURI: "true" },
  stdio: "inherit",
});

console.log("✅ 构建完成");
