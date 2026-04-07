# Plan: Fix Plugin Symlink EEXIST Error

## 架构设计

单文件修改：`backend/src/services/pluginSymlink.ts`

问题在 `createSymlink` 私有方法（第 98-120 行）：

```
当前逻辑：
  existsSync(symlinkPath) → false（dangling symlink 不跟踪）
  → 直接调用 symlinkSync → EEXIST ❌

修复后逻辑：
  try lstatSync(symlinkPath)  → 检查 symlink 本身（不跟踪）
    isSymbolicLink() → 读取 target，相同则跳过，不同则 unlink + 重建
    不是 symlink → warn + skip
  catch ENOENT → 路径不存在，直接创建
  catch EEXIST（最终防线） → warn + skip（幂等）
```

## 里程碑

### M1: 修复 createSymlink 并补充测试

**变更范围：**
- `backend/src/services/pluginSymlink.ts`：将 `existsSync` 检查替换为 `lstatSync` + try/catch
- `backend/src/__tests__/pluginSymlink.test.ts`（新增或更新）：覆盖 dangling symlink 场景

**验证命令：**
```bash
cd /Users/kongjie/projects/agent-studio/agentstudio/backend
npx vitest run src/__tests__/pluginSymlink.test.ts
pnpm run lint
pnpm run type-check
```

**E2E 覆盖：** not-needed
**E2E 判定依据：** e2e-protocol Step B — "纯后端服务逻辑修复，无 UI 交互，无 API 协议变更" → 单元测试已充分覆盖
