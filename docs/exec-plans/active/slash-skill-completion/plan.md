# Plan: Slash Skill Completion

## 架构设计

```
用户输入 "/"
      │
      ▼
┌─────────────────────┐
│ useCommandCompletion │  ← 新增: 获取 skills 并转为 SkillSlashItem
│  allCommands = [     │
│    ...systemCmds,    │
│    ...projectCmds,   │
│    ...userCmds,      │
│    ...userSkills,    │  ← NEW
│    ...projectSkills  │  ← NEW
│  ]                   │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  CommandSelector     │  ← 新增: 类型标签 badge (命令/技能)
│  - 系统命令组        │
│  - 项目命令组        │
│  - 用户命令组        │
│  - 用户技能组 (NEW)  │
│  - 项目技能组 (NEW)  │
└─────────┬───────────┘
          │ 选中
          ▼
┌─────────────────────┐
│  useMessageSender    │  ← 新增: skill 检测 + SKILL.md 内容获取
│  isSkill ? fetch()   │
│    → formatSkillMsg  │
│    → send            │
└─────────────────────┘
```

## 里程碑

### M1: Skills 展示在 Slash 下拉中（类型 + UI + Hook）

**变更范围：**
- `commandHandler.ts`: 新增 `SkillSlashItem` 接口
- `commandFormatter.ts`: 扩展 `CommandType`，新增 `formatSkillMessage`
- `useCommandCompletion.ts`: 获取 skills、合并 allCommands、更新 isCommandDefined
- `CommandSelector.tsx`: 渲染 skills 项 + 类型 badge
- i18n: 添加 "命令" / "技能" 标签翻译

**验证命令：**
```bash
cd agentstudio/frontend && npx tsc --noEmit
```

**E2E 覆盖：** not-needed
**E2E 判定依据：** 纯 UI 展示变更，无认证流程/数据持久化/API 行为变更

### M2: Skill 发送逻辑

**变更范围：**
- `useMessageSender.ts`: 检测 skill → 获取内容 → 格式化发送
- `commandFormatter.ts`: `formatSkillMessage` 实现

**验证命令：**
```bash
cd agentstudio/frontend && npx tsc --noEmit
```

**E2E 覆盖：** not-needed
**E2E 判定依据：** 发送格式为纯文本消息，复用已有消息发送管道，无新 API endpoint
