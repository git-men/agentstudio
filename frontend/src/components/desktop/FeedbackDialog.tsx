import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, ImagePlus, Loader2, CheckCircle2, AlertCircle, Trash2, MessageSquareWarning } from 'lucide-react';
import { API_BASE } from '../../lib/config';
import { authFetch } from '../../lib/authFetch';
import { getFrontendLogSnapshot } from '../../lib/logCapture';
import { useDesktopUpdate } from '../../contexts/DesktopUpdateContext';

interface ImageAttachment {
  id: string;
  file: File;
  preview: string;
}

interface FeedbackDialogProps {
  onClose: () => void;
  username?: string;
}

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

export const FeedbackDialog: React.FC<FeedbackDialogProps> = ({ onClose, username }) => {
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const desktopUpdate = useDesktopUpdate();

  const [nodeVersion, setNodeVersion] = useState<string>('...');
  const [engineVersion, setEngineVersion] = useState<string>('...');

  useEffect(() => {
    authFetch(`${API_BASE}/feedback/system-info`)
      .then(r => r.json())
      .then((data: { nodeVersion?: string; engineVersion?: string }) => {
        if (data.nodeVersion) setNodeVersion(data.nodeVersion);
        if (data.engineVersion) setEngineVersion(data.engineVersion);
      })
      .catch(() => {
        setNodeVersion('unknown');
        setEngineVersion('unknown');
      });
  }, []);

  const osVersion = navigator.userAgent.includes('Windows')
    ? `Windows ${navigator.userAgent.match(/Windows NT ([\d.]+)/)?.[1] || ''}`
    : navigator.userAgent.includes('Mac')
      ? `macOS ${navigator.userAgent.match(/Mac OS X ([\d_]+)/)?.[1]?.replace(/_/g, '.') || ''}`
      : navigator.platform;

  const addImages = useCallback((files: FileList | File[]) => {
    const allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    const newImages: ImageAttachment[] = [];

    for (const file of Array.from(files)) {
      if (!allowed.includes(file.type)) continue;
      if (images.length + newImages.length >= 5) break;
      newImages.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        preview: URL.createObjectURL(file),
      });
    }

    if (newImages.length > 0) {
      setImages(prev => [...prev, ...newImages]);
    }
  }, [images.length]);

  const removeImage = useCallback((id: string) => {
    setImages(prev => {
      const removed = prev.find(img => img.id === id);
      if (removed) URL.revokeObjectURL(removed.preview);
      return prev.filter(img => img.id !== id);
    });
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      addImages(files);
    }
  }, [addImages]);

  const handleSubmit = async () => {
    if (!description.trim()) return;
    setSubmitState('submitting');
    setErrorMessage('');

    try {
      const imagePayloads = await Promise.all(
        images.map(async (img) => {
          const buf = await img.file.arrayBuffer();
          const base64 = btoa(
            new Uint8Array(buf).reduce((s, b) => s + String.fromCharCode(b), ''),
          );
          return {
            data: base64,
            filename: img.file.name,
            mimeType: img.file.type,
          };
        }),
      );

      const resp = await authFetch(`${API_BASE}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: description.trim(),
          images: imagePayloads,
          frontendLogs: getFrontendLogSnapshot(),
          systemInfo: {
            appVersion: desktopUpdate?.currentVersion || '0.0.0',
            osVersion,
            username: username || '',
            platform: navigator.platform,
            nodeVersion,
            engineVersion,
          },
        }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => null);
        throw new Error(data?.error || `HTTP ${resp.status}`);
      }

      setSubmitState('success');
      setTimeout(onClose, 1500);
    } catch (err) {
      setSubmitState('error');
      setErrorMessage(err instanceof Error ? err.message : '提交失败');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg rounded-xl bg-white dark:bg-gray-900 shadow-2xl p-6 mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">日志反馈</h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Description */}
        <div className="mb-4">
          <label className="flex items-center gap-1 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            <MessageSquareWarning className="w-4 h-4" />
            反馈内容
            <span className="text-red-500">*</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onPaste={handlePaste}
            placeholder="请描述您遇到的问题或建议..."
            maxLength={2000}
            rows={5}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <div className="text-right text-xs text-gray-400 mt-0.5">
            {description.length}/2000
          </div>
        </div>

        {/* Auto log notice */}
        <div className="mb-4">
          <label className="flex items-center gap-1 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            📋 当天日志
          </label>
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
            <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />
            <span className="text-sm text-green-700 dark:text-green-300">
              当天应用日志将自动打包上传
            </span>
          </div>
        </div>

        {/* Image Upload */}
        <div className="mb-4">
          <label className="flex items-center gap-1 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            🖼️ 截图
            <span className="text-xs font-normal text-gray-400 ml-1">
              （可选，支持粘贴或选择文件）
            </span>
          </label>

          <div className="flex flex-wrap gap-2">
            {images.map((img) => (
              <div key={img.id} className="relative w-20 h-20 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 group">
                <img src={img.preview} alt="" className="w-full h-full object-cover" />
                <button
                  onClick={() => removeImage(img.id)}
                  className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="w-4 h-4 text-white" />
                </button>
              </div>
            ))}

            {images.length < 5 && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-20 h-20 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500 flex flex-col items-center justify-center gap-1 text-gray-400 hover:text-blue-500 transition-colors"
              >
                <ImagePlus className="w-5 h-5" />
                <span className="text-[10px]">添加截图</span>
              </button>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addImages(e.target.files);
              e.target.value = '';
            }}
          />
          <p className="text-xs text-gray-400 mt-1">
            Ctrl+V 粘贴截图或选择 PNG/JPG/GIF/WebP 格式，最多 5 张
          </p>
        </div>

        {/* System Info */}
        <div className="mb-5">
          <label className="flex items-center gap-1 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            ℹ️ 系统信息
          </label>
          <div className="flex flex-wrap gap-3">
            <InfoChip label="App 版本" value={desktopUpdate?.currentVersion || '...'} />
            <InfoChip label="系统版本" value={osVersion} />
            <InfoChip label="Node" value={nodeVersion} />
            <InfoChip label="Engine" value={engineVersion} />
            {username && <InfoChip label="用户" value={username} />}
          </div>
        </div>

        {/* Error */}
        {submitState === 'error' && (
          <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-400">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{errorMessage || '提交失败，请重试'}</span>
          </div>
        )}

        {/* Success */}
        {submitState === 'success' && (
          <div className="mb-4 flex items-center gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-sm text-green-700 dark:text-green-400">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>反馈已提交，感谢您的反馈！</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={submitState === 'submitting'}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!description.trim() || submitState === 'submitting' || submitState === 'success'}
            className="px-5 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {submitState === 'submitting' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                提交中…
              </>
            ) : (
              '提交反馈'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

const InfoChip: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
    <div className="text-[10px] text-gray-400 dark:text-gray-500">{label}</div>
    <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-0.5">{value}</div>
  </div>
);
