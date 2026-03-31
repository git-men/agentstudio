import { execSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..", "..");

const isWin = process.platform === "win32";
const pnpm = isWin ? "pnpm.cmd" : "pnpm";

// 1. 构建 sidecar
console.log("📦 构建 sidecar...");
execSync("node ../desktop/scripts/build-sidecar.mjs", {
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
