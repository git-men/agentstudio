# 消息渠道管理 — Prompt

## 目标

用户需要独立管理已接入的 IM 消息渠道（企业微信、QQ Bot、微信），而不必依赖首页的接入向导才能看到和管理已有绑定。同时，在项目工作区页面，用户需要快速了解当前项目绑定了哪些 IM 渠道，以及对应的 chatID。

## 用户问题

目前 `agentstudio` 首页（DashboardPage）有接入消息渠道的功能，但如果用户已经完成接入，想要管理这些绑定（查看、增删 channel、修改名称），必须再次触发首页的接入流程才能打开 `IMBindingModal`。没有一个独立的「消息渠道管理」入口。

另外，在项目工作区（ProjectWorkspacePage）下，用户无法快速知道当前项目绑定了哪些 IM 渠道，需要去首页才能查看，体验割裂。

## 解决方案

1. **左侧菜单新增「消息渠道」导航项**，对应新页面 `/im-channels`，页面整合三个平台的绑定管理（复用现有 `IMBindingModal` 逻辑，但以全页面方式展示）。

2. **项目工作区工具栏新增「渠道绑定」按钮**，点击后弹出一个轻量 Popover/Modal，显示该项目（按 `project_path`）关联的所有 IM 绑定，包括平台、名称、chatID 列表。

## 完成标准

- [ ] 左侧导航出现「消息渠道」菜单项，点击跳转 `/im-channels`
- [ ] `/im-channels` 页面展示三个平台（企业微信、QQ Bot、微信）的所有绑定，支持重命名、删除、添加/删除 channel
- [ ] 项目工作区工具栏有「IM 渠道」按钮，点击展示当前项目的绑定列表（平台 + 名称 + chatID）
- [ ] 两处均支持 dark mode
- [ ] TypeScript 无类型错误，lint 通过

## 非目标

- 不新建「创建绑定」流程（新建绑定仍然走现有的 /wecom-bind 等页面，从「消息渠道」页面点击「新绑定」跳转过去）
- 不修改后端 API（已有 `/api/im-bindings` 接口足够）
- 不涉及移动端专属优化

## 硬约束

- 仅修改 `agentstudio/frontend` 目录
- 使用现有 `authFetch`、`API_BASE`、`IMBinding`/`IMChannel` 类型（从 `IMBindingModal` 提取）
- 保持与现有 Sidebar 菜单项的 `requireModule` 模式一致
- i18n：中英双语都要更新
