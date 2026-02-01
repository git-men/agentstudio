# Cursor CLI Tools Schema Documentation

本文档记录了通过测试 Cursor CLI (`cursor agent --output-format stream-json --stream-partial-output`) 发现的所有工具及其完整 schema。

## 概述

Cursor CLI 的工具调用通过 JSON 流式输出，格式如下：

```json
{
  "type": "tool_call",
  "subtype": "started" | "completed",
  "call_id": "tool_xxx-xxx-xxx",
  "tool_call": {
    "<toolName>ToolCall": {
      "args": { ... },
      "result": { ... }  // 仅在 subtype: "completed" 时存在
    }
  },
  "model_call_id": "xxx",
  "session_id": "xxx",
  "timestamp_ms": 1234567890123
}
```

---

## 1. `lsToolCall` - 列出目录

列出指定目录的内容和结构。

### Args Schema

```typescript
interface LsToolCallArgs {
  path: string;              // 目标目录路径
  ignore: string[];          // 忽略的模式列表
  toolCallId: string;        // 工具调用 ID
}
```

### Result Schema

```typescript
interface LsToolCallResult {
  success: {
    directoryTreeRoot: {
      absPath: string;                        // 绝对路径
      childrenDirs: DirectoryNode[];          // 子目录列表
      childrenFiles: FileNode[];              // 子文件列表
      childrenWereProcessed: boolean;         // 是否已处理子节点
      fullSubtreeExtensionCounts: Record<string, number>;  // 文件扩展名统计
      numFiles: number;                       // 文件数量
    };
  };
}

interface DirectoryNode {
  absPath: string;
  childrenDirs: DirectoryNode[];
  childrenFiles: FileNode[];
  childrenWereProcessed: boolean;
  fullSubtreeExtensionCounts: Record<string, number>;
  numFiles: number;
}

interface FileNode {
  name: string;
}
```

### 示例

```json
{
  "lsToolCall": {
    "args": {
      "path": "/Users/kongjie/projects/thor",
      "ignore": [],
      "toolCallId": "tool_xxx"
    },
    "result": {
      "success": {
        "directoryTreeRoot": {
          "absPath": "/Users/kongjie/projects/thor",
          "childrenDirs": [
            {
              "absPath": "/Users/kongjie/projects/thor/src",
              "childrenDirs": [],
              "childrenFiles": [{"name": "index.ts"}],
              "childrenWereProcessed": true,
              "fullSubtreeExtensionCounts": {".ts": 1},
              "numFiles": 1
            }
          ],
          "childrenFiles": [{"name": "package.json"}],
          "childrenWereProcessed": true,
          "fullSubtreeExtensionCounts": {".ts": 10, ".json": 2},
          "numFiles": 12
        }
      }
    }
  }
}
```

---

## 2. `readToolCall` - 读取文件

读取文件内容，支持限制行数。

### Args Schema

```typescript
interface ReadToolCallArgs {
  path: string;     // 文件路径
  limit?: number;   // 可选，限制读取的行数
}
```

### Result Schema

```typescript
interface ReadToolCallResult {
  success: {
    content: string;           // 文件内容
    isEmpty: boolean;          // 是否为空
    exceededLimit: boolean;    // 是否超过限制
    totalLines: number;        // 总行数
    fileSize: number;          // 文件大小（字节）
    path: string;              // 文件路径
    readRange: {
      startLine: number;       // 起始行（1-based）
      endLine: number;         // 结束行
    };
  };
}
```

### 示例

```json
{
  "readToolCall": {
    "args": {
      "path": "/Users/kongjie/projects/thor/CLAUDE.md",
      "limit": 10
    },
    "result": {
      "success": {
        "content": "# CLAUDE.md\n\nThis file provides guidance...",
        "isEmpty": false,
        "exceededLimit": false,
        "totalLines": 345,
        "fileSize": 13228,
        "path": "/Users/kongjie/projects/thor/CLAUDE.md",
        "readRange": {
          "startLine": 1,
          "endLine": 10
        }
      }
    }
  }
}
```

---

## 3. `editToolCall` - 创建/编辑文件

创建新文件或编辑现有文件。

### Args Schema

```typescript
interface EditToolCallArgs {
  path: string;          // 文件路径
  streamContent: string; // 新内容（用于创建或替换）
}
```

### Result Schema

```typescript
interface EditToolCallResult {
  success: {
    path: string;                      // 文件路径
    linesAdded: number;                // 添加的行数
    linesRemoved: number;              // 删除的行数
    diffString: string;                // diff 字符串（如 "-old\n+new"）
    beforeFullFileContent?: string;    // 编辑前的完整内容（编辑时存在）
    afterFullFileContent: string;      // 编辑后的完整内容
    message: string;                   // 操作消息
  };
}
```

### 示例 - 创建文件

```json
{
  "editToolCall": {
    "args": {
      "path": "/Users/kongjie/projects/thor/test.txt",
      "streamContent": "hello world\n"
    },
    "result": {
      "success": {
        "path": "/Users/kongjie/projects/thor/test.txt",
        "linesAdded": 1,
        "linesRemoved": 1,
        "diffString": "-\n+hello world",
        "afterFullFileContent": "hello world\n",
        "message": "Wrote contents to /Users/kongjie/projects/thor/test.txt"
      }
    }
  }
}
```

### 示例 - 编辑文件

```json
{
  "editToolCall": {
    "args": {
      "path": "/Users/kongjie/projects/thor/test.txt",
      "streamContent": "hi"
    },
    "result": {
      "success": {
        "path": "/Users/kongjie/projects/thor/test.txt",
        "linesAdded": 1,
        "linesRemoved": 1,
        "diffString": "-hello world\n+hi world",
        "beforeFullFileContent": "hello world\n",
        "afterFullFileContent": "hi world\n",
        "message": "The file /Users/kongjie/projects/thor/test.txt has been updated."
      }
    }
  }
}
```

---

## 4. `globToolCall` - 文件查找（Glob 模式）

按 glob 模式查找文件。

### Args Schema

```typescript
interface GlobToolCallArgs {
  targetDirectory: string;  // 目标目录
  globPattern: string;      // glob 模式（如 "*.ts", "**/package.json"）
}
```

### Result Schema

```typescript
interface GlobToolCallResult {
  success: {
    pattern: string;               // 匹配模式
    path: string;                  // 目录路径
    files: string[];               // 匹配的文件列表（相对路径）
    totalFiles: number;            // 文件总数
    clientTruncated: boolean;      // 是否被客户端截断
    ripgrepTruncated: boolean;     // 是否被 ripgrep 截断
  };
}
```

### 示例

```json
{
  "globToolCall": {
    "args": {
      "targetDirectory": "/Users/kongjie/projects/thor",
      "globPattern": "*thor*"
    },
    "result": {
      "success": {
        "pattern": "",
        "path": "/Users/kongjie/projects/thor",
        "files": [
          "thor-core/src/index.ts",
          "thor-widget/package.json"
        ],
        "totalFiles": 2,
        "clientTruncated": false,
        "ripgrepTruncated": false
      }
    }
  }
}
```

---

## 5. `grepToolCall` - 内容搜索

在文件中搜索匹配的内容。

### Args Schema

```typescript
interface GrepToolCallArgs {
  pattern: string;           // 搜索模式（正则表达式）
  path: string;              // 搜索路径
  glob?: string;             // 可选，文件 glob 过滤器
  outputMode?: "content" | "files_with_matches";  // 输出模式
  caseInsensitive: boolean;  // 是否不区分大小写
  multiline: boolean;        // 是否多行匹配
  toolCallId?: string;       // 工具调用 ID
}
```

### Result Schema

```typescript
interface GrepToolCallResult {
  success: {
    pattern: string;
    path: string;
    outputMode: string;
    workspaceResults: Record<string, WorkspaceResult>;
  };
}

interface WorkspaceResult {
  content?: {
    matches: FileMatch[];
  };
  files?: {
    files: string[];
  };
}

interface FileMatch {
  file: string;
  matches: LineMatch[];
}

interface LineMatch {
  lineNumber: number;
  content: string;
  contentTruncated: boolean;
  isContextLine: boolean;
}
```

### 示例 - 内容搜索

```json
{
  "grepToolCall": {
    "args": {
      "pattern": "export default",
      "path": "/Users/kongjie/projects/thor",
      "caseInsensitive": false,
      "multiline": false
    },
    "result": {
      "success": {
        "pattern": "export default",
        "path": "/Users/kongjie/projects/thor",
        "outputMode": "content",
        "workspaceResults": {
          "/Users/kongjie/projects/thor": {
            "content": {
              "matches": [
                {
                  "file": "./src/index.ts",
                  "matches": [
                    {
                      "lineNumber": 27,
                      "content": "export default MyComponent;",
                      "contentTruncated": false,
                      "isContextLine": false
                    }
                  ]
                }
              ]
            }
          }
        }
      }
    }
  }
}
```

---

## 6. `shellToolCall` - 执行 Shell 命令

执行 shell 命令并返回结果。

### Args Schema

```typescript
interface ShellToolCallArgs {
  command: string;               // 要执行的命令
  workingDirectory: string;      // 工作目录
  timeout: number;               // 超时时间（毫秒）
  toolCallId?: string;           // 工具调用 ID
  simpleCommands: string[];      // 简单命令列表（如 ["ls", "npm"]）
  hasInputRedirect: boolean;     // 是否有输入重定向
  hasOutputRedirect: boolean;    // 是否有输出重定向
  parsingResult: {
    parsingFailed: boolean;
    executableCommands: ExecutableCommand[];
    hasRedirects: boolean;
    hasCommandSubstitution: boolean;
  };
  fileOutputThresholdBytes: string;  // 文件输出阈值
  isBackground: boolean;         // 是否后台运行
  skipApproval: boolean;         // 是否跳过审批
  timeoutBehavior: string;       // 超时行为
}

interface ExecutableCommand {
  name: string;
  args: CommandArg[];
  fullText: string;
}

interface CommandArg {
  type: "word" | "string" | "number";
  value: string;
}
```

### Result Schema

```typescript
interface ShellToolCallResult {
  success: {
    command: string;
    workingDirectory: string;
    exitCode: number;
    signal: string;
    stdout: string;
    stderr: string;
    executionTime: number;         // 执行时间（毫秒）
    interleavedOutput: string;     // 交错输出
  };
  isBackground: boolean;
}
```

### 示例

```json
{
  "shellToolCall": {
    "args": {
      "command": "ls -la",
      "workingDirectory": "/Users/kongjie/projects/thor",
      "timeout": 30000,
      "simpleCommands": ["ls"],
      "hasInputRedirect": false,
      "hasOutputRedirect": false,
      "parsingResult": {
        "parsingFailed": false,
        "executableCommands": [
          {
            "name": "ls",
            "args": [{"type": "word", "value": "-la"}],
            "fullText": "ls -la"
          }
        ],
        "hasRedirects": false,
        "hasCommandSubstitution": false
      },
      "isBackground": false
    },
    "result": {
      "success": {
        "command": "ls -la",
        "workingDirectory": "/Users/kongjie/projects/thor",
        "exitCode": 0,
        "signal": "",
        "stdout": "total 520\ndrwxr-xr-x@ 21 kongjie  staff  672 Jan  9 15:28 .\n...",
        "stderr": "",
        "executionTime": 243,
        "interleavedOutput": "total 520\ndrwxr-xr-x@ 21 kongjie  staff  672 Jan  9 15:28 .\n..."
      },
      "isBackground": false
    }
  }
}
```

---

## 7. `updateTodosToolCall` - Todo 列表管理

管理任务列表。

### Args Schema

```typescript
interface UpdateTodosToolCallArgs {
  todos: TodoItem[];
  merge: boolean;            // 是否合并（false = 替换）
}

interface TodoItem {
  id: string;
  content: string;
  status: "TODO_STATUS_PENDING" | "TODO_STATUS_IN_PROGRESS" | "TODO_STATUS_COMPLETED";
  createdAt: string;         // 时间戳字符串
  updatedAt: string;         // 时间戳字符串
  dependencies: string[];    // 依赖的其他 todo ID
}
```

### Result Schema

```typescript
interface UpdateTodosToolCallResult {
  success: {
    todos: TodoItem[];
    totalCount: number;
    wasMerge: boolean;
  };
}
```

### 示例

```json
{
  "updateTodosToolCall": {
    "args": {
      "todos": [
        {
          "id": "1",
          "content": "检查 package.json 文件",
          "status": "TODO_STATUS_IN_PROGRESS",
          "createdAt": "1769942817550",
          "updatedAt": "1769942817550",
          "dependencies": []
        }
      ],
      "merge": false
    },
    "result": {
      "success": {
        "todos": [
          {
            "id": "1",
            "content": "检查 package.json 文件",
            "status": "TODO_STATUS_IN_PROGRESS",
            "createdAt": "1769942817550",
            "updatedAt": "1769942817550",
            "dependencies": []
          }
        ],
        "totalCount": 1,
        "wasMerge": false
      }
    }
  }
}
```

---

## 8. `listMcpResourcesToolCall` - 列出 MCP 资源

列出可用的 MCP 资源。

### Args Schema

```typescript
interface ListMcpResourcesToolCallArgs {
  // 无参数
}
```

### Result Schema

```typescript
interface ListMcpResourcesToolCallResult {
  success: {
    resources: McpResource[];
  };
}

interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}
```

### 示例

```json
{
  "listMcpResourcesToolCall": {
    "args": {},
    "result": {
      "success": {
        "resources": []
      }
    }
  }
}
```

---

## 9. `deleteToolCall` - 删除文件

删除指定路径的文件。

### Args Schema

```typescript
interface DeleteToolCallArgs {
  path: string;         // 要删除的文件路径
  toolCallId?: string;  // 工具调用 ID
}
```

### Result Schema

```typescript
interface DeleteToolCallResult {
  success?: {
    path: string;       // 已删除的文件路径
    message: string;    // 成功消息
  };
  error?: {
    path: string;       // 文件路径
    error: string;      // 错误信息（如 "File not found"）
  };
}
```

### 示例

```json
{
  "deleteToolCall": {
    "args": {
      "path": "/Users/kongjie/projects/thor/test.txt",
      "toolCallId": "tool_xxx"
    },
    "result": {
      "error": {
        "path": "",
        "error": "File not found: /Users/kongjie/projects/thor/test.txt"
      }
    }
  }
}
```

---

## 11. `webFetchToolCall` - 网页获取

从 URL 获取网页内容并转换为 Markdown 格式。

### Args Schema

```typescript
interface WebFetchToolCallArgs {
  url: string;         // 要获取的 URL
  toolCallId?: string; // 工具调用 ID
}
```

### Result Schema

```typescript
interface WebFetchToolCallResult {
  success?: {
    url: string;       // 请求的 URL
    markdown: string;  // 转换后的 Markdown 内容
  };
  error?: {
    url: string;       // 请求的 URL
    error: string;     // 错误信息
  };
}
```

### 示例

```json
{
  "webFetchToolCall": {
    "args": {
      "url": "https://api.github.com",
      "toolCallId": "tool_xxx"
    },
    "result": {
      "success": {
        "url": "https://api.github.com",
        "markdown": "{\n\"current_user_url\": \"https://api.github.com/user\",\n..."
      }
    }
  }
}
```

---

## 12. `semSearchToolCall` - 语义搜索

基于自然语言查询进行代码语义搜索。

### Args Schema

```typescript
interface SemSearchToolCallArgs {
  query: string;              // 搜索查询（自然语言）
  targetDirectories: string[]; // 目标目录列表（空数组表示搜索整个项目）
  explanation?: string;       // 可选的搜索说明
}
```

### Result Schema

```typescript
interface SemSearchToolCallResult {
  success: {
    results: string;  // 搜索结果（XML 格式的搜索结果）
  };
}
```

### 示例

```json
{
  "semSearchToolCall": {
    "args": {
      "query": "如何在项目中使用组件",
      "targetDirectories": [],
      "explanation": ""
    },
    "result": {
      "success": {
        "results": "<search_result path=\"showcase/src/App.tsx\" startLine=\"1\" endLine=\"139\">...</search_result>"
      }
    }
  }
}
```

---

## 12. `mcpToolCall` - MCP 工具调用

调用 MCP (Model Context Protocol) 服务的工具。

### Args Schema

```typescript
interface McpToolCallArgs {
  name: string;              // 完整工具名称（格式：{serverName}-{toolName}）
  args: Record<string, any>; // 工具参数
  toolCallId: string;        // 工具调用 ID
  providerIdentifier: string;// MCP 服务名称（如 "hitl-hil"）
  toolName: string;          // 工具名称（如 "send_message_only"）
}
```

### Result Schema

```typescript
interface McpToolCallResult {
  success?: {
    content: McpContent[];   // 结果内容数组
    isError: boolean;        // 是否为错误
  };
  error?: {
    error: string;           // 错误信息
  };
}

interface McpContent {
  text?: {
    text: string;            // 文本内容
  };
  image?: {
    data: string;            // Base64 图片数据
    mimeType: string;        // MIME 类型
  };
  resource?: {
    uri: string;             // 资源 URI
    text?: string;           // 资源文本
  };
}
```

### 示例

```json
{
  "mcpToolCall": {
    "args": {
      "name": "hitl-hil-send_message_only",
      "args": {
        "message": "Hello from Cursor CLI MCP test!"
      },
      "toolCallId": "toolu_bdrk_013P55a6hBd4ksqBwLLYSnLH",
      "providerIdentifier": "hitl-hil",
      "toolName": "send_message_only"
    },
    "result": {
      "success": {
        "content": [
          {
            "text": {
              "text": "{\"status\": \"success\", \"message\": \"消息发送成功\"}"
            }
          }
        ],
        "isError": false
      }
    }
  }
}
```

---

## 待发现/不存在的工具

以下工具经过测试，发现可能不存在或有替代方案：

- ~~`callMcpToolToolCall`~~ - Cursor CLI 没有通用的 MCP 工具调用接口
- ~~`fetchMcpResourceToolCall`~~ - 需要通过 `listMcpResourcesToolCall` 查看可用资源
- ~~`askQuestionToolCall`~~ - Cursor 通过文本直接向用户提问，没有专门的工具
- ~~`taskToolCall`~~ - Cursor 没有单独的子任务工具，而是通过并行调用基础工具实现

---

## 工具名称映射

AgentStudio 前端需要将 Cursor 工具名称映射到相应的组件：

| Cursor 工具名 | 对应组件 | 描述 |
|--------------|---------|------|
| `lsToolCall` | `ListTool` | 目录列表 |
| `readToolCall` | `ReadTool` | 文件阅读 |
| `editToolCall` | `EditTool` / `WriteTool` | 文件编辑 |
| `deleteToolCall` | `DeleteTool` | 文件删除 |
| `globToolCall` | `GlobTool` | 文件查找 |
| `grepToolCall` | `GrepTool` | 内容搜索 |
| `shellToolCall` | `BashTool` | Shell 命令 |
| `updateTodosToolCall` | `TodoTool` | 任务管理 |
| `listMcpResourcesToolCall` | `McpTool` | MCP 资源 |
| `webFetchToolCall` | `WebFetchTool` | 网页获取 |
| `semSearchToolCall` | `SemanticSearchTool` | 语义搜索 |

---

## 更新日志

- **2026-02-01**: 记录了 12 个已确认的工具
  - 核心文件操作：`lsToolCall`, `readToolCall`, `editToolCall`, `deleteToolCall`, `globToolCall`, `grepToolCall`
  - 命令执行：`shellToolCall`
  - 任务管理：`updateTodosToolCall`
  - MCP 集成：`listMcpResourcesToolCall`
  - 网络访问：`webFetchToolCall`
  - 智能搜索：`semSearchToolCall`
