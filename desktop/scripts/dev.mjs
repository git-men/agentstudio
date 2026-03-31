import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// 项目根目录
const root = resolve(__dirname, "..", "..");

/**
 * 启动子进程，设置环境变量并继承 stdio
 */
function run(name, env, args) {
  const child = spawn("pnpm", args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: true,
  });

  child.on("error", (err) => {
    console.error(`[${name}] 启动失败:`, err.message);
  });

  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[${name}] 退出，退出码: ${code}`);
    }
  });

  return child;
}

// 启动 backend
run("backend", { PORT: "4938", TAURI_DESKTOP: "1" }, [
  "--filter",
  "agentstudio-backend",
  "run",
  "dev",
]);

// 启动 frontend
// 显式传递 --port 和 --strictPort，避免 Windows 上环境变量传递链断裂导致端口不对
run(
  "frontend",
  { PORT: "3100", VITE_API_PORT: "4938", VITE_API_BASE: "/api" },
  ["--filter", "frontend", "dev", "--port", "3100", "--strictPort"],
);
