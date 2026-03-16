import React, { useState, useMemo, useCallback, useEffect, useRef, lazy } from 'react';
import { authFetch } from '../lib/authFetch';
import { useTranslation } from 'react-i18next';
import { Tree, NodeApi, TreeApi } from 'react-arborist';

// 动态导入Monaco Editor
const Editor = lazy(() => import('@monaco-editor/react'));
import {
  FaFolder, FaFolderOpen, FaFile, FaCss3Alt, FaHtml5, FaJsSquare,
  FaReact, FaMarkdown, FaImage, FaPython, FaJava, FaFilePdf, FaFileWord
} from 'react-icons/fa';
import { VscJson, VscCode } from 'react-icons/vsc';
import { SiTypescript } from 'react-icons/si';
import { useFileTree, useFileContent, type FileSystemItem } from '../hooks/useFileSystem';
import { API_BASE } from '../lib/config';
import { Loader2, ChevronRight, RefreshCw, X, ChevronDown, MoreHorizontal, Eye, EyeOff, PanelLeftClose, PanelLeft, Code2, MonitorPlay } from 'lucide-react';
import { eventBus, EVENTS } from '../utils/eventBus';

// 将 FileSystemItem 转换为 react-arborist 需要的格式
interface FileTreeItem {
  id: string;
  name: string;
  path: string;
  isDirectory: boolean;
  size: number | null;
  modified: string;
  isHidden: boolean;
  children?: FileTreeItem[];
}

// 标签页接口
interface FileTab {
  id: string;
  name: string;
  path: string;
  isPinned: boolean; // 是否固定标签
  isActive: boolean; // 是否当前活跃
}

interface FileExplorerProps {
  projectPath?: string;
  onFileSelect?: (filePath: string) => void;
  className?: string;
  height?: string;
}

// 图标映射表
const ICON_MAP = new Map([
  ['js', <FaJsSquare color="#f7df1e" key="js" />],
  ['jsx', <FaReact color="#61dafb" key="jsx" />],
  ['ts', <SiTypescript color="#3178c6" key="ts" />],
  ['tsx', <SiTypescript color="#3178c6" key="tsx" />],
  ['css', <FaCss3Alt color="#1572b6" key="css" />],
  ['html', <FaHtml5 color="#e34f26" key="html" />],
  ['htm', <FaHtml5 color="#e34f26" key="htm" />],
  ['json', <VscJson color="#f9d71c" key="json" />],
  ['jsonl', <VscJson color="#e6a23c" key="jsonl" />],
  ['md', <FaMarkdown color="#083fa1" key="md" />],
  ['csv', <FaFile color="#00a86b" key="csv" />],
  ['pdf', <FaFilePdf color="#d63031" key="pdf" />],
  ['ppt', <FaFileWord color="#d63031" key="ppt" />],
  ['pptx', <FaFileWord color="#d63031" key="pptx" />],
  ['ico', <FaImage color="#a9a9a9" key="ico" />],
  ['png', <FaImage color="#a9a9a9" key="png" />],
  ['jpg', <FaImage color="#a9a9a9" key="jpg" />],
  ['jpeg', <FaImage color="#a9a9a9" key="jpeg" />],
  ['gif', <FaImage color="#a9a9a9" key="gif" />],
  ['svg', <FaImage color="#a9a9a9" key="svg" />],
  ['webp', <FaImage color="#a9a9a9" key="webp" />],
  ['py', <FaPython color="#3776ab" key="py" />],
  ['java', <FaJava color="#007396" key="java" />],
]);

const FileIcon: React.FC<{ node: NodeApi<FileTreeItem> }> = ({ node }) => {
  const isHidden = node.data.isHidden;
  
  if (node.data.isDirectory) {
    // 如果目录已展开，就显示为打开状态，不管是否有子项
    // 这样空目录展开时也能正确显示为打开状态
    const folderColor = isHidden ? "#9ca3af" : "#87b3d6"; // 隐藏文件夹使用灰色
    return node.isOpen ? 
      <FaFolderOpen color={folderColor} /> : 
      <FaFolder color={folderColor} />;
  }
  
  const extension = node.data.name.split('.').pop()?.toLowerCase() || '';
  const defaultColor = isHidden ? "#9ca3af" : "#6d8a9f"; // 隐藏文件使用灰色
  
  // 为隐藏文件添加透明度样式
  const iconStyle = isHidden ? { opacity: 0.6 } : {};
  
  return (
    <span style={iconStyle}>
      {ICON_MAP.get(extension) || <FaFile color={defaultColor} />}
    </span>
  );
};

// 获取语言类型
const getLanguageForFile = (fileName: string = ''): string => {
  // 特殊文件名处理
  const lowerFileName = fileName.toLowerCase();
  if (lowerFileName === 'dockerfile' || lowerFileName.startsWith('dockerfile.')) {
    return 'dockerfile';
  }

  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  switch (extension) {
    case 'js': case 'jsx': return 'javascript';
    case 'ts': case 'tsx': return 'typescript';
    case 'css': case 'scss': case 'sass': case 'less': return 'css';
    case 'json': case 'jsonl': return 'json';
    case 'html': case 'htm': return 'html';
    case 'md': case 'markdown': return 'markdown';
    case 'csv': return 'csv';
    case 'py': return 'python';
    case 'java': return 'java';
    case 'xml': return 'xml';
    case 'yaml': case 'yml': return 'yaml';
    case 'sh': case 'bash': return 'shell';
    case 'conf': case 'config': case 'ini': return 'ini';
    case 'nginx': return 'nginx';
    case 'sql': return 'sql';
    case 'go': return 'go';
    case 'rs': return 'rust';
    case 'c': case 'cpp': case 'cc': case 'cxx': return 'cpp';
    case 'h': case 'hpp': return 'cpp';
    case 'cs': return 'csharp';
    case 'php': return 'php';
    case 'rb': return 'ruby';
    case 'swift': return 'swift';
    case 'kt': return 'kotlin';
    case 'dockerfile': return 'dockerfile';
    default: return 'plaintext';
  }
};

// 简单的图片预览组件 - 使用 fetch + blob 来支持认证
const SimpleImagePreview: React.FC<{ imageUrl: string; fileName: string }> = ({ imageUrl, fileName }) => {
  const { t } = useTranslation('components');
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    // 使用 authFetch 加载图片（支持认证）
    let currentBlobUrl: string | null = null;
    
    const loadImage = async () => {
      try {
        setIsLoading(true);
        setHasError(false);
        
        const response = await authFetch(imageUrl);
        if (!response.ok) {
          throw new Error(`Failed to load image: ${response.status}`);
        }
        
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        currentBlobUrl = url;
        setBlobUrl(url);
        setIsLoading(false);
      } catch (error) {
        console.error('Failed to load image:', error);
        setIsLoading(false);
        setHasError(true);
      }
    };

    loadImage();

    // 清理 blob URL
    return () => {
      if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl);
      }
    };
  }, [imageUrl]);

  return (
    <div className="flex items-center justify-center h-full p-4">
      {hasError ? (
        <div className="text-center text-gray-500">
          <FaImage className="w-12 h-12 mx-auto mb-4 text-gray-300" />
          <p>{t('fileExplorer.imageLoadFailed')}</p>
          <p className="text-sm mt-2">{fileName}</p>
        </div>
      ) : (
        <div className="relative max-w-full max-h-full">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            </div>
          )}
          {blobUrl && (
            <img
              src={blobUrl}
              alt={fileName}
              className="max-w-full max-h-full object-contain bg-white dark:bg-gray-900 rounded shadow-lg"
              onLoad={() => setIsLoading(false)}
              onError={() => {
                setIsLoading(false);
                setHasError(true);
              }}
              style={{ display: hasError ? 'none' : 'block' }}
            />
          )}
        </div>
      )}
    </div>
  );
};

// 判断文件类型
const getFileType = (fileName: string): 'text' | 'image' | 'binary' => {
  // 特殊文件名处理
  const lowerFileName = fileName.toLowerCase();
  if (lowerFileName === 'dockerfile' || lowerFileName.startsWith('dockerfile.')) {
    return 'text';
  }

  const extension = fileName.split('.').pop()?.toLowerCase() || '';

  const textExtensions = [
    'js', 'jsx', 'ts', 'tsx', 'css', 'scss', 'sass', 'less',
    'html', 'htm', 'json', 'jsonl', 'md', 'markdown', 'txt',
    'py', 'java', 'xml', 'yaml', 'yml',
    'sh', 'bash', 'bat', 'cmd',
    'php', 'rb', 'go', 'rs',
    'cpp', 'c', 'h', 'hpp', 'cc', 'cxx',
    'cs', 'swift', 'kt', 'scala', 'clj',
    'sql', 'dockerfile', 'gitignore', 'env',
    'csv', 'tsv',
    'conf', 'config', 'ini', 'toml',
    'nginx', 'apache',
    'properties', 'cfg'
  ];

  const imageExtensions = [
    'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'tiff'
  ];

  if (textExtensions.includes(extension)) return 'text';
  if (imageExtensions.includes(extension)) return 'image';
  return 'binary';
};

const isHtmlFile = (fileName: string): boolean => {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return ext === 'html' || ext === 'htm';
};

// 自定义节点渲染组件
const Node: React.FC<{ 
  node: NodeApi<FileTreeItem>; 
  style: React.CSSProperties; 
  dragHandle?: (el: HTMLDivElement | null) => void;
  isLoading?: boolean;
  onDirectoryToggle?: (node: NodeApi<FileTreeItem>) => void;
  onFileSelect?: (node: NodeApi<FileTreeItem>) => void;
}> = ({ 
  node, 
  style, 
  dragHandle,
  isLoading = false,
  onDirectoryToggle,
  onFileSelect
}) => {
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); // 阻止默认行为
    e.stopPropagation(); // 阻止事件冒泡
    
    if (node.data.isDirectory) {
      onDirectoryToggle?.(node);
    } else {
      onFileSelect?.(node);
    }
  }, [node, onDirectoryToggle, onFileSelect]);

  return (
    <div
      style={style}
      ref={dragHandle}
      className={`flex items-center cursor-pointer px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 ${
        node.isSelected ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-900 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'
      }`}
      onClick={handleClick}
    >
      {/* 展开/收起箭头 - 只对文件夹显示 */}
      {node.data.isDirectory && (
        <span className="mr-1 flex items-center">
          {isLoading ? (
            <Loader2 className="w-3 h-3 animate-spin text-gray-400" />
          ) : (
            <ChevronRight className={`w-3 h-3 transition-transform text-gray-400 ${
              node.isOpen ? 'rotate-90' : ''
            }`} />
          )}
        </span>
      )}
      
      {/* 文件/文件夹图标 */}
      <span className="mr-2 flex items-center">
        <FileIcon node={node} />
      </span>
      
      {/* 文件/文件夹名称 */}
      <span className={`text-sm truncate flex-1 ${
        node.data.isHidden 
          ? 'text-gray-400 dark:text-gray-500 italic' 
          : 'text-gray-700 dark:text-gray-300'
      }`}>
        {node.data.name}
      </span>

      {/* 文件大小信息 - 只对文件显示 */}
      {!node.data.isDirectory && node.data.size && (
        <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">
          {(node.data.size / 1024).toFixed(1)}KB
        </span>
      )}
    </div>
  );
};

// 常量定义
const MAX_VISIBLE_TABS = 5; // 最多显示的标签数量

export const FileExplorer: React.FC<FileExplorerProps> = ({
  projectPath,
  onFileSelect,
  className = '',
  height = '100vh'
}) => {
  const { t } = useTranslation('components');
  const [tabs, setTabs] = useState<FileTab[]>([]);
  const [temporaryTabId, setTemporaryTabId] = useState<string | null>(null); // 临时标签ID
  const [containerHeight, setContainerHeight] = useState<number>(600);
  const [showTabDropdown, setShowTabDropdown] = useState<boolean>(false);
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const tabDropdownRef = useRef<HTMLDivElement>(null);
  const treeApiRef = useRef<TreeApi<FileTreeItem> | null>(null);
  const [lastClickTime, setLastClickTime] = useState<number>(0);
  const [lastClickedPath, setLastClickedPath] = useState<string>('');

  // 暗色模式检测
  const [isDarkMode, setIsDarkMode] = useState<boolean>(
    document.documentElement.classList.contains('dark')
  );

  // 懒加载相关状态
  const [loadedDirectories, setLoadedDirectories] = useState<Set<string>>(new Set());
  const [dynamicTreeData, setDynamicTreeData] = useState<FileTreeItem[]>([]);
  const [loadingDirectories, setLoadingDirectories] = useState<Set<string>>(new Set());
  const [showHiddenFiles, setShowHiddenFiles] = useState<boolean>(false);
  
  // 控制左侧目录面板的显示/隐藏
  const [isTreePanelCollapsed, setIsTreePanelCollapsed] = useState<boolean>(false);
  
  // HTML 预览模式：source 显示源码，preview 显示渲染效果
  const [htmlPreviewMode, setHtmlPreviewMode] = useState<'source' | 'preview'>('preview');

  // 获取项目ID用于媒体文件访问（暂时注释掉，未使用）
  // const { data: projectData } = useProjectId(projectPath);
  
  // 使用新的文件树 hook，懒加载根目录
  const { 
    data: fileTreeData, 
    isLoading: isTreeLoading, 
    error: treeError,
    refetch: refetchTree
  } = useFileTree(projectPath, showHiddenFiles);
  
  // 获取当前活跃的标签（直接从 tabs 获取，避免额外的状态依赖）
  const activeTab = useMemo(() => {
    return tabs.find(tab => tab.isActive) || null;
  }, [tabs]);

  // 读取当前活跃标签的文件内容
  const { 
    data: fileContentData, 
    isLoading: isContentLoading,
    error: contentError
  } = useFileContent(
    activeTab ? activeTab.path : undefined,
    projectPath
  );

  // 监听暗色模式变化
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          setIsDarkMode(document.documentElement.classList.contains('dark'));
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, []);

  // 初始化动态树数据
  useEffect(() => {
    if (fileTreeData) {
      const convertToTreeData = (items: FileSystemItem[]): FileTreeItem[] => {
        return items
          // 根据 showHiddenFiles 状态进行客户端过滤
          .filter(item => showHiddenFiles || !item.isHidden)
          .map(item => {
            const treeItem = {
              id: item.path,
              name: item.name,
              path: item.path,
              isDirectory: item.isDirectory,
              size: item.size,
              modified: item.modified,
              isHidden: item.isHidden,
              children: item.children ? convertToTreeData(item.children) : undefined,
            };


            return treeItem;
          });
      };
      
      // 收集所有已经有子项的目录路径，标记为已加载
      const collectLoadedDirectories = (items: FileSystemItem[], loaded: Set<string> = new Set()): Set<string> => {
        items.forEach(item => {
          if (item.isDirectory && item.children && item.children.length > 0) {
            loaded.add(item.path);
            collectLoadedDirectories(item.children, loaded);
          }
        });
        return loaded;
      };

      const loadedDirs = collectLoadedDirectories(fileTreeData);
      setLoadedDirectories(loadedDirs);
      setDynamicTreeData(convertToTreeData(fileTreeData));
    }
  }, [fileTreeData, showHiddenFiles]);

  // 懒加载目录子项的函数
  const loadDirectoryChildren = useCallback(async (dirPath: string): Promise<void> => {
    if (loadedDirectories.has(dirPath) || loadingDirectories.has(dirPath)) {
      return; // 已加载或正在加载
    }

    setLoadingDirectories(prev => new Set(prev).add(dirPath));

    try {
      const searchParams = new URLSearchParams();
      searchParams.append('path', dirPath);
      if (showHiddenFiles) {
        searchParams.append('showHiddenFiles', 'true');
      }

      const response = await authFetch(`${API_BASE}/files/browse?${searchParams.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to browse directory');
      }
      
      const data = await response.json();
      const childItems: FileSystemItem[] = [];

      for (const item of data.items) {
        // 后端已经处理了隐藏文件过滤，这里不再需要手动过滤
        
        if (item.isDirectory) {
          childItems.push({
            ...item,
            children: [] // 空数组表示尚未加载
          });
        } else {
          childItems.push(item);
        }
      }

      // 更新动态树数据
      setDynamicTreeData(prevData => {
        const updateChildren = (items: FileTreeItem[]): FileTreeItem[] => {
          return items.map(item => {
            if (item.path === dirPath) {
              const updatedItem = {
                ...item,
                children: childItems.map(child => {
                  const treeChild = {
                    id: child.path,
                    name: child.name,
                    path: child.path,
                    isDirectory: child.isDirectory,
                    size: child.size,
                    modified: child.modified,
                    isHidden: child.isHidden,
                    children: child.isDirectory ? [] : undefined, // 只有目录才有 children 数组
                  };
                  
                  
                  return treeChild;
                })
              };
              return updatedItem;
            } else if (item.children) {
              return {
                ...item,
                children: updateChildren(item.children)
              };
            }
            return item;
          });
        };
        
        return updateChildren(prevData);
      });

      setLoadedDirectories(prev => new Set(prev).add(dirPath));

      // 使用 TreeApi 关闭新加载的子目录，确保它们显示为折叠状态
      // 但是如果当前目录为空，不要关闭它，让用户看到空目录状态
      if (treeApiRef.current && childItems.length > 0) {
        childItems.forEach(child => {
          if (child.isDirectory) {
            // 确保新加载的子目录都是关闭状态
            treeApiRef.current?.close(child.path);
          }
        });
      }
    } catch (error) {
      console.error('Failed to load directory children:', error);
      throw error; // 重新抛出错误，让调用者可以处理
    } finally {
      setLoadingDirectories(prev => {
        const newSet = new Set(prev);
        newSet.delete(dirPath);
        return newSet;
      });
    }
  }, [loadedDirectories, loadingDirectories, showHiddenFiles]);

  // 刷新文件树的统一方法
  const refreshFileTree = useCallback(() => {
    // 重置懒加载状态
    setLoadedDirectories(new Set());
    setLoadingDirectories(new Set());
    // 重新获取根目录数据
    refetchTree();
  }, [refetchTree]);

  // 切换隐藏文件显示状态
  const toggleShowHiddenFiles = useCallback(() => {
    setShowHiddenFiles(prev => !prev);
  }, []);

  // 监听showHiddenFiles变化，重置懒加载状态并强制刷新
  useEffect(() => {
    // 重置懒加载状态
    setLoadedDirectories(new Set());
    setLoadingDirectories(new Set());
    // 强制重新获取数据,绕过React Query缓存
    refetchTree();
  }, [showHiddenFiles, refetchTree]);

  // 移除面包屑导航相关代码，因为我们现在使用树形结构

  // 计算容器高度
  useEffect(() => {
    const updateHeight = () => {
      if (treeContainerRef.current) {
        const containerRect = treeContainerRef.current.getBoundingClientRect();
        // 使用实际容器高度，如果获取不到则使用默认值
        const newHeight = containerRect.height > 0 ? containerRect.height : 600;
        setContainerHeight(newHeight);
      }
    };

    // 使用 ResizeObserver 监听容器大小变化
    let resizeObserver: ResizeObserver | null = null;
    
    if (treeContainerRef.current) {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { height } = entry.contentRect;
          if (height > 0) {
            setContainerHeight(height);
          }
        }
      });
      resizeObserver.observe(treeContainerRef.current);
    }

    // 延迟执行初始计算
    const timer = setTimeout(updateHeight, 100);
    window.addEventListener('resize', updateHeight);
    
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateHeight);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [fileTreeData]); // 当数据变化时重新计算

  // 处理点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (tabDropdownRef.current && !tabDropdownRef.current.contains(event.target as Node)) {
        setShowTabDropdown(false);
      }
    };

    if (showTabDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showTabDropdown]);

  // 监听AI回复完成事件，自动刷新文件浏览器
  useEffect(() => {
    const handleAiResponseComplete = (eventData: { agentId: string; sessionId: string | null; projectPath?: string }) => {
      console.log('🔄 Received AI_RESPONSE_COMPLETE event in FileExplorer:', eventData);
      
      // 检查是否与当前项目路径匹配
      if (eventData.projectPath === projectPath) {
        console.log('🔄 Auto-refreshing file tree after AI response completion');
        refreshFileTree();
      }
    };

    eventBus.on(EVENTS.AI_RESPONSE_COMPLETE, handleAiResponseComplete);

    // 清理事件监听器
    return () => {
      eventBus.off(EVENTS.AI_RESPONSE_COMPLETE, handleAiResponseComplete);
    };
  }, [projectPath, refreshFileTree]);

  // 使用动态树数据，它会在需要时懒加载
  const treeData = dynamicTreeData;

  // 创建初始展开状态 - 明确设置所有目录为关闭状态
  const initialOpenState = useMemo(() => {
    const openState: Record<string, boolean> = {};
    
    const setDirectoriesClosed = (items: FileTreeItem[]) => {
      items.forEach(item => {
        if (item.isDirectory) {
          openState[item.id] = false; // 明确设置为关闭
          if (item.children) {
            setDirectoriesClosed(item.children);
          }
        }
      });
    };
    
    if (dynamicTreeData && dynamicTreeData.length > 0) {
      setDirectoriesClosed(dynamicTreeData);
    }
    
    return openState;
  }, [dynamicTreeData]);

  // 创建新标签页
  const createTab = useCallback((file: FileTreeItem, isPinned: boolean = false): FileTab => {
    return {
      id: `tab-${file.path}`,
      name: file.name,
      path: file.path,
      isPinned,
      isActive: false
    };
  }, []);

  // 添加或激活标签页
  const addOrActivateTab = useCallback((file: FileTreeItem, isPinned: boolean = false) => {
    setTabs(prevTabs => {
      const existingTabIndex = prevTabs.findIndex(tab => tab.path === file.path);
      
      if (existingTabIndex !== -1) {
        // 标签已存在，激活它（只更新 tabs，不单独更新 activeTabId）
        return prevTabs.map((tab, index) => ({
          ...tab,
          isActive: index === existingTabIndex,
          isPinned: isPinned || tab.isPinned
        }));
      } else {
        // 创建新标签
        const newTab = createTab(file, isPinned);
        
        if (!isPinned && temporaryTabId) {
          // 如果是临时标签且已有临时标签，替换临时标签
          // 同时更新 temporaryTabId
          setTemporaryTabId(newTab.id);
          return prevTabs.map(tab => 
            tab.id === temporaryTabId ? { ...newTab, isActive: true } : { ...tab, isActive: false }
          );
        } else {
          // 添加新标签
          if (!isPinned) {
            setTemporaryTabId(newTab.id);
          }
          return [
            ...prevTabs.map(tab => ({ ...tab, isActive: false })),
            { ...newTab, isActive: true }
          ];
        }
      }
    });
    
    onFileSelect?.(file.path);
  }, [createTab, temporaryTabId, onFileSelect]);

  // 关闭标签页
  const closeTab = useCallback((tabId: string) => {
    setTabs(prevTabs => {
      const tabIndex = prevTabs.findIndex(tab => tab.id === tabId);
      if (tabIndex === -1) return prevTabs;
      
      const closingTab = prevTabs[tabIndex];
      const newTabs = prevTabs.filter(tab => tab.id !== tabId);
      
      // 如果关闭的是当前活跃标签，需要激活另一个标签
      if (closingTab.isActive && newTabs.length > 0) {
        // 优先激活相邻的标签
        const newActiveIndex = Math.min(tabIndex, newTabs.length - 1);
        newTabs[newActiveIndex] = { ...newTabs[newActiveIndex], isActive: true };
      }
      
      // 如果关闭的是临时标签，清除临时标签ID
      if (temporaryTabId === tabId) {
        setTemporaryTabId(null);
      }
      
      return newTabs;
    });
  }, [temporaryTabId]);

  // 激活标签页
  const activateTab = useCallback((tabId: string) => {
    setTabs(prevTabs => 
      prevTabs.map(tab => ({
        ...tab,
        isActive: tab.id === tabId
      }))
    );
  }, []);

  // 防抖状态 - 防止双重触发
  const [lastToggleTime, setLastToggleTime] = useState<Record<string, number>>({});

  // 处理目录展开/收起
  const handleDirectoryToggle = useCallback((node: NodeApi<FileTreeItem>) => {
    // 防抖处理 - 防止短时间内重复触发
    const currentTime = Date.now();
    const lastTime = lastToggleTime[node.data.path] || 0;
    if (currentTime - lastTime < 300) {
      return;
    }
    
    setLastToggleTime(prev => ({
      ...prev,
      [node.data.path]: currentTime
    }));

    // 处理目录的展开/收起
    const wasOpen = node.isOpen;
    const hasLoadedChildren = node.data.children && node.data.children.length > 0;
    const hasBeenLoaded = loadedDirectories.has(node.data.path);
    
    if (wasOpen) {
      // 如果目录已经展开，直接收起
      node.close();
    } else {
      // 目录已关闭，需要展开
      if (!hasLoadedChildren && !hasBeenLoaded) {
        // 需要加载子项的情况：先展开目录（显示加载状态），然后加载数据
        node.open(); // 立即展开以显示加载状态
        loadDirectoryChildren(node.data.path).catch(error => {
          console.error('Failed to load directory children:', error);
          // 如果加载失败，关闭目录
          node.close();
        });
      } else {
        // 已经加载过子项但目录是关闭的，直接展开
        node.open();
      }
    }
  }, [lastToggleTime, loadedDirectories, loadDirectoryChildren]);

  // 处理文件选择
  const handleFileSelect = useCallback((node: NodeApi<FileTreeItem>) => {
    // 先选中节点以显示高亮状态
    node.select();
    
    // 检测双击
    const currentTime = Date.now();
    const isDoubleClick = currentTime - lastClickTime < 300 && lastClickedPath === node.data.path;
    
    setLastClickTime(currentTime);
    setLastClickedPath(node.data.path);
    
    if (isDoubleClick) {
      // 双击：打开固定标签
      addOrActivateTab(node.data, true);
    } else {
      // 单击：打开临时标签
      setTimeout(() => {
        // 延迟执行，避免双击时触发单击逻辑
        if (Date.now() - currentTime >= 300) {
          addOrActivateTab(node.data, false);
        }
      }, 300);
    }
  }, [addOrActivateTab, lastClickTime, lastClickedPath]);

  // 渲染文件内容预览
  const renderFilePreview = () => {
    if (!activeTab) {
      return (
        <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
          <div className="text-center">
            <FaFile className="w-12 h-12 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
            <p>{t('fileExplorer.selectFile')}</p>
          </div>
        </div>
      );
    }

    if (isContentLoading) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="flex items-center space-x-2 text-gray-500 dark:text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>{t('fileExplorer.loading')}</span>
          </div>
        </div>
      );
    }

    if (contentError) {
      return (
        <div className="flex items-center justify-center h-full text-red-500 dark:text-red-400">
          <div className="text-center">
            <p className="font-medium">{t('fileExplorer.loadFailed')}</p>
            <p className="text-sm mt-2 bg-red-50 dark:bg-red-900/30 px-3 py-2 rounded border border-red-200 dark:border-red-800">
              {(contentError as Error).message}
            </p>
            <p className="text-xs mt-2 text-gray-500 dark:text-gray-400">
              {activeTab.path}
            </p>
          </div>
        </div>
      );
    }

    const fileType = getFileType(activeTab.name);

    switch (fileType) {
      case 'image': {
        // 创建一个专门用于二进制文件的URL
        const imageParams = new URLSearchParams();
        imageParams.append('path', activeTab.path);
        if (projectPath) {
          imageParams.append('projectPath', projectPath);
        }
        // 添加binary标记，告诉后端这是二进制文件
        imageParams.append('binary', 'true');
        const imageUrl = `${API_BASE}/files/read?${imageParams.toString()}`;
        
        return <SimpleImagePreview imageUrl={imageUrl} fileName={activeTab.name} />;
      }

      case 'text': {
        if (!fileContentData) {
          return (
            <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
              <p>{t('fileExplorer.cannotReadFile')}</p>
            </div>
          );
        }

        const isHtml = isHtmlFile(activeTab.name);

        return (
          <div className="flex flex-col h-full">
            {isHtml && (
              <div className="flex items-center px-3 py-1 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                <div className="flex items-center bg-gray-200 dark:bg-gray-700 rounded-md p-0.5">
                  <button
                    onClick={() => setHtmlPreviewMode('source')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                      htmlPreviewMode === 'source'
                        ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}
                  >
                    <Code2 className="w-3.5 h-3.5" />
                    {t('fileExplorer.sourceCode', 'Source')}
                  </button>
                  <button
                    onClick={() => setHtmlPreviewMode('preview')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                      htmlPreviewMode === 'preview'
                        ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}
                  >
                    <MonitorPlay className="w-3.5 h-3.5" />
                    {t('fileExplorer.preview', 'Preview')}
                  </button>
                </div>
              </div>
            )}
            <div className="flex-1 min-h-0">
              {isHtml && htmlPreviewMode === 'preview' ? (
                <iframe
                  srcDoc={fileContentData.content}
                  sandbox="allow-scripts"
                  className="w-full h-full border-0 bg-white"
                  title={`${activeTab.name} preview`}
                />
              ) : (
                <React.Suspense fallback={
                  <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900"></div>
                  </div>
                }>
                  <Editor
                    height="100%"
                    theme={isDarkMode ? 'vs-dark' : 'vs-light'}
                    language={getLanguageForFile(activeTab.name)}
                    value={fileContentData.content}
                    options={{
                      readOnly: true,
                      minimap: { enabled: false },
                      fontSize: 14,
                      wordWrap: 'on',
                      scrollBeyondLastLine: false,
                    }}
                  />
                </React.Suspense>
              )}
            </div>
          </div>
        );
      }

      default:
        return (
          <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
            <div className="text-center">
              <VscCode className="w-12 h-12 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
              <p>{t('fileExplorer.previewNotSupported')}</p>
              <p className="text-sm mt-2">{t('fileExplorer.fileLabel')}: {activeTab.name}</p>
            </div>
          </div>
        );
    }
  };

  if (treeError) {
    return (
      <div className={`flex items-center justify-center h-full text-red-500 dark:text-red-400 ${className}`} style={{ height }}>
        <div className="text-center">
          <p className="font-medium">{t('fileExplorer.loadFailed')}</p>
          <p className="text-sm mt-2 bg-red-50 dark:bg-red-900/30 px-3 py-2 rounded border border-red-200 dark:border-red-800">
            {(treeError as Error).message}
          </p>
          <p className="text-xs mt-2 text-gray-500 dark:text-gray-400">{t('fileExplorer.projectPath')}: {projectPath}</p>
          <button
            onClick={() => refetchTree()}
            className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
          >
            {t('fileExplorer.retry')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden ${className}`}>
        {/* 文件树侧边栏 */}
      {!isTreePanelCollapsed && (
        <div className="w-80 border-r border-gray-200 dark:border-gray-700 flex flex-col h-full">
          {/* 工具栏 - 统一高度 */}
          <div className="h-12 px-3 border-b border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 flex items-center flex-shrink-0">
            <div className="flex items-center justify-between w-full">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('fileExplorer.title')}</h3>
              <div className="flex items-center space-x-1">
                {/* 显示隐藏文件开关 */}
                <button
                  onClick={toggleShowHiddenFiles}
                  className={`p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors ${
                    showHiddenFiles 
                      ? 'text-blue-600 dark:text-blue-400' 
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                  title={showHiddenFiles ? '隐藏文件和文件夹' : '显示隐藏文件和文件夹'}
                >
                  {showHiddenFiles ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
                <button
                  onClick={refreshFileTree}
                  className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                  title={t('common:actions.refresh')}
                  disabled={isTreeLoading}
                >
                  <RefreshCw className={`w-4 h-4 ${isTreeLoading ? 'animate-spin' : ''}`} />
                </button>
                {/* 折叠按钮 */}
                <button
                  onClick={() => setIsTreePanelCollapsed(true)}
                  className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                  title={t('fileExplorer.collapsePanel')}
                >
                  <PanelLeftClose className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

        {/* 文件树 */}
        <div ref={treeContainerRef} className="flex-1 min-h-0 pl-2">
          {isTreeLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="flex items-center space-x-2 text-gray-500 dark:text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">{t('fileExplorer.loading')}</span>
              </div>
            </div>
          ) : treeData.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-gray-500 dark:text-gray-400">
              <p className="text-sm">{t('fileExplorer.emptyDirectory')}</p>
            </div>
          ) : (
            <Tree
              data={treeData}
              width={320}
              height={containerHeight}
              indent={20}
              rowHeight={36}
              initialOpenState={initialOpenState}
              ref={treeApiRef}
            >
              {(props) => (
                <Node
                  {...props}
                  isLoading={loadingDirectories.has(props.node.data.path)}
                  onDirectoryToggle={handleDirectoryToggle}
                  onFileSelect={handleFileSelect}
                />
              )}
            </Tree>
          )}
        </div>
        </div>
      )}

      {/* 文件预览区域 */}
      <div className="flex-1 flex flex-col h-full">
        {/* 标签栏 - 统一高度 */}
        <div className="h-12 border-b border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 flex items-center flex-shrink-0">
          {/* 展开按钮（当目录面板折叠时显示） */}
          {isTreePanelCollapsed && (
            <button
              onClick={() => setIsTreePanelCollapsed(false)}
              className="p-1.5 mx-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
              title={t('fileExplorer.expandPanel')}
            >
              <PanelLeft className="w-4 h-4" />
            </button>
          )}
          {tabs.length > 0 ? (
            <div className="flex items-center h-full w-full">
              {/* 显示可见的标签 */}
              <div className="flex items-center h-full flex-1">
                {tabs.slice(0, Math.min(MAX_VISIBLE_TABS, tabs.length)).map((tab) => (
                  <div
                    key={tab.id}
                    className={`group relative flex items-center h-full px-3 border-r border-gray-200 dark:border-gray-700 cursor-pointer transition-colors ${
                      tab.isActive
                        ? 'bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                    } ${!tab.isPinned ? 'italic' : ''}`}
                    onClick={() => activateTab(tab.id)}
                    title={`${tab.path} ${tab.isPinned ? '(固定)' : '(临时)'}`}
                    style={{ minWidth: '120px', maxWidth: '180px' }}
                  >
                    <FileIcon node={{ data: { name: tab.name, isDirectory: false } as FileTreeItem, isOpen: false } as NodeApi<FileTreeItem>} />
                    <span className="ml-2 text-sm truncate flex-1">{tab.name}</span>
                    {!tab.isPinned && (
                      <span className="ml-1 text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">•</span>
                    )}
                    <button
                      className="ml-2 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-gray-200 dark:hover:bg-gray-600 transition-opacity flex-shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tab.id);
                      }}
                      title={t('common:actions.close')}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>

              {/* 下拉菜单按钮 (当标签数量超过显示限制时) */}
              {tabs.length > MAX_VISIBLE_TABS && (
                <div className="relative" ref={tabDropdownRef}>
                  <button
                    className="flex items-center h-full px-3 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white transition-colors border-l border-gray-200 dark:border-gray-700"
                    onClick={() => setShowTabDropdown(!showTabDropdown)}
                    title={`${tabs.length - MAX_VISIBLE_TABS} more tabs`}
                  >
                    <MoreHorizontal className="w-4 h-4" />
                    <ChevronDown className="w-3 h-3 ml-1" />
                  </button>

                  {/* 下拉菜单 */}
                  {showTabDropdown && (
                    <div className="absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 min-w-48 max-h-64 overflow-y-auto">
                      {tabs.slice(MAX_VISIBLE_TABS).map((tab) => (
                        <div
                          key={tab.id}
                          className={`flex items-center px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 ${
                            tab.isActive ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-900 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'
                          } ${!tab.isPinned ? 'italic' : ''}`}
                          onClick={() => {
                            activateTab(tab.id);
                            setShowTabDropdown(false);
                          }}
                          title={`${tab.path} ${tab.isPinned ? '(固定)' : '(临时)'}`}
                        >
                          <FileIcon node={{ data: { name: tab.name, isDirectory: false } as FileTreeItem, isOpen: false } as NodeApi<FileTreeItem>} />
                          <span className="ml-2 truncate flex-1">{tab.name}</span>
                          {!tab.isPinned && (
                            <span className="ml-1 text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">•</span>
                          )}
                          <button
                            className="ml-2 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-gray-200 dark:hover:bg-gray-600 transition-opacity flex-shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              closeTab(tab.id);
                            }}
                            title={t('common:actions.close')}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center w-full h-full text-gray-500 dark:text-gray-400">
              <span className="text-sm">{t('fileExplorer.noFiles')}</span>
            </div>
          )}
        </div>

        {/* 预览内容 */}
        <div className="flex-1 bg-gray-50 dark:bg-gray-900 min-h-0">
          {renderFilePreview()}
        </div>
      </div>
    </div>
  );
};