/**
 * useConfirm Hook
 * 
 * 提供类似 window.confirm 的 API，但使用 Modal 组件而非原生弹窗。
 * 这对于自动化测试更友好，因为 MCP 可以检测和操作 DOM 元素。
 * 
 * @example
 * ```tsx
 * const confirm = useConfirm();
 * 
 * const handleDelete = async () => {
 *   const confirmed = await confirm({
 *     title: '删除确认',
 *     message: '确定要删除吗？',
 *     confirmText: '删除',
 *     cancelText: '取消',
 *     variant: 'danger'
 *   });
 *   
 *   if (confirmed) {
 *     // 执行删除
 *   }
 * };
 * ```
 */

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { X, AlertTriangle, Info, HelpCircle } from 'lucide-react';

// 确认对话框配置
export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'danger' | 'warning' | 'info';
}

// 内部状态
interface ConfirmState extends ConfirmOptions {
  isOpen: boolean;
  resolve: ((value: boolean) => void) | null;
}

// Context 类型
interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextType | null>(null);

// 图标映射
const variantIcons = {
  default: HelpCircle,
  danger: AlertTriangle,
  warning: AlertTriangle,
  info: Info,
};

// 颜色映射
const variantColors = {
  default: {
    icon: 'text-blue-500',
    button: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500',
  },
  danger: {
    icon: 'text-red-500',
    button: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
  },
  warning: {
    icon: 'text-yellow-500',
    button: 'bg-yellow-600 hover:bg-yellow-700 focus:ring-yellow-500',
  },
  info: {
    icon: 'text-blue-500',
    button: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500',
  },
};

/**
 * 确认对话框 Provider
 * 需要包裹在应用的根组件中
 */
export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<ConfirmState>({
    isOpen: false,
    message: '',
    resolve: null,
  });
  
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({
        isOpen: true,
        ...options,
        resolve,
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    if (resolveRef.current) {
      resolveRef.current(true);
      resolveRef.current = null;
    }
    setState((prev) => ({ ...prev, isOpen: false, resolve: null }));
  }, []);

  const handleCancel = useCallback(() => {
    if (resolveRef.current) {
      resolveRef.current(false);
      resolveRef.current = null;
    }
    setState((prev) => ({ ...prev, isOpen: false, resolve: null }));
  }, []);

  const variant = state.variant || 'default';
  const Icon = variantIcons[variant];
  const colors = variantColors[variant];

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      
      {/* 确认对话框 */}
      {state.isOpen && (
        <div 
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          aria-describedby="confirm-dialog-description"
          data-testid="confirm-dialog"
        >
          {/* 背景遮罩 */}
          <div 
            className="absolute inset-0 bg-black/50 transition-opacity"
            onClick={handleCancel}
            data-testid="confirm-dialog-backdrop"
          />
          
          {/* 对话框内容 */}
          <div 
            className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden transform transition-all"
            data-testid="confirm-dialog-content"
          >
            {/* 头部 */}
            <div className="flex items-start p-6 pb-4">
              {/* 图标 */}
              <div className={`flex-shrink-0 mr-4 ${colors.icon}`}>
                <Icon size={24} />
              </div>
              
              {/* 标题和消息 */}
              <div className="flex-1 min-w-0">
                {state.title && (
                  <h3 
                    id="confirm-dialog-title"
                    className="text-lg font-semibold text-gray-900 dark:text-white mb-2"
                  >
                    {state.title}
                  </h3>
                )}
                <p 
                  id="confirm-dialog-description"
                  className="text-gray-600 dark:text-gray-300 whitespace-pre-line"
                >
                  {state.message}
                </p>
              </div>
              
              {/* 关闭按钮 */}
              <button
                onClick={handleCancel}
                className="flex-shrink-0 ml-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                data-testid="confirm-dialog-close"
              >
                <X size={20} />
              </button>
            </div>
            
            {/* 按钮组 */}
            <div className="flex justify-end space-x-3 px-6 py-4 bg-gray-50 dark:bg-gray-900/50">
              <button
                onClick={handleCancel}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
                data-testid="confirm-dialog-cancel"
              >
                {state.cancelText || '取消'}
              </button>
              <button
                onClick={handleConfirm}
                className={`px-4 py-2 text-white rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${colors.button}`}
                data-testid="confirm-dialog-confirm"
                autoFocus
              >
                {state.confirmText || '确认'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
};

/**
 * useConfirm hook
 * 
 * @returns confirm 函数，调用后返回 Promise<boolean>
 */
export const useConfirm = (): ((options: ConfirmOptions) => Promise<boolean>) => {
  const context = useContext(ConfirmContext);
  
  if (!context) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  
  return context.confirm;
};

export default useConfirm;
