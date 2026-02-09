/**
 * Agent Card Service
 *
 * Generates Agent Cards from AgentConfig for A2A protocol discovery.
 * Agent Cards are auto-generated and should never be manually maintained.
 *
 * Supports multiple engine types:
 * - Claude: Uses AgentConfig tools for skills
 * - Cursor: Uses Cursor engine capabilities for skills
 *
 * Pure function approach: generateAgentCard(agentConfig, projectContext) -> AgentCard
 *
 * Phase 4: US2 - Agent Card Auto-Generation
 */

import type { AgentConfig, AgentTool } from '../../types/agents.js';
import type { AgentCard, Skill, SecurityScheme, JSONSchema } from '../../types/a2a.js';
import { cursorEngine } from '../../engines/cursor/index.js';

/**
 * Project context metadata for Agent Card generation
 */
export interface ProjectContext {
  projectId: string;
  projectName: string;
  workingDirectory: string;
  a2aAgentId: string;
  baseUrl: string; // e.g., "https://agentstudio.cc"
}

/**
 * Generate Agent Card from agent configuration (pure function)
 *
 * This is a pure function with no side effects - it takes agent config and project context
 * and returns a complete Agent Card compliant with A2A protocol v1.0.
 *
 * @param agentConfig - Agent configuration with tools and metadata
 * @param projectContext - Project-specific context (ID, name, working directory, A2A ID, baseUrl)
 * @returns Complete Agent Card ready for A2A protocol exposure
 */
export function generateAgentCard(
  agentConfig: AgentConfig,
  projectContext: ProjectContext
): AgentCard {
  // Extract skills from agent's tools
  const skills = extractSkillsFromTools(agentConfig.allowedTools);

  // Determine agent category
  const agentCategory = agentConfig.source === 'plugin' ? ('subagent' as const) : ('builtin' as const);

  // Build Agent Card
  const agentCard: AgentCard = {
    // A2A Protocol required fields
    name: agentConfig.name,
    description: agentConfig.description,
    version: agentConfig.version,
    url: `${projectContext.baseUrl}/a2a/${projectContext.a2aAgentId}`,

    // Agent capabilities (skills extracted from tools)
    skills,

    // Authentication requirements (API key only for now)
    securitySchemes: [
      {
        type: 'apiKey' as const,
        in: 'header' as const,
        name: 'Authorization' as const,
        scheme: 'bearer' as const,
      },
    ],

    // AgentStudio-specific context
    context: {
      a2aAgentId: projectContext.a2aAgentId,
      projectId: projectContext.projectId,
      projectName: projectContext.projectName,
      workingDirectory: projectContext.workingDirectory,
      agentType: agentConfig.id,
      agentCategory,
    },
  };

  return agentCard;
}

/**
 * Extract skills from agent's enabled MCP tools
 *
 * Converts AgentTool[] to Skill[] by mapping tool names to skill definitions.
 * Only includes enabled tools.
 *
 * @param tools - Array of agent tools with enable/disable state
 * @returns Array of skills for Agent Card
 */
function extractSkillsFromTools(tools: AgentTool[]): Skill[] {
  const skills: Skill[] = [];

  // Filter to enabled tools only
  const enabledTools = tools.filter((tool) => tool.enabled);

  for (const tool of enabledTools) {
    const skill = toolToSkill(tool);
    if (skill) {
      skills.push(skill);
    }
  }

  return skills;
}

/**
 * Convert a single AgentTool to a Skill definition
 *
 * Maps common tool names to their skill schemas. For unknown tools,
 * generates a generic skill with minimal schema.
 *
 * @param tool - Agent tool configuration
 * @returns Skill definition or null if tool should be excluded
 */
function toolToSkill(tool: AgentTool): Skill | null {
  // Map common tools to skill definitions
  const toolSchemas: Record<string, Omit<Skill, 'name'>> = {
    // File operations
    read_file: {
      description: 'Read content from a file',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to read' },
        },
        required: ['path'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'File content' },
        },
      },
    },
    write_file: {
      description: 'Write content to a file',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to write' },
          content: { type: 'string', description: 'Content to write' },
        },
        required: ['path', 'content'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
        },
      },
    },
    edit_file: {
      description: 'Edit file content with search and replace',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to edit' },
          old_string: { type: 'string', description: 'Text to replace' },
          new_string: { type: 'string', description: 'Replacement text' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
        },
      },
    },
    // Command execution
    execute_command: {
      description: 'Execute shell command',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
        },
        required: ['command'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          stdout: { type: 'string' },
          stderr: { type: 'string' },
          exitCode: { type: 'number' },
        },
      },
    },
    // Search
    grep: {
      description: 'Search for patterns in files',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search pattern' },
          path: { type: 'string', description: 'Directory to search' },
        },
        required: ['pattern'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          matches: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
    },
    glob: {
      description: 'Find files matching glob pattern',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern' },
        },
        required: ['pattern'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          files: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
    },
  };

  // Check if we have a predefined schema for this tool
  const schema = toolSchemas[tool.name];

  if (schema) {
    return {
      name: tool.name,
      ...schema,
    };
  }

  // For unknown tools, generate generic schema
  return {
    name: tool.name,
    description: `Execute ${tool.name} tool`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
    outputSchema: {
      type: 'object',
      properties: {
        result: { type: 'string' },
      },
    },
  };
}

// =============================================================================
// Cursor Engine Agent Card Generation
// =============================================================================

/**
 * Generate Agent Card for Cursor engine
 * 
 * Unlike Claude agents which derive skills from configured tools,
 * Cursor engine has a fixed set of built-in capabilities.
 * 
 * @param projectContext - Project-specific context
 * @returns Complete Agent Card for Cursor engine
 */
export async function generateCursorAgentCard(
  projectContext: ProjectContext
): Promise<AgentCard> {
  const capabilities = cursorEngine.capabilities;
  const models = await cursorEngine.getSupportedModels();

  // Generate Cursor-specific skills
  const skills = generateCursorSkills(capabilities);

  const agentCard: AgentCard = {
    // A2A Protocol required fields
    name: 'Cursor Agent',
    description: 'AI-powered coding assistant using Cursor CLI. Provides intelligent code editing, file operations, terminal command execution, and codebase navigation.',
    version: '1.0.0',
    url: `${projectContext.baseUrl}/a2a/${projectContext.a2aAgentId}`,

    // Agent capabilities (skills from Cursor engine)
    skills,

    // Authentication requirements
    securitySchemes: [
      {
        type: 'apiKey' as const,
        in: 'header' as const,
        name: 'Authorization' as const,
        scheme: 'bearer' as const,
      },
    ],

    // AgentStudio-specific context
    context: {
      a2aAgentId: projectContext.a2aAgentId,
      projectId: projectContext.projectId,
      projectName: projectContext.projectName,
      workingDirectory: projectContext.workingDirectory,
      agentType: 'cursor',
      agentCategory: 'builtin' as const,
      // Cursor-specific metadata
      engineType: 'cursor',
      supportedModels: models.map(m => ({ id: m.id, name: m.name })),
      engineCapabilities: {
        streaming: capabilities.features.streaming,
        thinking: capabilities.features.thinking,
        vision: capabilities.features.vision,
        codeExecution: capabilities.features.codeExecution,
        multiTurn: capabilities.features.multiTurn,
      },
    } as any, // Extended context
  };

  return agentCard;
}

/**
 * Generate skills list based on Cursor engine capabilities
 */
function generateCursorSkills(capabilities: typeof cursorEngine.capabilities): Skill[] {
  const skills: Skill[] = [];

  // Code editing skill
  skills.push({
    name: 'code-editing',
    description: 'Read, write, and modify code files with intelligent context awareness. Supports refactoring, bug fixes, and feature implementation.',
    inputSchema: {
      type: 'object',
      properties: {
        instruction: { type: 'string', description: 'What code changes to make' },
        targetFiles: { 
          type: 'array', 
          items: { type: 'string' },
          description: 'Optional specific files to focus on'
        },
      },
      required: ['instruction'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        modifiedFiles: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
      },
    },
  });

  // File operations skill
  skills.push({
    name: 'file-operations',
    description: 'Read, write, create, and navigate files in the workspace. Search for files and explore directory structure.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: { 
          type: 'string', 
          enum: ['read', 'write', 'create', 'search', 'list'],
          description: 'Type of file operation'
        },
        path: { type: 'string', description: 'File or directory path' },
        content: { type: 'string', description: 'Content for write/create operations' },
        pattern: { type: 'string', description: 'Search pattern for search operation' },
      },
      required: ['operation'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        content: { type: 'string' },
        files: { type: 'array', items: { type: 'string' } },
      },
    },
  });

  // Terminal execution skill (if supported)
  if (capabilities.features.codeExecution) {
    skills.push({
      name: 'terminal-execution',
      description: 'Execute shell commands and scripts in the project context. Run tests, install dependencies, build projects.',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          workingDirectory: { type: 'string', description: 'Optional working directory' },
        },
        required: ['command'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          stdout: { type: 'string' },
          stderr: { type: 'string' },
          exitCode: { type: 'number' },
        },
      },
    });
  }

  // Code search and navigation skill
  skills.push({
    name: 'code-search',
    description: 'Search for patterns, find definitions, explore dependencies, and navigate the codebase structure.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query or pattern' },
        scope: { 
          type: 'string', 
          enum: ['all', 'definitions', 'references', 'files'],
          description: 'Search scope'
        },
        fileTypes: { 
          type: 'array', 
          items: { type: 'string' },
          description: 'Filter by file extensions'
        },
      },
      required: ['query'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string' },
              line: { type: 'number' },
              content: { type: 'string' },
            },
          },
        },
        totalCount: { type: 'number' },
      },
    },
  });

  // General coding assistant skill
  skills.push({
    name: 'coding-assistant',
    description: 'Answer questions about code, explain functionality, provide coding guidance, and suggest best practices.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Question or request for guidance' },
        context: { type: 'string', description: 'Optional additional context' },
      },
      required: ['question'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        answer: { type: 'string' },
        codeExamples: { 
          type: 'array', 
          items: { type: 'string' },
          description: 'Relevant code examples'
        },
        references: {
          type: 'array',
          items: { type: 'string' },
          description: 'Links to relevant documentation'
        },
      },
    },
  });

  return skills;
}

/**
 * Determine engine type from agent config or context
 */
export function getEngineTypeFromContext(
  agentConfig?: AgentConfig | null,
  engineType?: 'claude' | 'cursor'
): 'claude' | 'cursor' {
  // Explicit engine type takes precedence
  if (engineType) {
    return engineType;
  }
  
  // Check agent config for engine hints
  if (agentConfig) {
    // If agent ID contains 'cursor' or specific markers
    if (agentConfig.id.toLowerCase().includes('cursor')) {
      return 'cursor';
    }
    // Default to claude for standard agents
    return 'claude';
  }
  
  return 'claude';
}

/**
 * Generate Agent Card based on engine type
 */
export async function generateAgentCardByEngine(
  engineType: 'claude' | 'cursor',
  projectContext: ProjectContext,
  agentConfig?: AgentConfig | null
): Promise<AgentCard> {
  if (engineType === 'cursor') {
    return generateCursorAgentCard(projectContext);
  }
  
  // Default to Claude agent card generation
  if (!agentConfig) {
    throw new Error('AgentConfig is required for Claude engine');
  }
  return generateAgentCard(agentConfig, projectContext);
}
