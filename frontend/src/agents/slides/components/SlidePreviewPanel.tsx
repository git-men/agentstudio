import React, { useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSlides } from '../hooks/useSlides';
import { SlidePreview } from './SlidePreview';
import type { AgentPanelProps } from '../../types.js';
import { eventBus, EVENTS } from '../../../utils/eventBus';

export const SlidePreviewPanel: React.FC<AgentPanelProps> = ({ projectPath }) => {
  const { data: slidesData, isLoading, error } = useSlides(projectPath);
  const queryClient = useQueryClient();
  const slidePreviewRefs = useRef<{ [key: number]: { refreshIframe: () => void } }>({});

  const handleRefresh = () => {
    // Invalidate all slides-related queries to force refresh
    queryClient.invalidateQueries({ queryKey: ['slides', projectPath] });
    queryClient.invalidateQueries({ queryKey: ['slide-content'] });
    
    // Refresh all iframes without re-rendering components
    Object.values(slidePreviewRefs.current).forEach(ref => {
      if (ref?.refreshIframe) {
        ref.refreshIframe();
      }
    });
  };

  // 监听AI回复完成事件，自动刷新内容
  useEffect(() => {
    const handleAiResponseComplete = (eventData: { agentId: string; sessionId: string | null; projectPath?: string }) => {
      console.log('🔄 Received AI_RESPONSE_COMPLETE event in SlidePreviewPanel:', eventData);
      
      // 检查是否与当前项目路径匹配
      if (eventData.projectPath === projectPath) {
        console.log('🔄 Auto-refreshing slides after AI response completion');
        handleRefresh();
      }
    };

    eventBus.on(EVENTS.AI_RESPONSE_COMPLETE, handleAiResponseComplete);

    // 清理事件监听器
    return () => {
      eventBus.off(EVENTS.AI_RESPONSE_COMPLETE, handleAiResponseComplete);
    };
  }, [projectPath, queryClient]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red-500">加载失败，请刷新页面重试</div>
      </div>
    );
  }

  const slides = slidesData?.slides || [];

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header - matching height with left panel */}
      <div className="px-5 py-4 bg-white border-b border-gray-200">
        <div className="flex flex-col">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center space-x-3">
              <h2 className="text-lg font-semibold text-gray-800">幻灯片预览</h2>
              <span className="text-sm text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                {slidesData?.title || 'Presentation'}
              </span>
            </div>
            <button
              onClick={handleRefresh}
              disabled={isLoading}
              className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-blue-50 hover:bg-blue-100 text-blue-600 hover:text-blue-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="刷新幻灯片"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>刷新</span>
            </button>
          </div>
          <div className="text-sm text-gray-600">
            共 {slides.length} 张幻灯片
          </div>
        </div>
      </div>

      {/* Slides List */}
      <div className="flex-1 overflow-y-auto">
        {slides.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 p-5">
            <div className="text-lg mb-2">还没有幻灯片</div>
            <div className="text-sm">与AI聊天来创建幻灯片</div>
          </div>
        ) : (
          <div className="space-y-4 p-5">
            {slides.map((slide) => (
              <SlidePreview
                key={slide.index}
                ref={(ref) => {
                  if (ref) {
                    slidePreviewRefs.current[slide.index] = ref;
                  } else {
                    delete slidePreviewRefs.current[slide.index];
                  }
                }}
                slide={slide}
                totalSlides={slides.length}
                projectPath={projectPath}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
