# 消息渠道管理 — Plan

## 架构图

```
agentstudio/frontend/src/
│
├── pages/
│   └── IMChannelsPage.tsx          [NEW] 消息渠道管理全页面
│
├── components/
│   └── ProjectIMChannelsModal.tsx  [NEW] 项目工作区绑定渠道查看 Modal
│
├── components/workspace/
│   └── ProjectToolbar.tsx          [MODIFY] 新增 onIMChannels 回调和按钮
│
├── pages/
│   └── ProjectWorkspacePage.tsx    [MODIFY] 绑定 IMChannels Modal 状态
│
├── components/
│   └── Sidebar.tsx                 [MODIFY] 新增「消息渠道」导航项
│
├── App.tsx                         [MODIFY] 注册 /im-channels 路由
│
└── i18n/locales/{zh-CN,en-US}/
    └── pages.json                  [MODIFY] 新增 nav.imChannels 翻译键
```

## 里程碑

### M1: 新建 IMChannelsPage 全页面 (约 1h)

**目标**: 创建 `/im-channels` 路由对应的页面，展示三平台所有绑定。

**实现要点**:
- 页面用 Tab 或 Section 区分三平台（wecom/qqbot/weixin）
- 每个平台的绑定列表从 `GET /api/im-bindings?platform=xxx` 获取
- 提取 `IMBinding`/`IMChannel` 类型定义（与 IMBindingModal 共享）
- 管理操作（rename/delete/add channel）直接在页面内联完成，复用 IMBindingModal 的 API 逻辑
- 「新绑定」按钮 → navigate 到对应平台的 bind 页面（`/wecom-bind`、`/qqbot-bind`、`/wechat-bind`）
- 用 `DashboardShell` 包裹，保持页面风格一致

**验证**:
```bash
# TypeScript 检查
cd /Users/kongjie/projects/agent-studio/agentstudio && pnpm run type-check 2>&1 | tail -5
```

---

### M2: 注册路由 + 侧边栏菜单项 (约 30min)

**目标**: 让「消息渠道」出现在左侧导航，并可跳转。

**实现要点**:
- `App.tsx`: 懒加载 `IMChannelsPage`，注册 `/im-channels` 路由，加 `ProtectedRoute` + `PageGate`（module: `manage.im-channels`，或不加 module 限制，保持开放）
- `Sidebar.tsx`: 在 `getNavigationItems` 中新增一项，icon 用 `MessageSquare`，href `/im-channels`，name `t('nav.imChannels')`
- `pages.json` (zh-CN + en-US): 新增 `"imChannels": "消息渠道"` / `"imChannels": "IM Channels"`

**验证**:
```bash
# 启动后访问 /im-channels 不报错，Sidebar 能看到新菜单项
# TypeScript check
cd /Users/kongjie/projects/agent-studio/agentstudio && pnpm run type-check 2>&1 | tail -5
```

---

### M3: ProjectWorkspace 工具栏 IM 渠道入口 (约 1h)

**目标**: 项目工作区工具栏新增「IM 渠道」按钮，弹出轻量 Modal 显示当前项目绑定。

**实现要点**:
- 新建 `ProjectIMChannelsModal.tsx`：
  - Props: `{ projectPath: string; isOpen: boolean; onClose: () => void }`
  - 调用 `GET /api/im-bindings` 获取全部绑定，按 `project_path` 过滤出当前项目的绑定
  - 以只读视图展示（平台、Bot名称、已关联 chatID 列表）
  - 每条绑定下方提供「前往管理」按钮 → navigate 到 `/im-channels`
- `ProjectToolbar.tsx`：新增 `onIMChannels?: () => void` prop 和按钮（icon: `MessageSquare`，label: `IM渠道`）
- `ProjectWorkspacePage.tsx`：新增 `showIMChannelsModal` state，传入 toolbar，渲染 modal

**验证**:
```bash
# TypeScript check
cd /Users/kongjie/projects/agent-studio/agentstudio && pnpm run type-check 2>&1 | tail -5
```

---

### M4: 质量检查 + lint (约 15min)

**验证**:
```bash
cd /Users/kongjie/projects/agent-studio/agentstudio
pnpm run lint 2>&1 | tail -20
pnpm run type-check 2>&1 | tail -10
```

## 决策记录

| 决策 | 选项 A | 选项 B | 结论 |
|------|--------|--------|------|
| IMChannelsPage 布局 | Tab 切换三平台 | 三个展开 Section | 选 Section，一屏看全所有绑定 |
| 项目工作区入口 | Modal 弹出 | 右侧面板 | 选 Modal，保持轻量，不占布局 |
| 类型定义位置 | 从 IMBindingModal.tsx 提取到 types/ | 直接在 IMChannelsPage 重复定义 | 提取到 `types/im.ts`，两处共用 |
| 是否加 requireModule | 加 | 不加 | 不加（与 wecom-bind 等现有路由一致，无 module 限制） |
