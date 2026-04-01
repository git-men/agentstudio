import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// 项目根目录
const root = resolve(__dirname, "..", "..");

/**
 * 启动子进程，使用 pipe 模式避免多进程共享 stdio 导致的冲突
 */
function run(name, env, args) {
  const child = spawn("pnpm", args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "pipe",
    shell: true,
  });

  const prefix = `[${name}]`;

  child.stdout.on("data", (data) => {
    process.stdout.write(`${prefix} ${data}`);
  });

  child.stderr.on("data", (data) => {
    process.stderr.write(`${prefix} ${data}`);
  });

  child.on("error", (err) => {
    console.error(`${prefix} 启动失败:`, err.message);
  });

  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`${prefix} 退出，退出码: ${code}`);
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
