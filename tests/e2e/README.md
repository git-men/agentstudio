# AgentStudio E2E Tests

API 级别的端到端测试套件。无需浏览器，直接对后端 HTTP 接口进行黑盒验证。

> 浏览器 UI 的 E2E 测试在 `frontend/tests/e2e/`（Playwright）。

## 目录结构

```
tests/e2e/
├── run.mjs               # 主入口：启动服务 → 执行 specs → 清理
├── README.md
├── helpers/
│   ├── server.mjs        # AgentStudio 后端进程管理
│   ├── mocks.mjs         # 内嵌 Mock HTTP 服务（安审 API 等）
│   ├── marketplace.mjs   # Marketplace 注册 / 安装 / 卸载辅助
│   └── assert.mjs        # 轻量断言工具
├── fixtures/
│   └── marketplace/      # 自包含 E2E 测试 marketplace（不依赖 VAG 业务目录）
│       ├── .claude-plugin/
│       │   └── marketplace.json
│       └── plugins/
│           └── content-safety/
│               ├── .claude-plugin/plugin.json
│               └── hooks/
│                   ├── hooks.json
│                   └── scripts/
│                       └── content-safety-check.js  ← 正式版 hook 脚本
└── specs/
    ├── hooks/
    │   └── safety-check.spec.mjs   # Platform Hook 安审拦截（走 Marketplace 安装流程）
    └── agents/                     # (预留) Agent Chat 场景
```

## 快速开始

```bash
# 前提：先构建后端
pnpm build:backend

# 运行全部 E2E 测试
pnpm test:e2e

# 只跑 hooks 相关 specs
pnpm test:e2e:hooks

# 只跑安审 spec
pnpm test:e2e:safety

# 自定义端口（避免与开发环境冲突）
node tests/e2e/run.mjs --port 4970 --mock-port 9970

# 过滤 spec 名称
node tests/e2e/run.mjs --spec safety-check
```

## Spec 规范

每个 spec 文件导出两个成员：

```js
// specs/xxx/my-feature.spec.mjs

export const name = 'Feature Name';   // 显示名称

export async function run(ctx) {
  const { backend, mockSafety, suite } = ctx;

  await suite.step('描述这个测试步骤', async () => {
    // 使用 backend.get() / backend.post() 发请求
    // 使用 assert / assertEqual / assertStatus 做断言
  });
}
```

### ctx 上下文对象

| 属性 | 类型 | 说明 |
|------|------|------|
| `ctx.backend` | `BackendServer` | 后端实例，提供 `.get(path)` / `.post(path, body)` |
| `ctx.mockSafety` | `MockSafetyServer` | Mock 安审服务，提供 `.requests[]` 日志 |
| `ctx.suite` | `SuiteRunner` | 步骤执行器，提供 `.step(label, fn)` |

## Fixture Marketplace 说明

`fixtures/marketplace/` 是一个**完全自包含**的测试用 marketplace，不依赖任何外部服务或路径。

- `content-safety-check.js` 是该插件的**正式版本**（即 `verticals/vag/marketplace/plugins/content-safety/hooks/scripts/content-safety-check.js` 的同步副本）。
- 如果 canonical 版本更新，请同步更新 fixture 副本，并在 commit message 中注明。
- E2E 测试通过 `MarketplaceFixture` helper 在运行时将该目录注册为 `local` 类型 marketplace，无需任何额外服务。

### MarketplaceFixture 用法

```js
import { MarketplaceFixture } from '../../helpers/marketplace.mjs';

const mp = new MarketplaceFixture(backend, { name: 'e2e-test' });
const hookIds = await mp.install('content-safety');
// ... 测试 ...
await mp.teardown();  // uninstall + remove
```

## 环境变量（后端进程）

| 变量 | 用途 |
|------|------|
| `CONTENT_SAFETY_API_URL` | content-safety 插件调用的安审 API 地址（由 run.mjs 注入 mock URL） |
| `SAFETY_CHECK_URL` | 兼容旧版 hook 脚本 |
| `NO_AUTH` | `'true'` 跳过 JWT 验证 |
| `DATA_DIR` | 隔离的临时数据目录（每次运行独立） |

## 编写新 Spec

1. 在 `specs/<category>/` 下新建 `xxx.spec.mjs`
2. 实现 `export const name` 和 `export async function run(ctx)`
3. runner 会自动发现并执行（无需注册）
4. 如需 Marketplace 流程，在 spec 内使用 `MarketplaceFixture` helper

## CI 集成

```yaml
# .github/workflows/e2e.yml 示例
- name: Build backend
  run: pnpm build:backend

- name: Run E2E tests
  run: pnpm test:e2e
  env:
    NODE_ENV: test
```

## 依赖

- Node.js ≥ 20（原生 fetch、ESM）
- 构建好的后端 `backend/dist/index.js`
- 不需要任何额外 npm 包
