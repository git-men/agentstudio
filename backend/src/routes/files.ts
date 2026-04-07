import express from 'express';
import fs from 'fs-extra';
import { existsSync } from 'fs';
import { join, dirname, resolve, relative } from 'path';
import { z } from 'zod';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
// Helper function to get project ID using base64url encoding (reversible)
const getProjectId = (projectPath: string): string => {
  return encodeProjectPath(projectPath);
};

// Helper function to encode project path using base64url encoding
const encodeProjectPath = (projectPath: string): string => {
  const normalizedPath = resolve(projectPath);
  // Use base64url encoding (URL-safe)
  return Buffer.from(normalizedPath).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
};

const router: express.Router = express.Router();

const SENSITIVE_DIRS = new Set([
  '.ssh', '.gnupg', '.gpg', '.aws', '.azure', '.kube', '.docker',
  '.password-store', '.vault-token', '.credentials',
  '.config/gcloud', '.config/op',
]);

function isSensitivePath(targetPath: string): boolean {
  const homedir = os.homedir();
  const rel = path.relative(homedir, targetPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  const firstSegment = rel.split(path.sep)[0];
  const firstTwo = rel.split(path.sep).slice(0, 2).join('/');
  return SENSITIVE_DIRS.has(firstSegment) || SENSITIVE_DIRS.has(firstTwo);
}

// Get working directory (project root or specified project path)
const getWorkingDir = (projectPath?: string) => {
  if (projectPath) {
    return resolve(projectPath);
  }
  return resolve(__dirname, '../../..');
};

// Validation schemas
const ReadFileSchema = z.object({
  path: z.string()
});

const ReadFilesSchema = z.object({
  paths: z.array(z.string())
});

const WriteFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  encoding: z.enum(['utf-8', 'base64']).optional()
});

// Helper function to resolve and validate file path
const resolveSafePath = (filePath: string, projectPath?: string): string => {
  const workingDir = getWorkingDir(projectPath);
  const resolvedPath = resolve(workingDir, filePath);
  
  // Ensure the path is within the working directory for security
  const relativePath = relative(workingDir, resolvedPath);
  if (relativePath.startsWith('..') || resolve(workingDir, relativePath) !== resolvedPath) {
    throw new Error('Path is outside working directory');
  }
  
  return resolvedPath;
};

/**
 * @swagger
 * /api/files/resolve:
 *   get:
 *     tags: [Files]
 *     summary: 解析路径（展开 ~ 等）
 *     parameters:
 *       - in: query
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 成功，返回 resolved 绝对路径
 *       400:
 *         description: 缺少 path 参数
 *       500:
 *         description: 解析失败
 */
router.get('/resolve', (req, res) => {
  try {
    const rawPath = req.query.path as string;
    if (!rawPath) {
      return res.status(400).json({ error: 'path query parameter is required' });
    }
    let resolvedPath = rawPath;
    if (resolvedPath.startsWith('~')) {
      resolvedPath = join(os.homedir(), resolvedPath.slice(1));
    }
    resolvedPath = resolve(resolvedPath);
    res.json({ resolved: resolvedPath });
  } catch (error) {
    res.status(500).json({ error: 'Failed to resolve path' });
  }
});

/**
 * @swagger
 * /api/files/read:
 *   get:
 *     tags: [Files]
 *     summary: 读取单个文件（文本或二进制流）
 *     parameters:
 *       - in: query
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: projectPath
 *         schema:
 *           type: string
 *       - in: query
 *         name: binary
 *         schema:
 *           type: string
 *           enum: ['true', 'false']
 *     responses:
 *       200:
 *         description: JSON（文本）或文件流（binary=true）
 *       400:
 *         description: 参数无效或路径不是文件
 *       403:
 *         description: 路径越权
 *       404:
 *         description: 文件不存在
 *       500:
 *         description: 读取失败
 */
router.get('/read', async (req, res) => {
  try {
    const { path, projectPath, binary } = req.query;
    
    if (!path || typeof path !== 'string') {
      return res.status(400).json({ error: 'File path is required' });
    }

    const fullPath = resolveSafePath(path, typeof projectPath === 'string' ? projectPath : undefined);
    
    if (!existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // 如果是二进制文件请求（如图片），直接发送文件内容
    if (binary === 'true') {
      const stats = await fs.stat(fullPath);
      if (!stats.isFile()) {
        return res.status(400).json({ error: 'Path is not a file' });
      }

      // 根据文件扩展名设置正确的Content-Type
      const ext = path.toLowerCase().split('.').pop();
      const mimeTypes: Record<string, string> = {
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'svg': 'image/svg+xml',
        'webp': 'image/webp',
        'ico': 'image/x-icon',
        'bmp': 'image/bmp',
        'tiff': 'image/tiff',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'xls': 'application/vnd.ms-excel',
        'xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
        'xlsb': 'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
      };
      
      const mimeType = mimeTypes[ext || ''] || 'application/octet-stream';
      res.setHeader('Content-Type', mimeType);
      const isImageExt = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'tiff'].includes(ext || '');
      res.setHeader('Cache-Control', isImageExt ? 'public, max-age=3600' : 'no-cache');
      
      // 直接发送文件流
      const fileStream = fs.createReadStream(fullPath);
      fileStream.pipe(res);
      
      fileStream.on('error', (error) => {
        console.error('Error streaming file:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to read file' });
        }
      });
      
      return;
    }

    // 对于文本文件，仍然使用utf-8编码
    const content = await fs.readFile(fullPath, 'utf-8');
    
    res.json({
      path,
      content,
      exists: true
    });
  } catch (error) {
    console.error('Error reading file:', error);
    if (error instanceof Error && error.message === 'Path is outside working directory') {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.status(500).json({ error: 'Failed to read file' });
  }
});

/**
 * @swagger
 * /api/files/read-multiple:
 *   post:
 *     tags: [Files]
 *     summary: 批量读取文件
 *     parameters:
 *       - in: query
 *         name: projectPath
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [paths]
 *             properties:
 *               paths:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: 成功，返回 files 数组
 *       400:
 *         description: 请求体无效
 *       500:
 *         description: 读取失败
 */
router.post('/read-multiple', async (req, res) => {
  try {
    const validation = ReadFilesSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid request body', details: validation.error });
    }

    const { paths } = validation.data;
    const { projectPath } = req.query;
    
    const results = await Promise.allSettled(
      paths.map(async (path) => {
        try {
          const fullPath = resolveSafePath(path, typeof projectPath === 'string' ? projectPath : undefined);
          const exists = existsSync(fullPath);
          
          if (!exists) {
            return {
              path,
              content: null,
              exists: false,
              error: 'File not found'
            };
          }

          const content = await fs.readFile(fullPath, 'utf-8');
          return {
            path,
            content,
            exists: true
          };
        } catch (error) {
          return {
            path,
            content: null,
            exists: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      })
    );

    const files = results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          path: paths[index],
          content: null,
          exists: false,
          error: result.reason
        };
      }
    });

    res.json({ files });
  } catch (error) {
    console.error('Error reading files:', error);
    res.status(500).json({ error: 'Failed to read files' });
  }
});

/**
 * @swagger
 * /api/files/write:
 *   put:
 *     tags: [Files]
 *     summary: 写入单个文件（最大约 100MB JSON）
 *     parameters:
 *       - in: query
 *         name: projectPath
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [path, content]
 *             properties:
 *               path:
 *                 type: string
 *               content:
 *                 type: string
 *               encoding:
 *                 type: string
 *                 enum: [utf-8, base64]
 *     responses:
 *       200:
 *         description: 写入成功
 *       400:
 *         description: 请求体无效
 *       403:
 *         description: 路径越权
 *       500:
 *         description: 写入失败
 */
router.put('/write', express.json({ limit: '100mb' }), async (req, res) => {
  try {
    const validation = WriteFileSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid request body', details: validation.error });
    }

    const { path, content, encoding } = validation.data;
    const { projectPath } = req.query;
    const fullPath = resolveSafePath(path, typeof projectPath === 'string' ? projectPath : undefined);

    console.log(`[files/write] path=${path}, encoding=${encoding}, contentLength=${content.length}, fullPath=${fullPath}`);

    // Ensure directory exists
    await fs.ensureDir(dirname(fullPath));
    
    if (encoding === 'base64') {
      const buffer = Buffer.from(content, 'base64');
      console.log(`[files/write] base64 decoded to ${buffer.length} bytes`);
      await fs.writeFile(fullPath, buffer);
    } else {
      await fs.writeFile(fullPath, content, 'utf-8');
    }

    // Verify file was written
    const writtenStats = await fs.stat(fullPath);
    console.log(`[files/write] Written successfully: ${fullPath} (${writtenStats.size} bytes)`);

    res.json({
      success: true,
      message: 'File written successfully',
      path,
      size: writtenStats.size,
    });
  } catch (error) {
    console.error('Error writing file:', error);
    if (error instanceof Error && error.message === 'Path is outside working directory') {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.status(500).json({ error: 'Failed to write file' });
  }
});

/**
 * @swagger
 * /api/files/project-id:
 *   get:
 *     tags: [Files]
 *     summary: 根据项目路径计算 projectId（base64url）
 *     parameters:
 *       - in: query
 *         name: projectPath
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 成功
 *       400:
 *         description: 缺少 projectPath
 *       500:
 *         description: 计算失败
 */
router.get('/project-id', async (req, res) => {
  try {
    const { projectPath } = req.query;
    
    if (!projectPath || typeof projectPath !== 'string') {
      return res.status(400).json({ error: 'Project path is required' });
    }

    const projectId = getProjectId(projectPath);
    
    res.json({
      projectId,
      projectPath
    });
  } catch (error) {
    console.error('Error getting project ID:', error);
    res.status(500).json({ error: 'Failed to get project ID' });
  }
});

// ========== FILESYSTEM ROUTES MIGRATED FROM AGENTS.TS ==========

/**
 * @swagger
 * /api/files/browse:
 *   get:
 *     tags: [Files]
 *     summary: 浏览目录（列出子项）
 *     parameters:
 *       - in: query
 *         name: path
 *         schema:
 *           type: string
 *       - in: query
 *         name: showHiddenFiles
 *         schema:
 *           type: string
 *           enum: ['true', 'false']
 *     responses:
 *       200:
 *         description: 当前路径、父路径、items 列表或单文件信息
 *       403:
 *         description: 敏感目录拒绝访问
 *       500:
 *         description: 浏览失败
 */
router.get('/browse', (req, res) => {
  try {
    const { path: requestedPath, showHiddenFiles } = req.query;
    
    // Default to home directory if no path provided
    let browsePath = requestedPath ? String(requestedPath) : os.homedir();
    
    // Parse showHiddenFiles parameter (default to false)
    const includeHidden = showHiddenFiles === 'true';

    // Expand ~ to home directory
    if (browsePath.startsWith('~')) {
      browsePath = path.join(os.homedir(), browsePath.slice(1));
    }

    // Security check: ensure path is safe; fall back to home if invalid
    if (browsePath.includes('..') || !path.isAbsolute(browsePath)) {
      browsePath = os.homedir();
    }

    if (isSensitivePath(browsePath)) {
      return res.status(403).json({ error: 'Access to sensitive directory is denied' });
    }
    
    if (!fs.existsSync(browsePath)) {
      browsePath = os.homedir();
    }
    
    const stats = fs.statSync(browsePath);
    
    // If it's not a directory, return info about the item itself
    if (!stats.isDirectory()) {
      return res.json({
        currentPath: browsePath,
        isDirectory: false,
        size: stats.size,
        modified: stats.mtime.toISOString(),
        parentPath: path.dirname(browsePath),
        items: null
      });
    }
    
    const items = fs.readdirSync(browsePath)
      .map(name => {
        const itemPath = path.join(browsePath, name);
        try {
          const itemStats = fs.statSync(itemPath);
          const isHidden = name.startsWith('.');
          return {
            name,
            path: itemPath,
            isDirectory: itemStats.isDirectory(),
            size: itemStats.isDirectory() ? null : itemStats.size,
            modified: itemStats.mtime.toISOString(),
            isHidden
          };
        } catch (error) {
          // Skip items that can't be read
          return null;
        }
      })
      .filter(item => item !== null)
      .filter(item => !isSensitivePath(item.path))
      .filter(item => includeHidden || !item.isHidden)
      .sort((a, b) => {
        // Directories first, then by name
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
    
    // Get parent directory info
    const parentPath = path.dirname(browsePath);
    const canGoUp = browsePath !== parentPath;
    
    res.json({
      currentPath: browsePath,
      isDirectory: true,
      parentPath: canGoUp ? parentPath : null,
      items
    });
    
  } catch (error) {
    console.error('File browser error:', error);
    res.status(500).json({ error: 'Failed to browse directory' });
  }
});

/**
 * @swagger
 * /api/files/create-directory:
 *   post:
 *     tags: [Files]
 *     summary: 创建目录
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [parentPath, directoryName]
 *             properties:
 *               parentPath:
 *                 type: string
 *               directoryName:
 *                 type: string
 *     responses:
 *       200:
 *         description: 创建成功
 *       400:
 *         description: 参数无效
 *       404:
 *         description: 父目录不存在
 *       409:
 *         description: 目录已存在
 *       500:
 *         description: 创建失败
 */
router.post('/create-directory', (req, res) => {
  try {
    const { parentPath, directoryName } = req.body;
    
    if (!parentPath || !directoryName) {
      return res.status(400).json({ error: 'Parent path and directory name are required' });
    }
    
    // Security checks
    if (directoryName.includes('..') || directoryName.includes('/') || directoryName.includes('\\')) {
      return res.status(400).json({ error: 'Invalid directory name' });
    }
    
    if (parentPath.includes('..') || !path.isAbsolute(parentPath)) {
      return res.status(400).json({ error: 'Invalid parent path' });
    }
    
    if (!fs.existsSync(parentPath)) {
      return res.status(404).json({ error: 'Parent directory not found' });
    }
    
    const newDirPath = path.join(parentPath, directoryName);
    
    if (fs.existsSync(newDirPath)) {
      return res.status(409).json({ error: 'Directory already exists' });
    }
    
    fs.mkdirSync(newDirPath, { recursive: true });
    
    res.json({
      success: true,
      directoryPath: newDirPath,
      message: `Directory "${directoryName}" created successfully`
    });
    
  } catch (error) {
    console.error('Create directory error:', error);
    res.status(500).json({ 
      error: 'Failed to create directory',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * @swagger
 * /api/files/open-in-explorer:
 *   post:
 *     tags: [Files]
 *     summary: 在系统文件管理器中打开文件夹
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [folderPath]
 *             properties:
 *               folderPath:
 *                 type: string
 *     responses:
 *       200:
 *         description: 已调用系统打开命令
 *       400:
 *         description: 缺少 folderPath
 *       404:
 *         description: 路径不存在
 *       500:
 *         description: 打开失败
 */
router.post('/open-in-explorer', (req, res) => {
  try {
    const { folderPath } = req.body;
    
    if (!folderPath || typeof folderPath !== 'string') {
      return res.status(400).json({ error: 'Folder path is required' });
    }

    let targetPath = folderPath;
    if (targetPath.startsWith('~')) {
      targetPath = path.join(os.homedir(), targetPath.slice(1));
    }
    targetPath = path.resolve(targetPath);

    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ error: 'Path not found' });
    }

    const stats = fs.statSync(targetPath);
    const dirToOpen = stats.isDirectory() ? targetPath : path.dirname(targetPath);

    const platform = os.platform();
    let bin: string;
    let args: string[];
    if (platform === 'darwin') {
      bin = 'open';
      args = [dirToOpen];
    } else if (platform === 'win32') {
      bin = 'explorer';
      args = [dirToOpen.replace(/\//g, '\\')];
    } else {
      bin = 'xdg-open';
      args = [dirToOpen];
    }

    execFile(bin, args, (error) => {
      if (error) {
        console.error('Failed to open folder:', error);
        return res.status(500).json({ error: 'Failed to open folder in explorer' });
      }
      res.json({ success: true, path: dirToOpen, platform });
    });
  } catch (error) {
    console.error('Open in explorer error:', error);
    res.status(500).json({ error: 'Failed to open folder in explorer' });
  }
});

export default router;