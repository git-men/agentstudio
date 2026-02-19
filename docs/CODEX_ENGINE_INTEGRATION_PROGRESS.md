# Codex 引擎接入进展（CLI First）

更新时间：2026-02-19

## 目标与策略

当前采用 **CLI First** 路线接入 Codex：优先打通 `codex exec --json` 与 Agent Studio 的 AGUI 事件流、会话与管理端兼容。`app-server` 形态暂不作为第一阶段接入目标。

## 已完成能力

## 1) 引擎层（Backend Engine）

- 新增 Codex 引擎模块：`backend/src/engines/codex/`
- 引擎注册与类型打通：
  - `backend/src/engines/index.ts`
  - `backend/src/engines/types.ts`
  - `backend/src/types/engine.ts`
  - `backend/src/config/engineConfig.ts`
- 完成 `codex exec --json` 事件到 AGUI 标准事件映射：
  - `backend/src/engines/codex/aguiAdapter.ts`
- 完成会话续聊与中断管理：
  - `backend/src/engines/codex/codexEngine.ts`
- 完成本地历史会话读取：
  - `backend/src/engines/codex/historyParser.ts`

## 2) Codex 本地存储结构适配

已按 `~/.codex` 目录模型接入读取能力，关键路径如下：

- `~/.codex/config.toml`
  - 解析 `mcp_servers`（TOML）
  - 管理端 MCP 页面可读展示
- `~/.codex/sessions/**.jsonl`
  - 历史会话读取与项目过滤
- `~/.codex/rules`
- `~/.codex/commands`
- `~/.codex/skills`
- `~/.codex/hooks`

说明：对 Codex / Cursor / CodeBuddy 统一按“用户本地配置源优先”处理，管理端对相关配置采用只读呈现，避免误写外部配置。

## 3) 管理端兼容（后端 API + 前端页面）

### 后端路由

- `rules`：已接入 Codex 路径与只读标记
- `commands`：已接入 Codex 路径与只读标记
- `mcp`：支持从 `config.toml` 解析读取，写操作对只读引擎拦截
- `skills`：支持只读元数据返回，写操作拦截
- `hooks`：已对 Codex 场景给出一致化不可写提示

### 前端页面

- Rules / Commands / MCP / Skills / Hooks 页面已补齐 Codex 文案、路径提示与只读态处理
- Commands 页面补齐移动端只读态，避免只读引擎下出现编辑/删除入口
- 聊天入口与引擎选择已支持 `codex` 类型映射

## 4) 端到端联调结果清单

联调环境：`ENGINE=codex-cli`，`PORT=4937`。

1. 发送
- 结果：通过
- 现象：`POST /api/agui/chat` 正常返回（示例文本返回 `OK`）

2. 会话
- 结果：通过
- 现象：可创建 session/thread，服务端维护会话状态

3. 续聊
- 结果：通过
- 现象：带同一 `sessionId` 续聊时复用同一 `threadId`，回复连续

4. 中断
- 结果：通过
- 现象：`POST /api/agui/sessions/:id/interrupt` 成功；流中出现 `RUN_ERROR` 后 `RUN_FINISHED`，符合当前中断语义

## 5) 单元测试补齐

新增测试：

- `backend/src/routes/__tests__/mcpCodexConfig.test.ts`
  - 覆盖 TOML `mcp_servers` 解析、http/stdio 场景、非法 TOML 容错
- `backend/src/routes/__tests__/skillsReadOnly.test.ts`
  - 覆盖 Codex 下 skills 只读元数据与写操作 403

既有 Codex 测试：

- `backend/src/engines/codex/__tests__/aguiAdapter.test.ts`
- `backend/src/engines/codex/__tests__/codexEngine.test.ts`
- `backend/src/engines/codex/__tests__/historyParser.test.ts`

## 6) 已知限制与下一步

- 当前以 CLI 接入为主，尚未切换到 `codex app-server` 路线。
- 管理端对 Codex 相关配置为只读策略（设计使然），后续若要支持写回，需要明确与 `~/.codex` 规范的一致性及回滚策略。
- 建议下一阶段：
  - 增加更多异常流回归测试（网络异常、CLI 不可用、权限拒绝）
  - 评估 `app-server` 接入成本与迁移窗口，再决定是否双栈支持
