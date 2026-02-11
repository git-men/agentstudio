# Marketplace Skills API

Marketplace Skills API 提供了对 marketplace 中 skill 的细粒度管理能力。与原有的 Plugin 级别的 enable/disable 不同，此 API 支持**单个 skill 级别**的启用和禁用。

## 概述

### 背景

AgentStudio 的 Plugin/Marketplace 系统中，一个 Plugin 可以包含多个 Skills。原有的管理方式只能在 Plugin 级别整体启用或禁用，所有 skills 要么全部安装，要么全部卸载。

Marketplace Skills API 提供了更细粒度的控制，允许用户：
- 按分类（Plugin）分组查看所有可用的 skills
- 启用/禁用单个 skill
- 批量启用/禁用
- 一键全选/取消全选某个分组

### 核心概念

| 概念 | 说明 |
|------|------|
| **Skill ID** | 格式：`marketplaceName/pluginName/skillName`，唯一标识一个 skill |
| **分组（Group）** | 以 Plugin 为分组单位，Plugin 的 description 或 name 作为分组名称 |
| **启用状态** | 通过检查目标目录中是否存在对应的 skill 目录/symlink 来判断 |
| **启用机制** | claude-sdk 引擎使用 symlink，cursor-cli 引擎使用文件复制 |

### 架构关系

```
Marketplace
  └── Plugin A（分组 A）
  │     ├── Skill 1  ✅ enabled
  │     ├── Skill 2  ❌ disabled
  │     └── Skill 3  ✅ enabled
  └── Plugin B（分组 B）
        ├── Skill 4  ✅ enabled
        └── Skill 5  ❌ disabled
```

---

## API 端点

所有端点都需要认证（`authMiddleware`）。

### 1. 获取所有 Skills（分组列表）

```
GET /api/marketplace-skills
GET /api/marketplace-skills?search=xxx
```

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `search` | string | 否 | 搜索关键词，匹配 skill 名称、描述、plugin 名、marketplace 名 |

**响应示例：**

```json
{
  "totalCount": 56,
  "enabledCount": 6,
  "groups": [
    {
      "name": "图像生成",
      "pluginName": "image-generation",
      "marketplaceName": "vibe-gaming",
      "description": "图像生成相关技能",
      "totalCount": 8,
      "enabledCount": 2,
      "skills": [
        {
          "id": "vibe-gaming/image-generation/room-style-transfer",
          "name": "room-style-transfer",
          "description": "室内场景资产风格转换",
          "enabled": true,
          "pluginName": "image-generation",
          "marketplaceName": "vibe-gaming"
        },
        {
          "id": "vibe-gaming/image-generation/2d-game-style-transfer",
          "name": "2d-game-style-transfer",
          "description": "2D 游戏资产风格转换",
          "enabled": false,
          "pluginName": "image-generation",
          "marketplaceName": "vibe-gaming"
        }
      ]
    },
    {
      "name": "音乐音效",
      "pluginName": "music-effects",
      "marketplaceName": "vibe-gaming",
      "description": "游戏场景背景与音乐生成",
      "totalCount": 1,
      "enabledCount": 0,
      "skills": [
        {
          "id": "vibe-gaming/music-effects/game-bgm",
          "name": "game-bgm",
          "description": "游戏场景背景与音乐",
          "enabled": false,
          "pluginName": "music-effects",
          "marketplaceName": "vibe-gaming"
        }
      ]
    }
  ]
}
```

---

### 2. 切换单个 Skill

```
POST /api/marketplace-skills/toggle
```

**请求体：**

```json
{
  "skillId": "vibe-gaming/image-generation/room-style-transfer",
  "enabled": true
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `skillId` | string | 是 | Skill ID（格式：`marketplace/plugin/skill`） |
| `enabled` | boolean | 是 | `true` 启用，`false` 禁用 |

**响应示例：**

```json
{
  "success": true,
  "skillId": "vibe-gaming/image-generation/room-style-transfer",
  "enabled": true
}
```

**错误响应：**

```json
{
  "success": false,
  "skillId": "vibe-gaming/image-generation/room-style-transfer",
  "enabled": false,
  "error": "Skill not found"
}
```

---

### 3. 批量切换

```
POST /api/marketplace-skills/batch
```

**请求体：**

```json
{
  "actions": [
    { "skillId": "vibe-gaming/image-generation/room-style-transfer", "enabled": true },
    { "skillId": "vibe-gaming/image-generation/2d-game-style-transfer", "enabled": true },
    { "skillId": "vibe-gaming/music-effects/game-bgm", "enabled": false }
  ]
}
```

**响应示例：**

```json
{
  "results": [
    { "success": true, "skillId": "vibe-gaming/image-generation/room-style-transfer", "enabled": true },
    { "success": true, "skillId": "vibe-gaming/image-generation/2d-game-style-transfer", "enabled": true },
    { "success": true, "skillId": "vibe-gaming/music-effects/game-bgm", "enabled": false }
  ],
  "successCount": 3,
  "failCount": 0
}
```

---

### 4. 全选/取消全选分组

#### 启用分组内所有 Skills

```
POST /api/marketplace-skills/group/:marketplaceName/:pluginName/enable-all
```

**路径参数：**

| 参数 | 说明 |
|------|------|
| `marketplaceName` | Marketplace 名称 |
| `pluginName` | Plugin 名称 |

**响应示例：**

```json
{
  "results": [
    { "success": true, "skillId": "vibe-gaming/image-generation/room-style-transfer", "enabled": true },
    { "success": true, "skillId": "vibe-gaming/image-generation/2d-game-style-transfer", "enabled": true }
  ],
  "successCount": 8,
  "failCount": 0,
  "message": "Enabled 8 skills in image-generation"
}
```

#### 禁用分组内所有 Skills

```
POST /api/marketplace-skills/group/:marketplaceName/:pluginName/disable-all
```

响应格式同上。

---

## 前端集成

### React Hooks

所有 hooks 位于 `frontend/src/hooks/useMarketplaceSkills.ts`：

```typescript
import {
  useMarketplaceSkills,
  useToggleMarketplaceSkill,
  useBatchToggleMarketplaceSkills,
  useToggleMarketplaceSkillGroup,
} from '../hooks/useMarketplaceSkills';
```

#### useMarketplaceSkills

获取分组列表：

```tsx
const { data, isLoading, error } = useMarketplaceSkills(searchText);

// data.totalCount    - 总 skill 数
// data.enabledCount  - 已启用数
// data.groups        - 分组列表
```

#### useToggleMarketplaceSkill

单个 skill 切换：

```tsx
const toggleMutation = useToggleMarketplaceSkill();

// 启用
toggleMutation.mutate({ skillId: 'vibe-gaming/image-generation/room-style-transfer', enabled: true });

// 禁用
toggleMutation.mutate({ skillId: 'vibe-gaming/image-generation/room-style-transfer', enabled: false });
```

#### useBatchToggleMarketplaceSkills

批量切换：

```tsx
const batchMutation = useBatchToggleMarketplaceSkills();

batchMutation.mutate([
  { skillId: 'vibe-gaming/image-generation/room-style-transfer', enabled: true },
  { skillId: 'vibe-gaming/image-generation/2d-game-style-transfer', enabled: true },
]);
```

#### useToggleMarketplaceSkillGroup

整组切换（全选/取消全选）：

```tsx
const groupMutation = useToggleMarketplaceSkillGroup();

// 全选
groupMutation.mutate({
  marketplaceName: 'vibe-gaming',
  pluginName: 'image-generation',
  enabled: true,
});

// 取消全选
groupMutation.mutate({
  marketplaceName: 'vibe-gaming',
  pluginName: 'image-generation',
  enabled: false,
});
```

### API 客户端

直接使用 API 客户端（位于 `frontend/src/api/marketplaceSkills.ts`）：

```typescript
import { marketplaceSkillsAPI } from '../api/marketplaceSkills';

// 获取分组列表
const data = await marketplaceSkillsAPI.getGroupedSkills('图像');

// 切换单个
await marketplaceSkillsAPI.toggleSkill('vibe-gaming/image-generation/room-style-transfer', true);

// 批量
await marketplaceSkillsAPI.batchToggle([
  { skillId: '...', enabled: true },
  { skillId: '...', enabled: false },
]);

// 全选/取消全选
await marketplaceSkillsAPI.enableAllInGroup('vibe-gaming', 'image-generation');
await marketplaceSkillsAPI.disableAllInGroup('vibe-gaming', 'image-generation');
```

---

## 技术细节

### 启用/禁用实现

| 引擎 | 启用操作 | 禁用操作 | 检查状态 |
|------|---------|---------|---------|
| **claude-sdk** | 创建 symlink: `~/.claude/skills/<name>` → `<plugin>/skills/<name>/` | 删除 symlink | `fs.existsSync(symlinkPath)` |
| **cursor-cli** | 复制目录: `<plugin>/skills/<name>/` → `~/.cursor/skills-cursor/<name>/` | 删除目录 | `fs.existsSync(targetPath)` |

### 安全机制

- **用户自建 skill 保护**：在 claude-sdk 模式下，如果目标路径不是 symlink（而是用户自建的普通目录），disable 操作会被拒绝并返回错误
- **幂等操作**：重复启用已启用的 skill 会先删除旧的 symlink/目录再重新创建，保证状态一致
- **认证保护**：所有接口都需要通过 `authMiddleware` 认证

### 与现有 Plugin 系统的关系

| 维度 | Plugin API (`/api/plugins`) | Marketplace Skills API (`/api/marketplace-skills`) |
|------|----------------------------|--------------------------------------------------|
| 操作粒度 | Plugin 级别 | Skill 级别 |
| 包含组件 | commands, agents, skills, hooks, mcp | 仅 skills |
| 启用/禁用 | 整体（所有组件一起） | 单个 skill 独立控制 |
| 适用场景 | Plugin 管理（安装、卸载、同步） | 技能配置（选择性启用/禁用） |

两套 API 共存、互补：
- Plugin API 负责 marketplace 的同步、Plugin 的安装卸载
- Marketplace Skills API 负责已安装 Plugin 中 skills 的细粒度管理

---

## 文件索引

| 文件 | 说明 |
|------|------|
| `backend/src/services/marketplaceSkillService.ts` | 核心服务：扫描、分组、启用/禁用逻辑 |
| `backend/src/routes/marketplaceSkills.ts` | API 路由定义 |
| `backend/src/index.ts` | 路由注册（`/api/marketplace-skills`） |
| `frontend/src/api/marketplaceSkills.ts` | 前端 API 客户端 |
| `frontend/src/hooks/useMarketplaceSkills.ts` | React Query hooks |
