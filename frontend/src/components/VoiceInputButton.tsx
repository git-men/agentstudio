/**
 * Voice Input Button Component
 * 语音输入按钮组件
 */

import React, { useCallback, useState } from 'react';
import { Mic, MicOff, Loader2, AlertCircle, Settings } from 'lucide-react';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { useTranslation } from 'react-i18next';

export interface VoiceInputButtonProps {
  // 转写完成回调
  onTranscribed: (text: string) => void;
  // 是否禁用
  disabled?: boolean;
  // 语言
  language?: string;
  // 自定义类名
  className?: string;
  // 打开设置的回调
  onOpenSettings?: () => void;
}

export const VoiceInputButton: React.FC<VoiceInputButtonProps> = ({
  onTranscribed,
  disabled = false,
  language,
  className = '',
  onOpenSettings,
}) => {
  const { t } = useTranslation('components');
  const [showTooltip, setShowTooltip] = useState(false);

  const {
    status,
    isRecording,
    isProcessing,
    error,
    serviceStatus,
    isServiceLoading,
    startRecording,
    stopRecording,
    cancelRecording,
  } = useVoiceInput({ language });

  // 处理按钮点击
  const handleClick = useCallback(async () => {
    if (isRecording) {
      // 停止录音并获取转写结果
      const text = await stopRecording();
      if (text) {
        onTranscribed(text);
      }
    } else if (!isProcessing) {
      // 开始录音
      await startRecording();
    }
  }, [isRecording, isProcessing, startRecording, stopRecording, onTranscribed]);

  // 处理长按取消
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (isRecording) {
        cancelRecording();
      }
    },
    [isRecording, cancelRecording]
  );

  // 确定按钮状态和样式
  const getButtonState = () => {
    if (isServiceLoading) {
      return {
        icon: <Loader2 className="w-4 h-4 animate-spin" />,
        title: t('voiceInput.loading', '加载中...'),
        className:
          'text-gray-400 dark:text-gray-500 cursor-wait',
        disabled: true,
      };
    }

    if (!serviceStatus?.enabled) {
      return {
        icon: <MicOff className="w-4 h-4" />,
        title: t('voiceInput.notConfigured', '语音服务未配置，点击配置'),
        className:
          'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700',
        disabled: false,
        showSettings: true,
      };
    }

    if (isProcessing) {
      return {
        icon: <Loader2 className="w-4 h-4 animate-spin" />,
        title: t('voiceInput.processing', '转写中...'),
        className: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30',
        disabled: true,
      };
    }

    if (isRecording) {
      return {
        icon: <Mic className="w-4 h-4 animate-pulse" />,
        title: t('voiceInput.recording', '录音中，点击停止'),
        className:
          'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50',
        disabled: false,
      };
    }

    if (error) {
      return {
        icon: <AlertCircle className="w-4 h-4" />,
        title: error,
        className:
          'text-yellow-600 dark:text-yellow-400 hover:text-yellow-700 dark:hover:text-yellow-300 hover:bg-yellow-50 dark:hover:bg-yellow-900/30',
        disabled: false,
      };
    }

    return {
      icon: <Mic className="w-4 h-4" />,
      title: t('voiceInput.start', '点击开始语音输入'),
      className:
        'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700',
      disabled: false,
    };
  };

  const buttonState = getButtonState();

  // 如果未配置且点击，打开设置
  const handleButtonClick = useCallback(async () => {
    if (buttonState.showSettings && onOpenSettings) {
      onOpenSettings();
      return;
    }
    await handleClick();
  }, [buttonState.showSettings, onOpenSettings, handleClick]);

  return (
    <div className="relative">
      <button
        onClick={handleButtonClick}
        onContextMenu={handleContextMenu}
        disabled={disabled || buttonState.disabled}
        className={`p-2 transition-colors rounded-lg ${buttonState.className} ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        } ${className}`}
        title={buttonState.title}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {buttonState.icon}
      </button>

      {/* 录音提示 */}
      {isRecording && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-red-500 text-white text-xs rounded-lg whitespace-nowrap shadow-lg z-50">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
            <span>{t('voiceInput.recordingHint', '点击停止，右键取消')}</span>
          </div>
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-red-500" />
        </div>
      )}

      {/* 错误提示 */}
      {error && showTooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-yellow-500 text-white text-xs rounded-lg whitespace-nowrap shadow-lg z-50 max-w-[200px]">
          {error}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-yellow-500" />
        </div>
      )}

      {/* 设置图标（未配置时显示） */}
      {buttonState.showSettings && (
        <span className="absolute -top-1 -right-1 w-3 h-3 flex items-center justify-center">
          <Settings className="w-3 h-3 text-gray-400" />
        </span>
      )}
    </div>
  );
};

export default VoiceInputButton;
