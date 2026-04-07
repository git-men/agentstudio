import type { Express } from 'express';

export async function setupSwagger(app: Express): Promise<void> {
  let swaggerJsdoc: any;
  let swaggerUi: any;
  try {
    swaggerJsdoc = (await import('swagger-jsdoc')).default;
    swaggerUi = (await import('swagger-ui-express')).default ?? await import('swagger-ui-express');
  } catch {
    return;
  }

  const options = {
    definition: {
      openapi: '3.0.3',
      info: {
        title: 'AgentStudio API',
        version: '1.0.0',
        description: 'AgentStudio 后端 API — 本地 AI Agent 工作台',
        contact: { name: 'AgentStudio Team' },
      },
      servers: [
        { url: '/', description: 'Current server' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
      security: [{ bearerAuth: [] }],
      tags: [
        { name: 'Health', description: '健康检查与系统信息' },
        { name: 'Auth', description: '认证与授权' },
        { name: 'Agents', description: 'Agent 管理与对话' },
        { name: 'SubAgents', description: '子 Agent 管理' },
        { name: 'Sessions', description: '会话管理' },
        { name: 'Files', description: '文件系统操作' },
        { name: 'Commands', description: '斜杠命令管理' },
        { name: 'Settings', description: '设置与配置' },
        { name: 'MCP', description: 'MCP 服务管理' },
        { name: 'A2A', description: 'Agent-to-Agent 协议' },
      ],
    },
    apis: [
      './src/routes/*.ts',
      './src/routes/*.js',
      './src/index.ts',
      './src/index.js',
      './dist/routes/*.js',
      './dist/index.js',
    ],
  };

  const swaggerSpec = swaggerJsdoc(options);

  app.get('/api-docs.json', (_req: any, res: any) => {
    res.json(swaggerSpec);
  });

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'AgentStudio API Docs',
    customCss: '.swagger-ui .topbar { display: none }',
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'none',
      filter: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  }));
}
