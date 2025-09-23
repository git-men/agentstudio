import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface FileSystemItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number | null;
  modified: string;
  isHidden: boolean;
  children?: FileSystemItem[];
}

export interface FileSystemResponse {
  currentPath: string;
  parentPath: string | null;
  items: FileSystemItem[];
}

export interface FileContent {
  path: string;
  content: string;
  exists: boolean;
}

// 浏览文件系统目录
export const useFileSystemBrowse = (path?: string) => {
  return useQuery({
    queryKey: ['file-system-browse', path],
    queryFn: async (): Promise<FileSystemResponse> => {
      const searchParams = new URLSearchParams();
      if (path) {
        searchParams.append('path', path);
      }
      
      const response = await fetch(`/api/files/browse?${searchParams.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to browse directory');
      }
      return response.json();
    },
    staleTime: 30000, // 30秒内认为数据是新鲜的
  });
};

// 读取文件内容
export const useFileContent = (filePath?: string, projectPath?: string) => {
  return useQuery({
    queryKey: ['file-content', filePath, projectPath],
    queryFn: async (): Promise<FileContent> => {
      if (!filePath) {
        throw new Error('File path is required');
      }
      
      const searchParams = new URLSearchParams();
      searchParams.append('path', filePath);
      if (projectPath) {
        searchParams.append('projectPath', projectPath);
      }
      
      const response = await fetch(`/api/files/read?${searchParams.toString()}`);
      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('访问被拒绝：文件在项目目录之外');
        } else if (response.status === 404) {
          throw new Error('文件不存在');
        } else {
          throw new Error(`读取文件失败 (${response.status})`);
        }
      }
      return response.json();
    },
    enabled: !!filePath,
    staleTime: 60000, // 1分钟内认为数据是新鲜的
    retry: false, // 不重试，直接显示错误
  });
};

// 递归构建完整的文件树结构
export const useFileTree = (projectPath?: string) => {
  return useQuery({
    queryKey: ['file-tree', projectPath],
    queryFn: async () => {
      if (!projectPath) {
        throw new Error('Project path is required');
      }

      // 递归函数来构建文件树
      const buildFileTree = async (dirPath: string): Promise<FileSystemItem[]> => {
        const searchParams = new URLSearchParams();
        searchParams.append('path', dirPath);
        
        const response = await fetch(`/api/files/browse?${searchParams.toString()}`);
        if (!response.ok) {
          console.warn(`Failed to browse directory: ${dirPath}`);
          return [];
        }
        
        const data: FileSystemResponse = await response.json();
        const items: FileSystemItem[] = [];

        for (const item of data.items) {
          if (item.isHidden) continue; // 跳过隐藏文件
          
          if (item.isDirectory) {
            // 递归加载子目录
            try {
              const children = await buildFileTree(item.path);
              items.push({
                ...item,
                children
              });
            } catch (error) {
              console.warn(`Failed to load children for ${item.path}:`, error);
              items.push({
                ...item,
                children: [] // 如果加载失败，设为空数组
              });
            }
          } else {
            items.push(item);
          }
        }

        return items;
      };

      return await buildFileTree(projectPath);
    },
    enabled: !!projectPath,
    staleTime: 30000, // 30秒内认为数据是新鲜的
  });
};

// 写入文件内容
export const useFileWrite = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ 
      path, 
      content, 
      projectPath 
    }: { 
      path: string; 
      content: string; 
      projectPath?: string; 
    }) => {
      const searchParams = new URLSearchParams();
      if (projectPath) {
        searchParams.append('projectPath', projectPath);
      }
      
      const response = await fetch(`/api/files/write?${searchParams.toString()}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path, content }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to write file');
      }
      return response.json();
    },
    onSuccess: (_, variables) => {
      // 使写入的文件内容查询失效，触发重新获取
      queryClient.invalidateQueries({
        queryKey: ['file-content', variables.path, variables.projectPath],
      });
      
      // 使文件系统浏览查询失效，更新文件列表
      const dirPath = variables.path.split('/').slice(0, -1).join('/') || '/';
      queryClient.invalidateQueries({
        queryKey: ['file-system-browse', dirPath],
      });
    },
  });
};

// 创建目录
export const useCreateDirectory = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ 
      parentPath, 
      directoryName 
    }: { 
      parentPath: string; 
      directoryName: string; 
    }) => {
      const response = await fetch('/api/files/create-directory', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ parentPath, directoryName }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to create directory');
      }
      return response.json();
    },
    onSuccess: (_, variables) => {
      // 使父目录的浏览查询失效，更新目录列表
      queryClient.invalidateQueries({
        queryKey: ['file-system-browse', variables.parentPath],
      });
    },
  });
};

// 获取媒体文件URL (用于文件内容预览)
export const getMediaUrl = (projectId: string, relativePath: string): string => {
  return `/media/${projectId}/${relativePath}`;
};

// 获取项目ID
export const useProjectId = (projectPath?: string) => {
  return useQuery({
    queryKey: ['project-id', projectPath],
    queryFn: async (): Promise<{ projectId: string; projectPath: string }> => {
      if (!projectPath) {
        throw new Error('Project path is required');
      }
      
      const searchParams = new URLSearchParams();
      searchParams.append('projectPath', projectPath);
      
      const response = await fetch(`/api/files/project-id?${searchParams.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to get project ID');
      }
      return response.json();
    },
    enabled: !!projectPath,
    staleTime: Infinity, // 项目ID不会变化，可以无限期缓存
  });
};