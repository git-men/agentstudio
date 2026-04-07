# Slash Skill Completion

## 目标

当用户在聊天输入框输入 `/` 时，除了展示现有的 commands（系统命令、项目命令、用户命令），还需同时展示可用的 skills，让用户可以通过 `/` 快捷调用 skill。

## 完成标准

1. 输入 `/` 后弹出的下拉列表同时包含 commands 和 skills
2. 每个选项有明确的类型标签区分（Command vs Skill）
3. 搜索过滤同时作用于 commands 和 skills
4. 选中 skill 后，`/skill-name` 填入输入框
5. 发送 skill 时，获取 SKILL.md 内容并作为上下文发送给 AI
6. 支持中英文 i18n

## 硬约束

- 不改变现有 command 的行为和数据流
- skills 数据复用已有的 `/api/skills` 接口
- 类型系统向后兼容（`CommandType` 扩展而非替换）

## 非目标

- 不改变 skill 的 CRUD 管理界面
- 不引入新的后端 API
- 不修改 skill 在 AI 侧的执行逻辑
