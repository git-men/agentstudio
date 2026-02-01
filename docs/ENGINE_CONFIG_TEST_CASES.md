# Engine Configuration Feature - AI Browser MCP Test Cases

本文档为 AI 使用浏览器 MCP 进行自动化测试设计，包含精确的操作步骤和验证断言。

## 测试环境

### 服务地址

**重要**: 端口 4200 是系统服务端口，测试使用专用端口避免冲突。

| 引擎 | 地址 | 启动命令 |
|------|------|----------|
| Claude SDK | `http://127.0.0.1:4210` | `ENGINE=claude-sdk PORT=4210 pnpm run dev` |
| Cursor CLI | `http://127.0.0.1:4211` | `ENGINE=cursor-cli PORT=4211 pnpm run dev` |

### 测试数据命名规则

所有测试数据使用格式：`_test_{timestamp}_{name}`

例如：`_test_1706745600_mcp_server`

### 通用操作

#### 登录（如需要）
```
1. 导航到: {BASE_URL}/login
2. 输入用户名和密码
3. 点击登录按钮
4. 等待: URL 变为 {BASE_URL}/dashboard 或 侧边栏可见
```

#### 截图命名规则
```
{TC_ID}_{step}_{timestamp}.png
例如: TC-3.2_after_create_1706745600.png
```

---

## 1. 引擎配置 API 测试

### TC-1.1 验证 Claude SDK 引擎配置

```yaml
engine: claude-sdk
base_url: http://127.0.0.1:4210

steps:
  - action: api_call
    method: GET
    url: "{base_url}/api/engine"
    
assertions:
  - json_path: "$.engine"
    equals: "claude-sdk"
  - json_path: "$.name"
    equals: "Claude Agent SDK"
  - json_path: "$.capabilities.features.provider"
    equals: true
  - json_path: "$.capabilities.features.hooks"
    equals: true
  - json_path: "$.capabilities.mcp.canWrite"
    equals: true
  - json_path: "$.capabilities.rules.canWrite"
    equals: true
```

### TC-1.2 验证 Cursor CLI 引擎配置

```yaml
engine: cursor-cli
base_url: http://127.0.0.1:4211

steps:
  - action: api_call
    method: GET
    url: "{base_url}/api/engine"
    
assertions:
  - json_path: "$.engine"
    equals: "cursor-cli"
  - json_path: "$.name"
    equals: "Cursor Agent CLI"
  - json_path: "$.capabilities.features.provider"
    equals: false
  - json_path: "$.capabilities.features.hooks"
    equals: false
  - json_path: "$.capabilities.mcp.canWrite"
    equals: false
  - json_path: "$.capabilities.rules.canWrite"
    equals: false
```

---

## 2. 侧边栏导航测试

### TC-2.1 Claude SDK 导航菜单验证

```yaml
engine: claude-sdk
base_url: http://127.0.0.1:4210

steps:
  - action: navigate
    url: "{base_url}/dashboard"
    wait_for: "nav[class*='sidebar'], aside"

  - action: screenshot
    name: "TC-2.1_sidebar_claude"

assertions:
  - selector: "a[href='/mcp'], nav a:has-text('MCP')"
    exists: true
  - selector: "a[href='/rules'], nav a:has-text('Rules')"
    exists: true
  - selector: "a[href='/commands'], nav a:has-text('Commands')"
    exists: true
  - selector: "a[href='/skills'], nav a:has-text('Skills')"
    exists: true
  - selector: "a[href='/scheduled-tasks'], nav a:has-text('Scheduled')"
    exists: true

  # 展开 Settings 子菜单
  - action: click
    selector: "nav a:has-text('Settings'), button:has-text('Settings')"
    wait_for: "a[href='/hooks'], nav a:has-text('Hooks')"

  - selector: "a[href='/hooks'], nav a:has-text('Hooks')"
    exists: true
    description: "Hooks 菜单应该在 Claude SDK 模式下可见"
```

### TC-2.2 Cursor CLI 导航菜单验证

```yaml
engine: cursor-cli
base_url: http://127.0.0.1:4211

steps:
  - action: navigate
    url: "{base_url}/dashboard"
    wait_for: "nav[class*='sidebar'], aside"

  - action: screenshot
    name: "TC-2.2_sidebar_cursor"

assertions:
  - selector: "a[href='/mcp'], nav a:has-text('MCP')"
    exists: true
  - selector: "a[href='/rules'], nav a:has-text('Rules')"
    exists: true

  # 展开 Settings 子菜单
  - action: click
    selector: "nav a:has-text('Settings'), button:has-text('Settings')"
    wait_for: 500ms

  - selector: "a[href='/hooks'], nav a:has-text('Hooks')"
    exists: false
    description: "Hooks 菜单应该在 Cursor CLI 模式下隐藏"

  - selector: "a[href*='cursor-config'], nav a:has-text('Cursor')"
    exists: true
    description: "Cursor 配置菜单应该可见"
```

---

## 3. MCP 服务管理测试

### TC-3.1 Claude SDK - MCP 页面元素验证

```yaml
engine: claude-sdk
base_url: http://127.0.0.1:4210

steps:
  - action: navigate
    url: "{base_url}/mcp"
    wait_for: "table, [class*='mcp'], h1:has-text('MCP')"

  - action: screenshot
    name: "TC-3.1_mcp_page_claude"

assertions:
  - selector: "button:has-text('Add'), button:has-text('添加'), button:has-text('Create')"
    exists: true
    description: "添加按钮应该可见"

  - selector: "button:has-text('Import'), button:has-text('导入')"
    exists: true
    description: "导入按钮应该可见"

  - selector: "text=Read-only, text=只读"
    exists: false
    description: "不应该显示只读提示"
```

### TC-3.2 Claude SDK - MCP 创建测试

```yaml
engine: claude-sdk
base_url: http://127.0.0.1:4210
test_data:
  name: "_test_{timestamp}_mcp_server"
  command: "echo"
  args: '["test-arg"]'

steps:
  - action: navigate
    url: "{base_url}/mcp"
    wait_for: "button:has-text('Add'), button:has-text('添加')"

  - action: click
    selector: "button:has-text('Add'), button:has-text('添加'), button:has-text('Create')"
    wait_for: "dialog, [role='dialog'], form"

  - action: screenshot
    name: "TC-3.2_mcp_create_dialog"

  - action: fill
    selector: "input[name='name'], input[placeholder*='name'], input[placeholder*='名称']"
    value: "{test_data.name}"

  - action: fill
    selector: "input[name='command'], input[placeholder*='command'], input[placeholder*='命令']"
    value: "{test_data.command}"

  - action: fill
    selector: "input[name='args'], textarea[name='args'], input[placeholder*='args']"
    value: "{test_data.args}"

  - action: click
    selector: "button[type='submit'], button:has-text('Save'), button:has-text('保存'), button:has-text('Create')"
    wait_for: 1000ms

  - action: screenshot
    name: "TC-3.2_after_create"

assertions:
  - selector: "text={test_data.name}"
    exists: true
    description: "新创建的 MCP 服务应该出现在列表中"
```

### TC-3.3 Claude SDK - MCP 删除测试

```yaml
engine: claude-sdk
base_url: http://127.0.0.1:4210
depends_on: TC-3.2
test_data:
  name: "{TC-3.2.test_data.name}"  # 使用 TC-3.2 创建的数据

steps:
  - action: navigate
    url: "{base_url}/mcp"
    wait_for: "text={test_data.name}"

  - action: click
    selector: "tr:has-text('{test_data.name}') button:has-text('Delete'), tr:has-text('{test_data.name}') button:has-text('删除'), tr:has-text('{test_data.name}') button[aria-label*='delete']"
    wait_for: "dialog, [role='alertdialog'], button:has-text('Confirm')"

  - action: screenshot
    name: "TC-3.3_delete_confirm"

  - action: click
    selector: "button:has-text('Confirm'), button:has-text('确认'), button:has-text('Delete')"
    wait_for: 1000ms

  - action: screenshot
    name: "TC-3.3_after_delete"

assertions:
  - selector: "text={test_data.name}"
    exists: false
    description: "删除的 MCP 服务不应该出现在列表中"
```

### TC-3.4 Cursor CLI - MCP 只读模式验证

```yaml
engine: cursor-cli
base_url: http://127.0.0.1:4211

steps:
  - action: navigate
    url: "{base_url}/mcp"
    wait_for: "table, [class*='mcp'], h1:has-text('MCP')"

  - action: screenshot
    name: "TC-3.4_mcp_readonly_cursor"

assertions:
  - selector: "text=Read-only, text=只读, [class*='readonly']"
    exists: true
    description: "应该显示只读提示"

  - selector: "button:has-text('Add'), button:has-text('添加'), button:has-text('Create')"
    exists: false
    description: "添加按钮不应该可见"

  - selector: "button:has-text('Import'), button:has-text('导入')"
    exists: false
    description: "导入按钮不应该可见"

  - selector: "button:has-text('Edit'), button:has-text('编辑')"
    exists: false
    description: "编辑按钮不应该可见"

  - selector: "button:has-text('Delete'), button:has-text('删除')"
    exists: false
    description: "删除按钮不应该可见"
```

### TC-3.5 Cursor CLI - MCP API 写入拒绝

```yaml
engine: cursor-cli
base_url: http://127.0.0.1:4211

steps:
  - action: api_call
    method: POST
    url: "{base_url}/api/mcp"
    headers:
      Content-Type: "application/json"
    body: '{"name":"test","command":"echo"}'

assertions:
  - status_code: 403
  - json_path: "$.error"
    contains: "Read-only"
```

---

## 4. Commands 管理测试

### TC-4.1 Claude SDK - Commands 创建和删除

```yaml
engine: claude-sdk
base_url: http://127.0.0.1:4210
test_data:
  name: "_test_{timestamp}_command"
  description: "Test command created by AI"
  content: "This is a test command content."

steps:
  # 导航到 Commands 页面
  - action: navigate
    url: "{base_url}/commands"
    wait_for: "button:has-text('Create'), button:has-text('添加')"

  - action: screenshot
    name: "TC-4.1_commands_page"

  # 创建新 Command
  - action: click
    selector: "button:has-text('Create'), button:has-text('添加')"
    wait_for: "dialog, [role='dialog'], form"

  - action: fill
    selector: "input[name='name'], input[placeholder*='name']"
    value: "{test_data.name}"

  - action: fill
    selector: "input[name='description'], textarea[name='description']"
    value: "{test_data.description}"

  - action: fill
    selector: "textarea[name='content'], [class*='editor'], [class*='monaco']"
    value: "{test_data.content}"

  - action: click
    selector: "button[type='submit'], button:has-text('Save'), button:has-text('保存')"
    wait_for: 1000ms

  - action: screenshot
    name: "TC-4.1_after_create"

  # 验证创建成功
  - assertion:
      selector: "text={test_data.name}"
      exists: true

  # 删除创建的 Command
  - action: click
    selector: "tr:has-text('{test_data.name}') button:has-text('Delete'), tr:has-text('{test_data.name}') button[aria-label*='delete']"
    wait_for: "dialog, [role='alertdialog']"

  - action: click
    selector: "button:has-text('Confirm'), button:has-text('确认')"
    wait_for: 1000ms

  - action: screenshot
    name: "TC-4.1_after_delete"

assertions:
  - selector: "text={test_data.name}"
    exists: false
    description: "删除后 Command 不应该存在"
```

### TC-4.2 Cursor CLI - Commands 只读模式

```yaml
engine: cursor-cli
base_url: http://127.0.0.1:4211

steps:
  - action: navigate
    url: "{base_url}/commands"
    wait_for: "table, [class*='command'], h1:has-text('Command')"

  - action: screenshot
    name: "TC-4.2_commands_readonly"

assertions:
  - selector: "text=Read-only, text=只读"
    exists: true
  - selector: "button:has-text('Create'), button:has-text('添加')"
    exists: false
  - selector: "button:has-text('Edit'), button:has-text('编辑')"
    exists: false
  - selector: "button:has-text('Delete'), button:has-text('删除')"
    exists: false
```

---

## 5. Skills 管理测试

### TC-5.1 Claude SDK - Skills 创建和删除

```yaml
engine: claude-sdk
base_url: http://127.0.0.1:4210
test_data:
  name: "_test_{timestamp}_skill"
  description: "Test skill created by AI"
  content: |
    # Test Skill
    
    This is a test skill for automated testing.

steps:
  - action: navigate
    url: "{base_url}/skills"
    wait_for: "button:has-text('Create'), button:has-text('添加')"

  - action: screenshot
    name: "TC-5.1_skills_page"

  - action: click
    selector: "button:has-text('Create'), button:has-text('添加')"
    wait_for: "dialog, [role='dialog'], form"

  - action: fill
    selector: "input[name='name']"
    value: "{test_data.name}"

  - action: fill
    selector: "input[name='description'], textarea[name='description']"
    value: "{test_data.description}"

  - action: fill
    selector: "textarea[name='content'], [class*='editor']"
    value: "{test_data.content}"

  - action: click
    selector: "button[type='submit'], button:has-text('Save')"
    wait_for: 1000ms

  - action: screenshot
    name: "TC-5.1_after_create"

  # 验证并删除
  - assertion:
      selector: "text={test_data.name}"
      exists: true

  - action: click
    selector: "tr:has-text('{test_data.name}') button:has-text('Delete'), [class*='card']:has-text('{test_data.name}') button:has-text('Delete')"
    wait_for: "dialog"

  - action: click
    selector: "button:has-text('Confirm'), button:has-text('确认')"
    wait_for: 1000ms

assertions:
  - selector: "text={test_data.name}"
    exists: false
```

### TC-5.2 Cursor CLI - Skills 只读模式

```yaml
engine: cursor-cli
base_url: http://127.0.0.1:4211

steps:
  - action: navigate
    url: "{base_url}/skills"
    wait_for: "h1:has-text('Skill')"

  - action: screenshot
    name: "TC-5.2_skills_readonly"

assertions:
  - selector: "text=Read-only, text=只读"
    exists: true
  - selector: "button:has-text('Create'), button:has-text('添加')"
    exists: false
```

---

## 6. Rules 管理测试

### TC-6.1 Claude SDK - Rules 创建和删除

```yaml
engine: claude-sdk
base_url: http://127.0.0.1:4210
test_data:
  name: "_test_{timestamp}_rule"
  description: "Test rule for AI testing"
  paths: '["src/**/*.ts", "lib/**/*.js"]'
  content: "Always follow TypeScript best practices."

steps:
  - action: navigate
    url: "{base_url}/rules"
    wait_for: "button:has-text('Create'), button:has-text('添加')"

  - action: screenshot
    name: "TC-6.1_rules_page_claude"

  # 验证页面元素
  - assertion:
      selector: "button:has-text('Create'), button:has-text('添加')"
      exists: true

  # 创建 Rule
  - action: click
    selector: "button:has-text('Create'), button:has-text('添加')"
    wait_for: "dialog, [role='dialog'], form"

  - action: screenshot
    name: "TC-6.1_create_dialog"

  - action: fill
    selector: "input[name='name']"
    value: "{test_data.name}"

  - action: fill
    selector: "input[name='description'], textarea[name='description']"
    value: "{test_data.description}"

  # 选择 scope (如果有下拉框)
  - action: click
    selector: "select[name='scope'], button:has-text('Scope'), [class*='scope']"
    optional: true
  - action: click
    selector: "option[value='global'], li:has-text('Global')"
    optional: true

  - action: fill
    selector: "input[name='paths'], textarea[name='paths']"
    value: "{test_data.paths}"
    optional: true

  - action: fill
    selector: "textarea[name='content'], [class*='editor']"
    value: "{test_data.content}"

  - action: click
    selector: "button[type='submit'], button:has-text('Save'), button:has-text('保存')"
    wait_for: 1000ms

  - action: screenshot
    name: "TC-6.1_after_create"

  # 验证创建成功
  - assertion:
      selector: "text={test_data.name}"
      exists: true

  # 删除 Rule
  - action: click
    selector: "tr:has-text('{test_data.name}') button:has-text('Delete')"
    wait_for: "dialog"

  - action: click
    selector: "button:has-text('Confirm'), button:has-text('确认')"
    wait_for: 1000ms

  - action: screenshot
    name: "TC-6.1_after_delete"

assertions:
  - selector: "text={test_data.name}"
    exists: false
```

### TC-6.2 Cursor CLI - Rules 只读模式

```yaml
engine: cursor-cli
base_url: http://127.0.0.1:4211

steps:
  - action: navigate
    url: "{base_url}/rules"
    wait_for: "h1:has-text('Rule')"

  - action: screenshot
    name: "TC-6.2_rules_readonly_cursor"

assertions:
  - selector: "text=Read-only, text=只读"
    exists: true
  - selector: "button:has-text('Create'), button:has-text('添加')"
    exists: false
  - selector: "button:has-text('Edit'), button:has-text('编辑')"
    exists: false
  - selector: "button:has-text('Delete'), button:has-text('删除')"
    exists: false
```

### TC-6.3 Cursor CLI - Rules API 写入拒绝

```yaml
engine: cursor-cli
base_url: http://127.0.0.1:4211

steps:
  - action: api_call
    method: POST
    url: "{base_url}/api/rules"
    headers:
      Content-Type: "application/json"
    body: '{"name":"test","scope":"global","content":"test"}'

assertions:
  - status_code: 403
  - json_path: "$.error"
    contains: "Read-only"
```

---

## 7. Hooks 管理测试（仅 Claude SDK）

### TC-7.1 Claude SDK - Hooks 页面和创建删除

```yaml
engine: claude-sdk
base_url: http://127.0.0.1:4210
test_data:
  event: "PreToolCall"
  command: 'echo "test hook triggered"'

steps:
  - action: navigate
    url: "{base_url}/hooks"
    wait_for: "h1:has-text('Hook'), button:has-text('Create')"

  - action: screenshot
    name: "TC-7.1_hooks_page"

  # 验证页面可访问
  - assertion:
      selector: "button:has-text('Create'), button:has-text('添加')"
      exists: true

  # 创建 Hook
  - action: click
    selector: "button:has-text('Create'), button:has-text('添加')"
    wait_for: "dialog, [role='dialog'], form"

  - action: screenshot
    name: "TC-7.1_hooks_create_dialog"

  # 选择 Event 类型
  - action: click
    selector: "select[name='event'], button[aria-label*='event'], [class*='select']:has-text('Event')"
  - action: click
    selector: "option[value='{test_data.event}'], li:has-text('{test_data.event}')"

  # 选择 Scope
  - action: click
    selector: "select[name='scope'], button[aria-label*='scope']"
    optional: true
  - action: click
    selector: "option[value='global'], li:has-text('Global')"
    optional: true

  - action: fill
    selector: "input[name='command'], textarea[name='command']"
    value: "{test_data.command}"

  - action: click
    selector: "button[type='submit'], button:has-text('Save')"
    wait_for: 1000ms

  - action: screenshot
    name: "TC-7.1_after_create"

  # 验证创建成功 - 检查表格中是否有该事件类型
  - assertion:
      selector: "td:has-text('{test_data.event}'), tr:has-text('{test_data.event}')"
      exists: true

  # 删除 Hook (找到包含我们命令的行)
  - action: click
    selector: "tr:has-text('echo') button:has-text('Delete'), tr:has-text('{test_data.event}') button[aria-label*='delete']:last-of-type"
    wait_for: "dialog"

  - action: click
    selector: "button:has-text('Confirm'), button:has-text('确认')"
    wait_for: 1000ms

  - action: screenshot
    name: "TC-7.1_after_delete"
```

### TC-7.2 Cursor CLI - Hooks 页面不可用

```yaml
engine: cursor-cli
base_url: http://127.0.0.1:4211

steps:
  - action: navigate
    url: "{base_url}/hooks"
    wait_for: 2000ms  # 等待页面加载或重定向

  - action: screenshot
    name: "TC-7.2_hooks_not_available"

assertions:
  # 应该显示不可用消息或被重定向
  - selector_any:
      - "text=not available"
      - "text=不支持"
      - "text=not supported"
      - "url!={base_url}/hooks"  # 被重定向走了
    exists: true
```

### TC-7.3 Cursor CLI - Hooks API 返回不支持

```yaml
engine: cursor-cli
base_url: http://127.0.0.1:4211

steps:
  - action: api_call
    method: GET
    url: "{base_url}/api/hooks"

assertions:
  - status_code: 400
  - json_path: "$.error"
    contains_any: ["not supported", "not available", "不支持"]
```

---

## 8. Cursor 配置页面测试

### TC-8.1 Cursor CLI - 配置页面可访问

```yaml
engine: cursor-cli
base_url: http://127.0.0.1:4211

steps:
  - action: navigate
    url: "{base_url}/settings/cursor-config"
    wait_for: "h1, h2, [class*='config']"

  - action: screenshot
    name: "TC-8.1_cursor_config_page"

assertions:
  - selector: "text=Cursor, text=配置"
    exists: true
    description: "页面应该显示 Cursor 配置相关内容"
```

### TC-8.2 Claude SDK - Cursor 配置菜单隐藏

```yaml
engine: claude-sdk
base_url: http://127.0.0.1:4210

steps:
  - action: navigate
    url: "{base_url}/settings"
    wait_for: "h1:has-text('Settings')"

  # 展开 Settings 子菜单（如果需要）
  - action: click
    selector: "nav a:has-text('Settings'), button:has-text('Settings')"
    optional: true
    wait_for: 500ms

  - action: screenshot
    name: "TC-8.2_settings_menu_claude"

assertions:
  - selector: "a[href*='cursor-config'], nav a:has-text('Cursor 配置')"
    exists: false
    description: "Cursor 配置菜单不应该在 Claude SDK 模式下显示"
```

---

## 9. 聊天界面引擎同步测试

### TC-9.1 验证聊天界面无引擎切换器

```yaml
engine: cursor-cli
base_url: http://127.0.0.1:4211

steps:
  # 首先获取一个 agent ID
  - action: navigate
    url: "{base_url}/agents"
    wait_for: "table, [class*='agent']"

  # 点击第一个 agent 进入聊天
  - action: click
    selector: "tr:first-child a, [class*='agent-card']:first-child, table tbody tr:first-child"
    wait_for: "[class*='chat'], textarea, [class*='input']"

  - action: screenshot
    name: "TC-9.1_chat_interface"

assertions:
  # 不应该有引擎下拉选择器
  - selector: "select:has-text('Claude'), select:has-text('Cursor'), button:has-text('Engine')"
    exists: false
    description: "聊天界面不应该显示引擎切换下拉框"

  # 不应该有 ChevronDown 图标在引擎名称旁边（表示可点击切换）
  - selector: "[class*='engine'] svg[class*='chevron'], button:has(text('Claude')):has(svg)"
    exists: false
```

### TC-9.2 Claude SDK - 聊天功能验证

```yaml
engine: claude-sdk
base_url: http://127.0.0.1:4210

steps:
  - action: navigate
    url: "{base_url}/agents"
    wait_for: "table, [class*='agent']"

  - action: click
    selector: "tr:first-child a, [class*='agent-card']:first-child"
    wait_for: "textarea, [class*='input']"

  - action: fill
    selector: "textarea, input[type='text'][class*='input']"
    value: "Say 'Hello Test' and nothing else."

  - action: click
    selector: "button[type='submit'], button:has-text('Send'), button:has-text('发送'), button[aria-label*='send']"
    wait_for: 5000ms  # 等待 AI 响应

  - action: screenshot
    name: "TC-9.2_chat_response"

assertions:
  - selector: "text=Hello Test, [class*='message']:has-text('Hello')"
    exists: true
    timeout: 10000ms
    description: "应该收到包含 'Hello Test' 的响应"
```

---

## 10. 跨功能测试

### TC-10.1 Scheduled Tasks 两种引擎都可用

```yaml
engines: [claude-sdk, cursor-cli]
base_urls:
  claude-sdk: http://127.0.0.1:4210
  cursor-cli: http://127.0.0.1:4211

steps:
  - action: navigate
    url: "{base_url}/scheduled-tasks"
    wait_for: "h1:has-text('Scheduled'), h1:has-text('定时')"

  - action: screenshot
    name: "TC-10.1_scheduled_tasks_{engine}"

assertions:
  - selector: "button:has-text('Create'), button:has-text('添加')"
    exists: true
    description: "两种引擎都应该能创建定时任务"
```

### TC-10.2 MCP Admin 两种引擎都可用

```yaml
engines: [claude-sdk, cursor-cli]

steps:
  - action: navigate
    url: "{base_url}/settings/mcp-admin"
    wait_for: "h1, h2"

  - action: screenshot
    name: "TC-10.2_mcp_admin_{engine}"

assertions:
  - selector: "[class*='mcp'], text=MCP"
    exists: true
```

---

## 测试执行指南

### 执行顺序

1. **环境准备**
   - 启动 Claude SDK 服务 (PORT=4200)
   - 启动 Cursor CLI 服务 (PORT=4201)

2. **执行 Claude SDK 测试** (按顺序)
   - TC-1.1, TC-2.1, TC-3.1 ~ TC-3.3, TC-4.1, TC-5.1, TC-6.1, TC-7.1, TC-8.2, TC-9.2

3. **执行 Cursor CLI 测试** (按顺序)
   - TC-1.2, TC-2.2, TC-3.4 ~ TC-3.5, TC-4.2, TC-5.2, TC-6.2 ~ TC-6.3, TC-7.2 ~ TC-7.3, TC-8.1, TC-9.1

4. **执行跨引擎测试**
   - TC-10.1, TC-10.2

### 变量替换规则

| 变量 | 说明 | 示例 |
|------|------|------|
| `{timestamp}` | 当前 Unix 时间戳 | `1706745600` |
| `{base_url}` | 当前测试的服务地址 | `http://127.0.0.1:4210` |
| `{engine}` | 当前引擎类型 | `claude-sdk` |
| `{test_data.xxx}` | 测试数据字段 | `{test_data.name}` |
| `{TC-X.X.xxx}` | 引用其他测试用例的数据 | `{TC-3.2.test_data.name}` |

### 选择器优先级

当多个选择器用逗号分隔时，按顺序尝试：
```yaml
selector: "button:has-text('Create'), button:has-text('添加'), button:has-text('新建')"
# 先尝试找 'Create'，找不到再尝试 '添加'，以此类推
```

### 错误处理

- **元素未找到**: 截图当前页面状态，记录错误，继续下一个测试
- **超时**: 增加等待时间重试一次，仍失败则记录
- **API 错误**: 记录完整响应，继续测试

### 截图保存

所有截图保存到: `test-results/screenshots/{date}/`

---

## 测试结果输出格式

```json
{
  "test_run_id": "run_1706745600",
  "timestamp": "2024-02-01T00:00:00Z",
  "results": [
    {
      "test_case": "TC-3.2",
      "engine": "claude-sdk",
      "status": "passed",
      "duration_ms": 5234,
      "screenshots": ["TC-3.2_mcp_create_dialog.png", "TC-3.2_after_create.png"],
      "test_data_used": {
        "name": "_test_1706745600_mcp_server"
      }
    },
    {
      "test_case": "TC-3.4",
      "engine": "cursor-cli", 
      "status": "failed",
      "duration_ms": 2100,
      "error": "Assertion failed: Expected 'Read-only' text not found",
      "screenshots": ["TC-3.4_mcp_readonly_cursor.png"]
    }
  ],
  "summary": {
    "total": 25,
    "passed": 24,
    "failed": 1,
    "skipped": 0
  }
}
```
