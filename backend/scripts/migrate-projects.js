#!/usr/bin/env node

/**
 * 项目迁移工具 - 扫描现有项目并添加到代理配置
 * 这是一个一次性的开发工具，用于迁移历史项目
 * 
 * 使用方法：
 *   node scripts/migrate-projects.js
 *   npm run migrate-projects
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(__filename);  // eslint-disable-line @typescript-eslint/no-unused-vars

// 简化的 AgentStorage 类，避免复杂的依赖
class SimpleAgentStorage {
  constructor() {
    this.agentsDir = path.join(os.homedir(), '.claude-agent', 'agents');
    this.ensureDirectoriesExist();
  }

  ensureDirectoriesExist() {
    if (!fs.existsSync(this.agentsDir)) {
      fs.mkdirSync(this.agentsDir, { recursive: true });
    }
  }

  getAllAgents() {
    const agentFiles = fs.readdirSync(this.agentsDir)
      .filter(file => file.endsWith('.json'));
    
    const agents = [];
    for (const file of agentFiles) {
      try {
        const filePath = path.join(this.agentsDir, file);
        const agentData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        agents.push(agentData);
      } catch (error) {
        console.error(`Failed to read agent file ${file}:`, error);
      }
    }
    
    return agents;
  }

  saveAgent(agent) {
    try {
      agent.updatedAt = new Date().toISOString();
      const filePath = path.join(this.agentsDir, `${agent.id}.json`);
      fs.writeFileSync(filePath, JSON.stringify(agent, null, 2), 'utf-8');
    } catch (error) {
      console.error(`Failed to save agent ${agent.id}:`, error);
      throw error;
    }
  }
}

// 扫描现有项目并添加到代理配置
function migrateExistingProjects() {
  console.log('🔍 开始扫描现有项目...');
  
  const agentStorage = new SimpleAgentStorage();
  const agents = agentStorage.getAllAgents();
  const projectsDir = path.join(os.homedir(), 'claude-code-projects');
  
  if (!fs.existsSync(projectsDir)) {
    console.log(`📁 项目目录不存在: ${projectsDir}`);
    return;
  }
  
  const projectDirs = fs.readdirSync(projectsDir).filter(item => {
    const itemPath = path.join(projectsDir, item);
    return fs.statSync(itemPath).isDirectory() && !item.startsWith('.');
  });
  
  console.log(`📁 找到 ${projectDirs.length} 个项目目录`);
  
  let totalAdded = 0;
  
  for (const projectDir of projectDirs) {
    const projectPath = path.join(projectsDir, projectDir);
    const sessionsDir = path.join(projectPath, '.cc-sessions');
    
    console.log(`\n📂 检查项目: ${projectDir}`);
    
    if (!fs.existsSync(sessionsDir)) {
      console.log(`   ⚠️  未找到会话目录，跳过`);
      continue;
    }
    
    // 检查哪些代理在此项目中有会话
    const agentDirs = fs.readdirSync(sessionsDir).filter(item => {
      const itemPath = path.join(sessionsDir, item);
      return fs.statSync(itemPath).isDirectory() && !item.startsWith('.');
    });
    
    console.log(`   👤 找到代理会话: ${agentDirs.join(', ') || '无'}`);
    
    for (const agentId of agentDirs) {
      const agent = agents.find(a => a.id === agentId);
      if (!agent) {
        console.log(`   ❌ 代理 ${agentId} 不存在，跳过`);
        continue;
      }
      
      // 初始化 projects 数组
      if (!agent.projects) {
        agent.projects = [];
      }
      
      // 添加项目路径（如果不存在）
      const normalizedPath = path.resolve(projectPath);
      if (!agent.projects.includes(normalizedPath)) {
        agent.projects.push(normalizedPath);
        agent.updatedAt = new Date().toISOString();
        console.log(`   ✅ 添加项目到代理 ${agentId}: ${normalizedPath}`);
        totalAdded++;
      } else {
        console.log(`   ℹ️  项目已存在于代理 ${agentId} 中`);
      }
    }
  }
  
  // 保存所有更新的代理
  console.log('\n💾 保存代理配置...');
  for (const agent of agents) {
    if (agent.projects && agent.projects.length > 0) {
      agentStorage.saveAgent(agent);
      console.log(`   ✅ 已保存代理: ${agent.name} (${agent.projects.length} 个项目)`);
    }
  }
  
  console.log(`\n🎉 迁移完成！总共添加了 ${totalAdded} 个项目`);
}

// 主函数
function main() {
  console.log('🚀 AI Editor 项目迁移工具');
  console.log('=====================================');
  
  try {
    migrateExistingProjects();
  } catch (error) {
    console.error('\n❌ 迁移失败:', error);
    process.exit(1);
  }
}

// 运行
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { migrateExistingProjects };
