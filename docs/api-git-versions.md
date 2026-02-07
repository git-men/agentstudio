# Git Version Management API

## 概述

基于 Git 的项目版本管理 API。每个 AgentStudio 项目可以独立管理版本，使用 Git tags 作为版本标识。

- **懒初始化**: 首次保存版本时自动初始化 Git 仓库
- **Tag 命名**: 自增序号 `v1`, `v2`, `v3`...
- **版本描述**: 存储在 commit message 和 tag annotation 中
- **不自动提交**: 所有版本创建均由用户显式触发

## Base URL

```
/api/projects/:projectId/versions
```

其中 `projectId` 为项目路径（需 URL 编码），例如:

```
/api/projects/%2FUsers%2Fkong%2Fclaude-code-projects%2Fmy-agent/versions
```

## 认证

所有接口均需要 JWT 认证（Bearer Token）。

---

## 接口列表

### 1. 获取版本列表

获取项目的所有版本（按版本号降序排列）。

```
GET /api/projects/:projectId/versions
```

#### 响应

```json
{
  "versions": [
    {
      "tag": "v3",
      "message": "添加定时提醒功能",
      "date": "2026-02-07 14:30:00 +0800",
      "hash": "a1b2c3d",
      "isCurrent": true
    },
    {
      "tag": "v2",
      "message": "配置 A2A 通信",
      "date": "2026-02-06 10:15:00 +0800",
      "hash": "e4f5g6h",
      "isCurrent": false
    },
    {
      "tag": "v1",
      "message": "初始版本",
      "date": "2026-02-05 09:00:00 +0800",
      "hash": "i7j8k9l",
      "isCurrent": false
    }
  ]
}
```

#### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `tag` | string | 版本标签，格式为 `v{number}` |
| `message` | string | 版本描述（commit message） |
| `date` | string | 创建时间（ISO 格式） |
| `hash` | string | Git commit hash（短格式） |
| `isCurrent` | boolean | 是否为当前版本（HEAD 所在） |

---

### 2. 获取版本状态

获取项目的版本管理状态（是否初始化、当前版本、是否有未保存修改等）。

```
GET /api/projects/:projectId/versions/status
```

#### 响应

```json
{
  "initialized": true,
  "currentVersion": "v3",
  "isDirty": true,
  "untrackedFiles": 2,
  "modifiedFiles": 1,
  "totalVersions": 3
}
```

#### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `initialized` | boolean | 项目是否已初始化 Git |
| `currentVersion` | string \| null | 当前版本（如果 HEAD 在某个 tag 上），无版本或有修改时为 null |
| `isDirty` | boolean | 工作区是否有未保存的修改 |
| `untrackedFiles` | number | 未追踪的新文件数量 |
| `modifiedFiles` | number | 已修改的文件数量 |
| `totalVersions` | number | 总版本数 |

---

### 3. 创建新版本

保存当前工作区状态为新版本。自动执行 `git add -A` + `git commit` + `git tag`。

如果项目尚未初始化 Git，会自动执行初始化（`git init` + 创建 `.gitignore`）。

```
POST /api/projects/:projectId/versions
```

#### 请求体

```json
{
  "message": "添加定时提醒功能"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `message` | string | 是 | 版本描述 |

#### 成功响应 (200)

```json
{
  "success": true,
  "version": {
    "tag": "v4",
    "hash": "m1n2o3p",
    "message": "添加定时提醒功能"
  }
}
```

#### 错误响应

**400 - 无修改可保存:**
```json
{
  "error": "No changes to save. The project has no modifications since the last version."
}
```

**400 - 缺少版本描述:**
```json
{
  "error": "Version message is required"
}
```

---

### 4. 切换版本

将项目切换到指定版本。执行 `git reset --hard <tag>`。

```
POST /api/projects/:projectId/versions/checkout
```

#### 请求体

```json
{
  "tag": "v2",
  "force": false
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `tag` | string | 是 | 目标版本标签，如 `v2` |
| `force` | boolean | 否 | 是否强制切换（丢弃未保存的修改），默认 `false` |

#### 成功响应 (200)

```json
{
  "success": true,
  "message": "Switched to version v2",
  "tag": "v2"
}
```

#### 错误响应

**409 - 工作区有未保存修改（force=false 时）:**
```json
{
  "error": "Working tree has uncommitted changes",
  "code": "DIRTY_WORKING_TREE",
  "message": "Please save a new version or discard changes before switching versions."
}
```

前端收到 `code: "DIRTY_WORKING_TREE"` 时，应提示用户选择：
1. 先保存为新版本，再切换
2. 放弃修改并强制切换（`force: true`）
3. 取消操作

**404 - 版本不存在:**
```json
{
  "error": "Version v99 not found"
}
```

---

### 5. 删除版本

删除指定版本的标签。注意：仅删除 Git tag，不删除对应的 commit。

```
DELETE /api/projects/:projectId/versions/:tag
```

#### 路径参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `tag` | string | 要删除的版本标签，如 `v2` |

#### 成功响应 (200)

```json
{
  "success": true,
  "message": "Version v2 deleted"
}
```

#### 错误响应

**404 - 版本不存在:**
```json
{
  "error": "Version v2 not found"
}
```

---

## .gitignore 默认规则

首次初始化时自动创建的 `.gitignore` 文件包含以下规则：

```
# AgentStudio runtime data
.cc-sessions/
.a2a/history/
.a2a/tasks/
.a2a/api-keys.json
node_modules/
.DS_Store
*.log
```

**纳入版本管理的文件：**
- `CLAUDE.md` — 项目指令
- `README.md` — 项目说明
- `.a2a/config.json` — A2A 配置
- 用户的代码和配置文件

**排除的文件：**
- `.cc-sessions/` — 会话历史
- `.a2a/history/` — A2A 对话历史
- `.a2a/tasks/` — A2A 任务数据
- `.a2a/api-keys.json` — API 密钥
- `node_modules/` — 依赖包
- 日志文件

---

## 错误码参考

| HTTP Status | 错误码 | 说明 |
|-------------|--------|------|
| 400 | - | 请求参数错误（缺少 message、无修改等） |
| 404 | - | 版本不存在 |
| 409 | `DIRTY_WORKING_TREE` | 工作区有未保存修改，需要先处理 |
| 500 | - | Git 操作失败 |

---

## 使用示例

### cURL

**创建版本:**
```bash
curl -X POST http://localhost:4100/api/projects/%2FUsers%2Fkong%2Fmy-project/versions \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message": "初始版本"}'
```

**获取版本列表:**
```bash
curl http://localhost:4100/api/projects/%2FUsers%2Fkong%2Fmy-project/versions \
  -H "Authorization: Bearer <token>"
```

**获取版本状态:**
```bash
curl http://localhost:4100/api/projects/%2FUsers%2Fkong%2Fmy-project/versions/status \
  -H "Authorization: Bearer <token>"
```

**切换版本:**
```bash
curl -X POST http://localhost:4100/api/projects/%2FUsers%2Fkong%2Fmy-project/versions/checkout \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"tag": "v1", "force": false}'
```

**删除版本:**
```bash
curl -X DELETE http://localhost:4100/api/projects/%2FUsers%2Fkong%2Fmy-project/versions/v2 \
  -H "Authorization: Bearer <token>"
```
