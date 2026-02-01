/**
 * Cursor CLI 工具类型定义
 * 
 * 这些类型基于 Cursor CLI (`cursor agent --output-format stream-json`) 的输出格式
 * 参考文档: docs/CURSOR_CLI_TOOLS_SCHEMA.md
 */

// ==================== 基础类型 ====================

/**
 * Cursor 工具调用的基础结构
 */
export interface CursorToolCallEvent {
  type: 'tool_call';
  subtype: 'started' | 'completed';
  call_id: string;
  tool_call: CursorToolCallPayload;
  model_call_id: string;
  session_id: string;
  timestamp_ms: number;
}

/**
 * 工具调用的载荷，包含具体工具名称及其数据
 */
export type CursorToolCallPayload = {
  [K in CursorToolName]?: {
    args: CursorToolArgsMap[K];
    result?: CursorToolResultMap[K];
  };
};

/**
 * 所有 Cursor 工具名称
 */
export type CursorToolName =
  | 'lsToolCall'
  | 'readToolCall'
  | 'editToolCall'
  | 'deleteToolCall'
  | 'globToolCall'
  | 'grepToolCall'
  | 'shellToolCall'
  | 'updateTodosToolCall'
  | 'listMcpResourcesToolCall'
  | 'webFetchToolCall'
  | 'semSearchToolCall'
  | 'mcpToolCall';

// ==================== 工具 Args 类型 ====================

/**
 * 工具名称到参数类型的映射
 */
export interface CursorToolArgsMap {
  lsToolCall: LsToolCallArgs;
  readToolCall: ReadToolCallArgs;
  editToolCall: EditToolCallArgs;
  deleteToolCall: DeleteToolCallArgs;
  globToolCall: GlobToolCallArgs;
  grepToolCall: GrepToolCallArgs;
  shellToolCall: ShellToolCallArgs;
  updateTodosToolCall: UpdateTodosToolCallArgs;
  listMcpResourcesToolCall: ListMcpResourcesToolCallArgs;
  webFetchToolCall: WebFetchToolCallArgs;
  semSearchToolCall: SemSearchToolCallArgs;
  mcpToolCall: McpToolCallArgs;
}

/**
 * 工具名称到结果类型的映射
 */
export interface CursorToolResultMap {
  lsToolCall: LsToolCallResult;
  readToolCall: ReadToolCallResult;
  editToolCall: EditToolCallResult;
  deleteToolCall: DeleteToolCallResult;
  globToolCall: GlobToolCallResult;
  grepToolCall: GrepToolCallResult;
  shellToolCall: ShellToolCallResult;
  updateTodosToolCall: UpdateTodosToolCallResult;
  listMcpResourcesToolCall: ListMcpResourcesToolCallResult;
  webFetchToolCall: WebFetchToolCallResult;
  semSearchToolCall: SemSearchToolCallResult;
  mcpToolCall: McpToolCallResult;
}

// ==================== 1. lsToolCall - 目录列表 ====================

export interface LsToolCallArgs {
  path: string;
  ignore: string[];
  toolCallId?: string;
}

export interface LsToolCallResult {
  success: {
    directoryTreeRoot: DirectoryNode;
  };
}

export interface DirectoryNode {
  absPath: string;
  childrenDirs: DirectoryNode[];
  childrenFiles: FileNode[];
  childrenWereProcessed: boolean;
  fullSubtreeExtensionCounts: Record<string, number>;
  numFiles: number;
}

export interface FileNode {
  name: string;
}

// ==================== 2. readToolCall - 文件读取 ====================

export interface ReadToolCallArgs {
  path: string;
  limit?: number;
}

export interface ReadToolCallResult {
  success: {
    content: string;
    isEmpty: boolean;
    exceededLimit: boolean;
    totalLines: number;
    fileSize: number;
    path: string;
    readRange: {
      startLine: number;
      endLine: number;
    };
  };
}

// ==================== 3. editToolCall - 文件编辑 ====================

export interface EditToolCallArgs {
  path: string;
  streamContent: string;
}

export interface EditToolCallResult {
  success: {
    path: string;
    linesAdded: number;
    linesRemoved: number;
    diffString: string;
    beforeFullFileContent?: string;
    afterFullFileContent: string;
    message: string;
  };
}

// ==================== 4. deleteToolCall - 文件删除 ====================

export interface DeleteToolCallArgs {
  path: string;
  toolCallId?: string;
}

export interface DeleteToolCallResult {
  success?: {
    path: string;
    message: string;
  };
  error?: {
    path: string;
    error: string;
  };
}

// ==================== 5. globToolCall - 文件查找 ====================

export interface GlobToolCallArgs {
  targetDirectory: string;
  globPattern: string;
}

export interface GlobToolCallResult {
  success: {
    pattern: string;
    path: string;
    files: string[];
    totalFiles: number;
    clientTruncated: boolean;
    ripgrepTruncated: boolean;
  };
}

// ==================== 6. grepToolCall - 内容搜索 ====================

export interface GrepToolCallArgs {
  pattern: string;
  path: string;
  glob?: string;
  outputMode?: 'content' | 'files_with_matches';
  caseInsensitive: boolean;
  multiline: boolean;
  toolCallId?: string;
}

export interface GrepToolCallResult {
  success: {
    pattern: string;
    path: string;
    outputMode: string;
    workspaceResults: Record<string, WorkspaceGrepResult>;
  };
}

export interface WorkspaceGrepResult {
  content?: {
    matches: FileMatch[];
  };
  files?: {
    files: string[];
  };
}

export interface FileMatch {
  file: string;
  matches: LineMatch[];
}

export interface LineMatch {
  lineNumber: number;
  content: string;
  contentTruncated: boolean;
  isContextLine: boolean;
}

// ==================== 7. shellToolCall - Shell 命令 ====================

export interface ShellToolCallArgs {
  command: string;
  workingDirectory: string;
  timeout: number;
  toolCallId?: string;
  simpleCommands: string[];
  hasInputRedirect: boolean;
  hasOutputRedirect: boolean;
  parsingResult: {
    parsingFailed: boolean;
    executableCommands: ExecutableCommand[];
    hasRedirects: boolean;
    hasCommandSubstitution: boolean;
  };
  fileOutputThresholdBytes?: string;
  isBackground: boolean;
  skipApproval?: boolean;
  timeoutBehavior?: string;
}

export interface ExecutableCommand {
  name: string;
  args: CommandArg[];
  fullText: string;
}

export interface CommandArg {
  type: 'word' | 'string' | 'number';
  value: string;
}

export interface ShellToolCallResult {
  success: {
    command: string;
    workingDirectory: string;
    exitCode: number;
    signal: string;
    stdout: string;
    stderr: string;
    executionTime: number;
    interleavedOutput: string;
  };
  isBackground: boolean;
}

// ==================== 8. updateTodosToolCall - Todo 管理 ====================

export interface UpdateTodosToolCallArgs {
  todos: TodoItem[];
  merge: boolean;
}

export interface TodoItem {
  id: string;
  content: string;
  status: 'TODO_STATUS_PENDING' | 'TODO_STATUS_IN_PROGRESS' | 'TODO_STATUS_COMPLETED';
  createdAt: string;
  updatedAt: string;
  dependencies: string[];
}

export interface UpdateTodosToolCallResult {
  success: {
    todos: TodoItem[];
    totalCount: number;
    wasMerge: boolean;
  };
}

// ==================== 9. listMcpResourcesToolCall - MCP 资源 ====================

export interface ListMcpResourcesToolCallArgs {
  // 无参数
}

export interface ListMcpResourcesToolCallResult {
  success: {
    resources: McpResource[];
  };
}

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

// ==================== 10. webFetchToolCall - 网页获取 ====================

export interface WebFetchToolCallArgs {
  url: string;
  toolCallId?: string;
}

export interface WebFetchToolCallResult {
  success?: {
    url: string;
    markdown: string;
  };
  error?: {
    url: string;
    error: string;
  };
}

// ==================== 11. semSearchToolCall - 语义搜索 ====================

export interface SemSearchToolCallArgs {
  query: string;
  targetDirectories: string[];
  explanation?: string;
}

export interface SemSearchToolCallResult {
  success: {
    results: string;
  };
}

// ==================== 12. mcpToolCall - MCP 工具调用 ====================

export interface McpToolCallArgs {
  name: string;              // 完整工具名称（格式：{serverName}-{toolName}）
  args: Record<string, unknown>; // 工具参数
  toolCallId: string;        // 工具调用 ID
  providerIdentifier: string;// MCP 服务名称（如 "hitl-hil"）
  toolName: string;          // 工具名称（如 "send_message_only"）
}

export interface McpToolCallResult {
  success?: {
    content: McpContent[];   // 结果内容数组
    isError: boolean;        // 是否为错误
  };
  error?: {
    error: string;           // 错误信息
  };
}

export interface McpContent {
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

// ==================== 转换后的执行状态类型 ====================

/**
 * Cursor 工具执行状态，与 BaseToolExecution 兼容
 */
export interface CursorToolExecution {
  id: string;
  toolName: CursorToolName;
  toolInput: CursorToolArgsMap[CursorToolName];
  toolResult?: string;
  toolUseResult?: CursorToolResultMap[CursorToolName];
  isExecuting: boolean;
  isError?: boolean;
  isInterrupted?: boolean;
  timestamp: Date;
}

// ==================== 工具显示名称映射 ====================

/**
 * Cursor 工具名称到显示名称的映射
 */
export const CURSOR_TOOL_DISPLAY_NAMES: Record<CursorToolName, string> = {
  lsToolCall: 'LS',
  readToolCall: 'Read',
  editToolCall: 'Edit',
  deleteToolCall: 'Delete',
  globToolCall: 'Glob',
  grepToolCall: 'Grep',
  shellToolCall: 'Shell',
  updateTodosToolCall: 'TodoWrite',
  listMcpResourcesToolCall: 'ListMcpResources',
  webFetchToolCall: 'WebFetch',
  semSearchToolCall: 'SemanticSearch',
  mcpToolCall: 'MCP',
};
