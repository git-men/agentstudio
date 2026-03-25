import React from 'react';
import { Slide } from '../types';
import { Image as ImageIcon, Loader2, Sparkles } from 'lucide-react';

interface SlideRendererProps {
  slide: Slide;
  isGenerating?: boolean;
}

export const SlideRenderer: React.FC<SlideRendererProps> = ({ slide, isGenerating }) => {
  if (slide.imageUrl) {
    return (
      <div className="w-full h-full relative overflow-hidden bg-black select-none flex items-center justify-center">
        <img
          src={slide.imageUrl}
          alt={slide.content.title}
          className="w-full h-full object-contain"
          loading="eager"
        />
        {isGenerating && (
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm z-20 flex items-center justify-center">
            <div className="flex flex-col items-center bg-slate-900/80 p-6 rounded-2xl border border-white/10 shadow-2xl">
              <div className="relative mb-3">
                <Loader2 className="animate-spin text-blue-400 h-10 w-10" />
                <Sparkles className="absolute inset-0 m-auto text-white h-4 w-4 animate-pulse" />
              </div>
              <p className="text-white font-bold text-sm">AI 正在精心构思设计...</p>
              <p className="text-slate-400 text-[10px] mt-1 uppercase tracking-widest font-mono">Generative Process</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full h-full relative overflow-hidden bg-slate-50 select-none flex flex-col items-center justify-center text-slate-400 p-8 text-center">
      <div className="max-w-md w-full border-2 border-dashed border-slate-200 rounded-2xl p-8 bg-white flex flex-col items-center justify-center shadow-sm">
        <div className="bg-slate-100 p-3 rounded-full mb-4">
          <ImageIcon size={36} className="text-slate-300" />
        </div>
        <h3 className="text-lg font-bold text-slate-800 mb-1">{slide.content.title}</h3>
        <p className="text-xs text-slate-400 px-4">大纲已就绪。点击「生成图片」渲染 AI 幻灯片。</p>
        {isGenerating && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <Loader2 className="animate-spin text-blue-600" size={20} />
            <span className="text-xs font-bold text-blue-600 uppercase tracking-tighter">AI 设计中...</span>
          </div>
        )}
      </div>
    </div>
  );
};
