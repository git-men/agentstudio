# AgentStudio Scripts

构建和开发工具脚本。

## 脚本列表

| 脚本 | 功能 | 用法 |
|------|------|------|
| `build-npm.js` | 构建 npm 发布包 | `node scripts/build-npm.js` |
| `generate-api-key.ts` | 生成 A2A API Key | `npx tsx scripts/generate-api-key.ts` |

### build-npm.js

构建前端和后端，将产物打包为可通过 `npm install -g agentstudio` 安装的 npm 包。

### generate-api-key.ts

为项目生成 A2A 协议所需的 API Key，详见 [API_KEY_GENERATION_README.md](API_KEY_GENERATION_README.md)。
