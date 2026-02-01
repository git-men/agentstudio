/**
 * Voice Input Hook
 * 语音输入 Hook - 处理录音和语音转文字
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { authFetch } from '../lib/authFetch';
import { API_BASE } from '../lib/config';

// 语音输入状态
export type VoiceInputStatus =
  | 'idle' // 空闲
  | 'recording' // 录音中
  | 'processing' // 处理中
  | 'error'; // 错误

// 语音服务供应商
export type SpeechProvider = 'openai' | 'groq' | 'aliyun' | 'tencent';

// 服务状态
export interface VoiceServiceStatus {
  enabled: boolean;
  availableProviders: SpeechProvider[];
  defaultProvider: SpeechProvider | null;
}

// Hook 返回类型
export interface UseVoiceInputReturn {
  // 状态
  status: VoiceInputStatus;
  isRecording: boolean;
  isProcessing: boolean;
  error: string | null;

  // 服务状态
  serviceStatus: VoiceServiceStatus | null;
  isServiceLoading: boolean;

  // 方法
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<string | null>;
  cancelRecording: () => void;

  // 刷新服务状态
  refreshServiceStatus: () => Promise<void>;
}

// 录音配置
interface RecordingOptions {
  // 自动停止时间 (毫秒, 0 表示不自动停止)
  maxDuration?: number;
  // 语言
  language?: string;
  // 指定供应商
  provider?: SpeechProvider;
}

export function useVoiceInput(options: RecordingOptions = {}): UseVoiceInputReturn {
  const { maxDuration = 60000, language, provider } = options;

  // 状态
  const [status, setStatus] = useState<VoiceInputStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [serviceStatus, setServiceStatus] = useState<VoiceServiceStatus | null>(null);
  const [isServiceLoading, setIsServiceLoading] = useState(true);

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 加载服务状态
  const refreshServiceStatus = useCallback(async () => {
    setIsServiceLoading(true);
    try {
      const response = await authFetch(`${API_BASE}/speech-to-text/status`);
      if (response.ok) {
        const data = await response.json();
        setServiceStatus(data);
      } else {
        setServiceStatus({ enabled: false, availableProviders: [], defaultProvider: null });
      }
    } catch (err) {
      console.error('Failed to load voice service status:', err);
      setServiceStatus({ enabled: false, availableProviders: [], defaultProvider: null });
    } finally {
      setIsServiceLoading(false);
    }
  }, []);

  // 初始化时加载服务状态
  useEffect(() => {
    refreshServiceStatus();
  }, [refreshServiceStatus]);

  // 清理资源
  const cleanup = useCallback(() => {
    // 停止所有音轨
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    // 清除定时器
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // 重置 MediaRecorder
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
  }, []);

  // 开始录音
  const startRecording = useCallback(async () => {
    // 检查服务状态
    if (!serviceStatus?.enabled) {
      setError('语音服务未启用，请先在设置中配置');
      setStatus('error');
      return;
    }

    // 检查浏览器支持
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError('您的浏览器不支持录音功能');
      setStatus('error');
      return;
    }

    // 清理之前的录音
    cleanup();
    setError(null);
    setStatus('recording');

    try {
      // 请求麦克风权限
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        },
      });
      streamRef.current = stream;

      // 创建 MediaRecorder
      // 优先使用 webm/opus，这是大多数浏览器支持的格式
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4';

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 16000,
      });
      mediaRecorderRef.current = mediaRecorder;

      // 收集音频数据
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      // 开始录音
      mediaRecorder.start(100); // 每 100ms 生成一个数据块

      // 设置最大录音时长
      if (maxDuration > 0) {
        timeoutRef.current = setTimeout(() => {
          if (mediaRecorderRef.current?.state === 'recording') {
            mediaRecorderRef.current.stop();
          }
        }, maxDuration);
      }
    } catch (err) {
      console.error('Failed to start recording:', err);
      cleanup();

      if (err instanceof DOMException) {
        if (err.name === 'NotAllowedError') {
          setError('请允许使用麦克风');
        } else if (err.name === 'NotFoundError') {
          setError('未找到麦克风设备');
        } else {
          setError(`录音失败: ${err.message}`);
        }
      } else {
        setError('开始录音失败');
      }
      setStatus('error');
    }
  }, [cleanup, maxDuration, serviceStatus?.enabled]);

  // 停止录音并转写
  const stopRecording = useCallback(async (): Promise<string | null> => {
    if (!mediaRecorderRef.current || status !== 'recording') {
      return null;
    }

    setStatus('processing');

    return new Promise((resolve) => {
      const mediaRecorder = mediaRecorderRef.current!;

      mediaRecorder.onstop = async () => {
        try {
          // 合并音频数据
          const audioBlob = new Blob(audioChunksRef.current, {
            type: mediaRecorder.mimeType,
          });

          // 清理资源
          cleanup();

          // 检查音频大小
          if (audioBlob.size < 1000) {
            setError('录音时间太短');
            setStatus('error');
            resolve(null);
            return;
          }

          // 转换为 base64
          const arrayBuffer = await audioBlob.arrayBuffer();
          const base64Data = btoa(
            new Uint8Array(arrayBuffer).reduce(
              (data, byte) => data + String.fromCharCode(byte),
              ''
            )
          );

          // 确定音频格式
          const audioFormat = mediaRecorder.mimeType.includes('webm')
            ? 'webm'
            : mediaRecorder.mimeType.includes('mp4')
              ? 'm4a'
              : 'webm';

          // 发送到后端进行转写
          const response = await authFetch(`${API_BASE}/speech-to-text/transcribe`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              audioData: base64Data,
              audioFormat,
              language,
              provider,
            }),
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || '转写失败');
          }

          const result = await response.json();
          setStatus('idle');
          resolve(result.text || '');
        } catch (err) {
          console.error('Failed to transcribe audio:', err);
          setError(err instanceof Error ? err.message : '语音转写失败');
          setStatus('error');
          resolve(null);
        }
      };

      mediaRecorder.stop();
    });
  }, [cleanup, language, provider, status]);

  // 取消录音
  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
    }
    cleanup();
    setStatus('idle');
    setError(null);
  }, [cleanup]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    status,
    isRecording: status === 'recording',
    isProcessing: status === 'processing',
    error,
    serviceStatus,
    isServiceLoading,
    startRecording,
    stopRecording,
    cancelRecording,
    refreshServiceStatus,
  };
}

export default useVoiceInput;
