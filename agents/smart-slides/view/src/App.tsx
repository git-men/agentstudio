import React, { useState, useEffect, useCallback } from 'react';
import {
  ChevronDown, Wand2, Image as ImageIcon, FileText, Trash2,
  RefreshCw, Sparkles, Palette, History,
  Globe, ExternalLink, Info, Upload,
  ArrowUp, ArrowDown, Link as LinkIcon,
  Maximize2, PlusCircle, X, List, Loader2
} from 'lucide-react';
import { callEndpoint, onAgentAction } from './lavs';
import { Presentation, PresentationStyle, Slide } from './types';
import { SlideRenderer } from './components/SlideRenderer';

const App: React.FC = () => {
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [styles, setStyles] = useState<PresentationStyle[]>([]);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [sidebarTab, setSidebarTab] = useState<'outline' | 'design'>('outline');
  const [loading, setLoading] = useState(true);
  const [generatingSlides, setGeneratingSlides] = useState<Set<number>>(new Set());
  const [generatingAll, setGeneratingAll] = useState(false);
  const [renderProgress, setRenderProgress] = useState<{ current: number; total: number } | null>(null);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [showRegenModal, setShowRegenModal] = useState(false);
  const [regenInstruction, setRegenInstruction] = useState('');
  const [useCurrentAsRef, setUseCurrentAsRef] = useState(false);
  const isRefining = false;
  const [referenceMode, setReferenceMode] = useState<'auto' | 'none' | string>('auto');
  const [referenceImages, setReferenceImages] = useState<Array<{ id: string; name: string; imageData: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [pres, styleList, refs] = await Promise.all([
        callEndpoint('getPresentation'),
        callEndpoint('listStyles'),
        callEndpoint('listReferences').catch(() => [])
      ]);
      setPresentation(pres);
      setStyles(styleList);
      setReferenceImages(refs || []);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => onAgentAction(loadData), [loadData]);

  const currentSlide = presentation?.slides?.[activeSlideIndex] || null;

  const updateSlideContent = async (field: string, value: any) => {
    if (!presentation) return;
    try {
      const input: any = { index: activeSlideIndex };
      input[field] = value;
      const updated = await callEndpoint('updateSlide', input);
      setPresentation(updated);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleAddSlide = async (atIndex?: number) => {
    try {
      const updated = await callEndpoint('addSlide', { index: atIndex });
      setPresentation(updated);
      if (atIndex !== undefined) setActiveSlideIndex(atIndex);
      else if (updated.slides) setActiveSlideIndex(updated.slides.length - 1);
    } catch (err: any) { setError(err.message); }
  };

  const handleDeleteSlide = async (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    try {
      const updated = await callEndpoint('deleteSlide', { index });
      setPresentation(updated);
      if (activeSlideIndex >= index) setActiveSlideIndex(Math.max(0, activeSlideIndex - 1));
    } catch (err: any) { setError(err.message); }
  };

  const handleMoveSlide = async (e: React.MouseEvent, index: number, direction: -1 | 1) => {
    e.stopPropagation();
    try {
      const updated = await callEndpoint('moveSlide', { index, direction });
      setPresentation(updated);
      if (activeSlideIndex === index) setActiveSlideIndex(index + direction);
    } catch (err: any) { setError(err.message); }
  };

  const handleSetStyle = async (styleId: string) => {
    try {
      const updated = await callEndpoint('setStyle', { styleId });
      setPresentation(updated);
    } catch (err: any) { setError(err.message); }
  };

  const handleSetResolution = async (resolution: '2K' | '4K') => {
    try {
      const updated = await callEndpoint('setStyle', { resolution });
      setPresentation(updated);
    } catch (err: any) { setError(err.message); }
  };

  const checkApiKey = async (): Promise<boolean> => {
    try {
      const config = await callEndpoint('getConfig');
      if (!config?.hasApiKey && !config?.hasSeedDreamKey) {
        setError('请先配置图片生成 API Key（在聊天中告诉 AI，设置 GEMINI_API_KEY 或 SEEDDREAM_API_KEY 环境变量）');
        return false;
      }
      return true;
    } catch { return true; }
  };

  const handleGenerateImage = async (slideIndex: number, instruction?: string, forceUseCurrent?: boolean) => {
    setShowRegenModal(false);
    if (!await checkApiKey()) return;
    setGeneratingSlides(prev => new Set(prev).add(slideIndex));
    try {
      const updated = await callEndpoint('generateImage', {
        slideIndex,
        instruction: instruction || '',
        useCurrentAsRef: forceUseCurrent || false
      });
      setPresentation(updated);
    } catch (err: any) { setError(err.message); }
    finally {
      setGeneratingSlides(prev => {
        const next = new Set(prev);
        next.delete(slideIndex);
        return next;
      });
    }
  };

  const handleGenerateAll = async () => {
    if (!presentation) return;
    if (!await checkApiKey()) return;
    setGeneratingAll(true);
    setRenderProgress({ current: 0, total: presentation.slides.length });
    try {
      const progressInterval = setInterval(async () => {
        try {
          const current = await callEndpoint('getPresentation');
          if (current) {
            setPresentation(current);
            const generated = current.slides.filter((s: any) => !!s.imageUrl).length;
            setRenderProgress({ current: generated, total: current.slides.length });
          }
        } catch {}
      }, 5000);
      const genParams: any = { startIndex: 0 };
      if (referenceMode === 'auto') {
        genParams.styleFollowing = true;
      } else if (referenceMode === 'none') {
        genParams.styleFollowing = false;
      } else {
        genParams.styleFollowing = false;
        genParams.referenceId = referenceMode;
      }
      const updated = await callEndpoint('generateAllImages', genParams);
      clearInterval(progressInterval);
      setPresentation(updated);
    } catch (err: any) { setError(err.message); }
    finally {
      setGeneratingAll(false);
      setRenderProgress(null);
    }
  };

  const handleUploadReference = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const result = await callEndpoint('uploadReference', {
            imageData: reader.result as string,
            name: file.name.replace(/\.[^.]+$/, '')
          });
          setReferenceImages(prev => [...prev, result]);
          setReferenceMode(result.id);
        } catch (err: any) { setError(err.message); }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const handleDeleteReference = async (id: string) => {
    try {
      await callEndpoint('deleteReference', { id });
      setReferenceImages(prev => prev.filter(r => r.id !== id));
      if (referenceMode === id) setReferenceMode('auto');
    } catch (err: any) { setError(err.message); }
  };

  const restoreVersion = async (version: { url: string; title: string; body: string[] }) => {
    if (!presentation) return;
    try {
      const updated = await callEndpoint('updateSlide', {
        index: activeSlideIndex,
        title: version.title,
        body: version.body
      });
      setPresentation(updated);
    } catch (err: any) { setError(err.message); }
  };

  if (loading) {
    return (
      <div className="flex h-screen bg-slate-900 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="animate-spin text-indigo-400" size={32} />
          <span className="text-slate-400 text-sm">加载中...</span>
        </div>
      </div>
    );
  }

  const isEmpty = !presentation || presentation.slides.length === 0;

  if (isEmpty) {
    return (
      <div className="flex h-screen items-center justify-center p-8" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)' }}>
        <div className="text-center max-w-lg">
          <div className="relative mx-auto mb-8 w-24 h-24">
            <div className="absolute inset-0 bg-indigo-500/20 rounded-3xl blur-xl animate-pulse" />
            <div className="relative w-24 h-24 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 rounded-3xl flex items-center justify-center shadow-2xl shadow-indigo-500/30 transform rotate-3 hover:rotate-0 transition-transform duration-500">
              <Sparkles className="text-white" size={40} />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">智能 PPT</h2>
          <p className="text-indigo-300/60 text-xs font-mono uppercase tracking-[0.3em] mb-6">AI-Powered Presentation Designer</p>
          <p className="text-slate-400 text-sm leading-relaxed mb-8 max-w-sm mx-auto">
            在左侧对话框中描述你的演讲主题，AI 会帮你规划大纲结构，并渲染精美的幻灯片图片。
          </p>
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-5 text-left max-w-sm mx-auto">
            <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <Sparkles size={10} /> 试试这样说
            </p>
            <ul className="text-sm text-slate-300 space-y-3">
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">1</span>
                <span>帮我做一个关于 AI 发展趋势的演讲稿</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">2</span>
                <span>创建一个产品发布会 PPT，10 页左右</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-pink-500/20 text-pink-400 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">3</span>
                <span>用赛博科技风格做一个技术分享演讲稿</span>
              </li>
            </ul>
          </div>
          <div className="mt-6 flex items-center justify-center gap-4 text-[10px] text-slate-600 uppercase tracking-widest">
            <span>12 种风格</span>
            <span className="w-1 h-1 rounded-full bg-slate-700" />
            <span>智能大纲</span>
            <span className="w-1 h-1 rounded-full bg-slate-700" />
            <span>AI 图片渲染</span>
          </div>
        </div>
      </div>
    );
  }

  const isSlideGenerating = (idx: number) => generatingSlides.has(idx) || generatingAll;

  return (
    <div className="flex h-screen bg-slate-900 text-slate-100 overflow-hidden font-sans relative">
      {/* Error Toast */}
      {error && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[600] bg-red-500/90 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 shadow-xl backdrop-blur-sm">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="hover:bg-white/20 p-0.5 rounded"><X size={12} /></button>
        </div>
      )}

      {/* Left Sidebar */}
      <div className="w-72 bg-slate-950 border-r border-slate-800 flex flex-col z-20 shadow-2xl shrink-0">
        <div className="p-3 border-b border-slate-800">
          <h2 className="font-bold truncate text-sm text-slate-200 flex items-center gap-2">
            <Sparkles size={14} className="text-indigo-400" />
            {presentation?.title || '未命名演讲稿'}
          </h2>
        </div>

        <div className="flex p-1 bg-slate-900 mx-2 mt-2 rounded-lg border border-slate-800">
          <button onClick={() => setSidebarTab('outline')} className={`flex-1 py-1.5 text-[10px] font-bold rounded-md flex items-center justify-center gap-1.5 transition-all ${sidebarTab === 'outline' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}>
            <List size={12} /> 大纲
          </button>
          <button onClick={() => setSidebarTab('design')} className={`flex-1 py-1.5 text-[10px] font-bold rounded-md flex items-center justify-center gap-1.5 transition-all ${sidebarTab === 'design' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}>
            <Palette size={12} /> 风格
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {sidebarTab === 'outline' ? (
            <div className="space-y-0">
              {/* Sources */}
              {presentation?.sources && presentation.sources.length > 0 && (
                <div className="mb-3 bg-slate-900/50 rounded-lg border border-slate-800 overflow-hidden">
                  <details className="group">
                    <summary className="flex items-center justify-between p-2 cursor-pointer text-[10px] font-bold text-slate-500 uppercase tracking-widest list-none">
                      <div className="flex items-center gap-1.5"><Globe size={10} /> 参考源 ({presentation.sources.length})</div>
                      <ChevronDown size={10} className="group-open:rotate-180 transition-transform" />
                    </summary>
                    <div className="p-2 pt-0 space-y-1">
                      {presentation.sources.map((s, i) => (
                        <a key={i} href={s.uri} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[9px] text-blue-400 hover:text-blue-300 bg-blue-500/5 p-1 rounded truncate">
                          <ExternalLink size={8} className="shrink-0" />
                          <span className="truncate">{s.title}</span>
                        </a>
                      ))}
                    </div>
                  </details>
                </div>
              )}

              {/* Slide List */}
              {presentation?.slides.map((slide, idx) => (
                <React.Fragment key={slide.id}>
                  <div
                    onClick={() => setActiveSlideIndex(idx)}
                    className={`group relative p-2 rounded-lg cursor-pointer transition-all border ${activeSlideIndex === idx ? 'bg-indigo-900/20 border-indigo-500 shadow-lg shadow-indigo-900/10' : 'bg-transparent border-transparent hover:bg-slate-900 hover:border-slate-800'}`}
                  >
                    <div className="flex justify-between items-center mb-0.5">
                      <span className={`text-[9px] font-bold uppercase ${activeSlideIndex === idx ? 'text-indigo-400' : 'text-slate-600'}`}>P{idx + 1}</span>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={(e) => handleMoveSlide(e, idx, -1)} disabled={idx === 0} className="p-0.5 hover:bg-slate-700 rounded text-slate-400 hover:text-white disabled:opacity-20"><ArrowUp size={9} /></button>
                        <button onClick={(e) => handleMoveSlide(e, idx, 1)} disabled={idx === presentation!.slides.length - 1} className="p-0.5 hover:bg-slate-700 rounded text-slate-400 hover:text-white disabled:opacity-20"><ArrowDown size={9} /></button>
                        <button onClick={(e) => { e.stopPropagation(); handleAddSlide(idx + 1); }} className="p-0.5 hover:bg-indigo-500/20 text-indigo-400 rounded"><PlusCircle size={9} /></button>
                        <button onClick={(e) => handleDeleteSlide(e, idx)} className="p-0.5 hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded"><Trash2 size={9} /></button>
                      </div>
                      {isSlideGenerating(idx) && <RefreshCw size={9} className="animate-spin text-indigo-400 absolute right-2 top-2" />}
                    </div>
                    <p className={`text-[11px] font-medium truncate pr-2 ${activeSlideIndex === idx ? 'text-white' : 'text-slate-400'}`}>{slide.content.title}</p>
                  </div>
                  <div className="group/insert py-0.5 flex justify-center opacity-0 hover:opacity-100 transition-opacity">
                    <button onClick={() => handleAddSlide(idx + 1)} className="bg-indigo-600/10 hover:bg-indigo-600/30 text-indigo-400 p-0.5 rounded-full border border-indigo-500/10"><PlusCircle size={10} /></button>
                  </div>
                </React.Fragment>
              ))}

              <button onClick={() => handleAddSlide()} className="w-full py-2 mt-1 border border-dashed border-slate-800 hover:border-indigo-500/50 text-slate-500 hover:text-indigo-400 rounded-lg flex items-center justify-center gap-1.5 text-[9px] font-bold uppercase tracking-widest transition-all">
                <PlusCircle size={12} /> 追加新页面
              </button>
            </div>
          ) : (
            <div className="space-y-5 px-1 py-2">
              {/* 基础幻灯片风格 - 下拉选择 */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 mb-2 block">基础幻灯片风格</label>
                <div className="relative">
                  <select
                    value={presentation?.styleId || ''}
                    onChange={(e) => handleSetStyle(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-slate-200 appearance-none outline-none focus:border-indigo-500 transition-colors cursor-pointer"
                  >
                    {styles.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                </div>
                {(() => {
                  const activeStyle = styles.find(s => s.id === presentation?.styleId);
                  return activeStyle ? (
                    <p className="text-[9px] text-slate-600 mt-1.5 px-1 leading-relaxed">{activeStyle.description}</p>
                  ) : null;
                })()}
              </div>

              {/* 渲染分辨率 */}
              <div className="bg-slate-900 rounded-xl border border-slate-800 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-400">渲染分辨率</span>
                  <div className="flex bg-slate-950 p-0.5 rounded-lg border border-slate-800">
                    {(['2K', '4K'] as const).map(res => (
                      <button key={res} onClick={() => handleSetResolution(res)} className={`px-3 py-1.5 text-[10px] font-bold rounded-md transition-all ${presentation?.resolution === res ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}>{res}</button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 视觉参考图库 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] font-bold text-slate-400">视觉参考图库</label>
                  <button onClick={handleUploadReference} className="flex items-center gap-1 text-[9px] text-indigo-400 hover:text-indigo-300 transition-colors">
                    <Upload size={10} /> 上传
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setReferenceMode('auto')}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all min-w-[72px] ${referenceMode === 'auto' ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-800 bg-slate-900 hover:border-slate-700'}`}
                  >
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${referenceMode === 'auto' ? 'bg-indigo-500/20' : 'bg-slate-800'}`}>
                      <RefreshCw size={18} className={referenceMode === 'auto' ? 'text-indigo-400' : 'text-slate-500'} />
                    </div>
                    <span className={`text-[10px] font-bold ${referenceMode === 'auto' ? 'text-indigo-400' : 'text-slate-500'}`}>自动</span>
                  </button>
                  <button
                    onClick={() => setReferenceMode('none')}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all min-w-[72px] ${referenceMode === 'none' ? 'border-red-500/60 bg-red-500/10' : 'border-slate-800 bg-slate-900 hover:border-slate-700'}`}
                  >
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${referenceMode === 'none' ? 'bg-red-500/20' : 'bg-slate-800'}`}>
                      <X size={18} className={referenceMode === 'none' ? 'text-red-400' : 'text-slate-500'} />
                    </div>
                    <span className={`text-[10px] font-bold ${referenceMode === 'none' ? 'text-red-400' : 'text-slate-500'}`}>无</span>
                  </button>
                  {referenceImages.map(ref => (
                    <button
                      key={ref.id}
                      onClick={() => setReferenceMode(ref.id)}
                      className={`group relative flex flex-col items-center gap-1 p-1.5 rounded-xl border-2 transition-all min-w-[72px] ${referenceMode === ref.id ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-800 bg-slate-900 hover:border-slate-700'}`}
                    >
                      <div className="w-14 h-10 rounded-lg overflow-hidden bg-slate-800">
                        <img src={ref.imageData} alt={ref.name} className="w-full h-full object-cover" />
                      </div>
                      <span className={`text-[8px] font-medium truncate max-w-[64px] ${referenceMode === ref.id ? 'text-indigo-400' : 'text-slate-500'}`}>{ref.name}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteReference(ref.id); }}
                        className="absolute -top-1 -right-1 w-4 h-4 bg-red-500/80 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X size={8} className="text-white" />
                      </button>
                    </button>
                  ))}
                </div>
                <p className="text-[9px] text-indigo-400/60 mt-2 px-1 leading-relaxed">
                  提示: 选中图后，后续生成将以此为风格基调。
                </p>
              </div>

              {/* 提示 */}
              <div className="p-2 bg-slate-900/50 border border-dashed border-slate-800 rounded-lg">
                <p className="text-[9px] text-slate-500 text-center leading-relaxed">
                  想优化大纲？在左侧聊天中直接告诉 AI 即可
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Actions */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/80">
          <button
            onClick={handleGenerateAll}
            disabled={generatingAll || isRefining}
            className="w-full py-2.5 bg-gradient-to-br from-indigo-600 via-indigo-500 to-purple-600 rounded-xl font-bold text-[10px] hover:from-indigo-500 hover:to-purple-500 flex items-center justify-center gap-2 shadow-xl shadow-indigo-950/40 transition-all border border-white/5 active:scale-95 disabled:opacity-50"
          >
            {generatingAll ? <><RefreshCw size={14} className="animate-spin" /> 正在渲染 {renderProgress ? `${renderProgress.current}/${renderProgress.total}` : ''}...</> : <><Wand2 size={14} /> 一键生成所有图片</>}
          </button>
        </div>
      </div>

      {/* Main Editor Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative z-10 bg-slate-900/50">
        {/* Toolbar */}
        <div className="h-12 border-b border-slate-800 flex items-center px-4 justify-between bg-slate-950/50 backdrop-blur-md z-10 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-slate-500 uppercase">
              {currentSlide ? `P${activeSlideIndex + 1} / ${presentation?.slides.length}` : ''}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowHistoryPanel(!showHistoryPanel)}
              className={`px-2 py-1 border rounded-md text-[10px] font-bold flex items-center gap-1.5 transition-colors ${showHistoryPanel ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}`}
            >
              <History size={12} /> 历史 ({currentSlide?.imageHistory?.length || 0})
            </button>
            {isSlideGenerating(activeSlideIndex) ? (
              <span className="px-2 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-md text-[10px] font-bold flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" /> 生成中...
              </span>
            ) : (
              <button
                onClick={() => { setRegenInstruction(currentSlide?.content.imageDescription || ''); setUseCurrentAsRef(false); setShowRegenModal(true); }}
                disabled={!currentSlide}
                className="px-2 py-1 bg-indigo-600 rounded-md text-[10px] font-bold flex items-center gap-1.5 hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-900/20 disabled:opacity-50"
              >
                <ImageIcon size={12} /> 生成单页图片
              </button>
            )}
          </div>
        </div>

        {/* Slide Preview */}
        <div className="flex-1 overflow-auto p-6 flex flex-col items-center">
          <div className="w-full max-w-4xl aspect-video bg-white shadow-[0_15px_40px_rgba(0,0,0,0.5)] rounded-xl overflow-hidden ring-1 ring-white/10 relative">
            {currentSlide ? (
              <SlideRenderer slide={currentSlide} isGenerating={isSlideGenerating(activeSlideIndex)} />
            ) : (
              <div className="w-full h-full bg-slate-950 flex flex-col items-center justify-center text-slate-600">
                <Sparkles size={36} className="opacity-10 animate-pulse mb-3" />
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] opacity-40">选择一个幻灯片</p>
              </div>
            )}
          </div>

          {/* Content Editor */}
          {currentSlide && (
            <div className="w-full max-w-4xl mt-6 grid grid-cols-1 md:grid-cols-2 gap-4 pb-8">
              <div className="space-y-3">
                <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5"><FileText size={10} /> 内容</label>
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 shadow-inner space-y-3">
                  <input
                    type="text"
                    value={currentSlide.content.title}
                    onChange={(e) => updateSlideContent('title', e.target.value)}
                    className="w-full bg-transparent text-base font-bold text-white outline-none border-b border-white/5 pb-2 focus:border-indigo-500 transition-colors"
                    placeholder="标题..."
                  />
                  <textarea
                    value={currentSlide.content.body.join('\n')}
                    onChange={(e) => updateSlideContent('body', e.target.value.split('\n'))}
                    rows={4}
                    className="w-full bg-transparent text-xs text-slate-400 outline-none resize-none leading-relaxed"
                    placeholder="要点内容..."
                  />
                </div>
              </div>
              <div className="space-y-3">
                <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5"><Sparkles size={10} /> 视觉构想</label>
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 shadow-inner h-[calc(100%-2rem)]">
                  <textarea
                    value={currentSlide.content.imageDescription}
                    onChange={(e) => updateSlideContent('imageDescription', e.target.value)}
                    rows={4}
                    className="w-full bg-transparent text-[11px] text-slate-400 outline-none resize-none leading-relaxed italic"
                    placeholder="描述这一页的视觉效果..."
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* History Panel */}
      {showHistoryPanel && currentSlide && (
        <div className="w-72 bg-slate-950 border-l border-slate-800 flex flex-col shrink-0 z-20 shadow-2xl">
          <div className="h-12 p-3 border-b border-slate-800 flex justify-between items-center">
            <h3 className="font-bold text-slate-200 flex items-center gap-1.5 text-[10px] uppercase tracking-widest"><History size={12} /> 版本历史</h3>
            <button onClick={() => setShowHistoryPanel(false)} className="text-slate-500 hover:text-slate-300"><X size={14} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {currentSlide.imageHistory && currentSlide.imageHistory.length > 0 ? (
              [...currentSlide.imageHistory].reverse().map((version) => (
                <div key={version.id} className="group bg-slate-900 border border-slate-800 rounded-lg overflow-hidden hover:border-indigo-500/50 transition-all shadow-lg">
                  <div className="aspect-video bg-black relative cursor-zoom-in" onClick={() => setPreviewImage(version.url)}>
                    <img src={version.url} alt="History" className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="bg-black/60 p-1.5 rounded-full backdrop-blur-sm"><Maximize2 size={12} className="text-white" /></div>
                    </div>
                  </div>
                  <div className="p-2 space-y-2">
                    <div className="flex justify-between items-center text-[9px]">
                      <span className="font-mono text-slate-500">{new Date(version.timestamp).toLocaleTimeString()}</span>
                      <span className="font-bold text-slate-600">#{version.id.slice(0, 4)}</span>
                    </div>
                    {version.referenceImageUrl && (
                      <div className="flex items-center gap-1.5 p-1.5 bg-slate-950 rounded border border-slate-800">
                        <div className="w-8 h-5 rounded overflow-hidden ring-1 ring-slate-700 shrink-0 cursor-zoom-in" onClick={(e) => { e.stopPropagation(); setPreviewImage(version.referenceImageUrl!); }}>
                          <img src={version.referenceImageUrl} className="w-full h-full object-cover" alt="Ref" />
                        </div>
                        <span className="text-[8px] font-bold text-slate-500 uppercase flex items-center gap-0.5"><LinkIcon size={8} /> 参考</span>
                      </div>
                    )}
                    <div className="bg-slate-950 rounded border border-slate-800 p-1.5">
                      <p className="text-[9px] text-slate-400 whitespace-pre-wrap leading-relaxed">
                        {version.userInstruction || <span className="italic opacity-50">自动生成</span>}
                      </p>
                    </div>
                    <button
                      onClick={() => restoreVersion(version)}
                      className="w-full py-1.5 bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 rounded text-[9px] font-bold uppercase hover:bg-indigo-600 hover:text-white transition-colors flex items-center justify-center gap-1"
                    >
                      <RefreshCw size={8} /> 恢复
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-16 flex flex-col items-center gap-3 text-slate-600">
                <History size={32} className="opacity-10" />
                <span className="text-[10px] font-bold uppercase tracking-widest">暂无历史</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Image Preview Modal */}
      {previewImage && (
        <div className="fixed inset-0 z-[1000] bg-black/95 flex items-center justify-center p-6" onClick={() => setPreviewImage(null)}>
          <button className="absolute top-6 right-6 p-2 bg-slate-800 rounded-full text-slate-400 hover:text-white hover:bg-slate-700 z-[1010]"><X size={20} /></button>
          <img src={previewImage} className="max-w-full max-h-full object-contain rounded-xl shadow-2xl ring-1 ring-white/10" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {/* Regenerate Image Modal */}
      {showRegenModal && (
        <div className="fixed inset-0 z-[500] bg-black/90 flex items-center justify-center p-4 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-white"><ImageIcon className="text-indigo-500" size={20} /> 生成本页图片</h3>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">视觉微调（可选）</label>
                <textarea value={regenInstruction} onChange={(e) => setRegenInstruction(e.target.value)} placeholder="例如：黑色背景，增加蓝色光圈..." className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm h-24 leading-relaxed outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div
                className={`flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer ${!currentSlide?.imageUrl ? 'opacity-30 pointer-events-none' : 'bg-slate-950 border-slate-800 hover:border-indigo-500/50'}`}
                onClick={() => setUseCurrentAsRef(!useCurrentAsRef)}
              >
                <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${useCurrentAsRef ? 'bg-indigo-600 border-indigo-600' : 'border-slate-700'}`}>
                  {useCurrentAsRef && <span className="text-white text-[10px]">✓</span>}
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-200">继承当前构图与氛围</p>
                  <p className="text-[9px] text-slate-500 mt-0.5 uppercase font-bold">Maintain composition</p>
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowRegenModal(false)} className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 rounded-xl text-sm font-bold transition-colors">取消</button>
              <button
                onClick={() => currentSlide && handleGenerateImage(activeSlideIndex, regenInstruction, useCurrentAsRef)}
                className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-sm font-bold flex justify-center items-center gap-2 shadow-lg shadow-indigo-900/20"
              >
                <Wand2 size={16} /> 开始渲染
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
