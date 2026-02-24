import React, { useState, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseToolComponent } from './BaseToolComponent';
import { MessageSquare, CheckCircle, Circle, Send, Check, PenLine } from 'lucide-react';
import type { BaseToolExecution } from './sdk-types';
import { useAgentStore, type PendingFrontendToolCall } from '../../stores/useAgentStore';

const TYPE_SOMETHING_MARKER = '__TYPE_SOMETHING__';

interface SubmitResult {
  success: boolean;
  error?: string;
}

interface AskUserQuestionToolProps {
  execution: BaseToolExecution;
  onSubmit?: (toolCallId: string, result: unknown) => Promise<SubmitResult> | void;
}

export const AskUserQuestionTool: React.FC<AskUserQuestionToolProps> = ({ execution, onSubmit }) => {
  const { t } = useTranslation('components');
  const input = execution.toolInput as any;
  const pendingFrontendTools = useAgentStore(state => state.pendingFrontendTools);

  const [selections, setSelections] = useState<Map<number, string[]>>(new Map());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [customInputs, setCustomInputs] = useState<Map<number, string>>(new Map());
  const inputRefs = useRef<Map<number, HTMLInputElement | null>>(new Map());

  const questions: any[] | null = input?.questions && Array.isArray(input.questions) ? input.questions : null;

  const claudeId = (execution as any).claudeId as string | undefined;

  const matchedPending: PendingFrontendToolCall | null = useMemo(() => {
    if (!questions) return null;

    // Prefer exact toolCallId match via claudeId (Claude SDK tool_use id)
    if (claudeId && pendingFrontendTools.has(claudeId)) {
      return pendingFrontendTools.get(claudeId)!;
    }

    // Fallback: content-based match comparing ALL questions
    for (const pending of pendingFrontendTools.values()) {
      if (pending.toolName !== 'ask_user_question') continue;
      const pendingQs = (pending.args as any)?.questions;
      if (
        pendingQs &&
        pendingQs.length === questions.length &&
        pendingQs.every((q: any, i: number) => q.question === questions[i]?.question)
      ) {
        return pending;
      }
    }
    return null;
  }, [pendingFrontendTools, questions, claudeId]);

  const isInteractive = !!matchedPending && !execution.toolResult && !isSubmitting;

  const parsedResult = useMemo(() => {
    if (!execution.toolResult) return null;
    const raw = String(execution.toolResult);

    // New JSON format: { "questions": [{ "index": 0, "selectedOptions": [...], "customInput": "..." }] }
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.questions && Array.isArray(parsed.questions)) {
        return parsed.questions as Array<{
          index: number;
          selectedOptions: string[];
          customInput: string | null;
        }>;
      }
    } catch { /* not JSON */ }

    // Legacy "User response: ..." format - treat as single-question plain text answer
    const match = raw.match(/^User response:\s*(.+)$/s);
    const text = match ? match[1].trim() : raw.trim();
    return [{ index: 0, selectedOptions: [] as string[], customInput: text }];
  }, [execution.toolResult]);

  const handleOptionClick = useCallback((qIdx: number, optionLabel: string, multiSelect: boolean) => {
    if (!isInteractive) return;
    setSelections(prev => {
      const next = new Map(prev);
      const cur = next.get(qIdx) || [];
      if (multiSelect) {
        if (cur.includes(optionLabel)) {
          next.set(qIdx, cur.filter(l => l !== optionLabel));
        } else {
          next.set(qIdx, [...cur.filter(l => l !== TYPE_SOMETHING_MARKER), optionLabel]);
        }
      } else {
        next.set(qIdx, [optionLabel]);
      }
      return next;
    });
    if (optionLabel !== TYPE_SOMETHING_MARKER) {
      setCustomInputs(prev => { const n = new Map(prev); n.delete(qIdx); return n; });
    }
  }, [isInteractive]);

  const handleTypeSomethingClick = useCallback((qIdx: number, multiSelect: boolean) => {
    if (!isInteractive) return;
    setSelections(prev => {
      const next = new Map(prev);
      const cur = next.get(qIdx) || [];
      if (multiSelect) {
        if (cur.includes(TYPE_SOMETHING_MARKER)) {
          next.set(qIdx, cur.filter(l => l !== TYPE_SOMETHING_MARKER));
        } else {
          next.set(qIdx, [...cur, TYPE_SOMETHING_MARKER]);
        }
      } else {
        next.set(qIdx, [TYPE_SOMETHING_MARKER]);
      }
      return next;
    });
    setTimeout(() => inputRefs.current.get(qIdx)?.focus(), 100);
  }, [isInteractive]);

  const handleCustomInputChange = useCallback((qIdx: number, value: string) => {
    setCustomInputs(prev => { const n = new Map(prev); n.set(qIdx, value); return n; });
  }, []);

  const canSubmit = useMemo(() => {
    if (!isInteractive || !questions || questions.length === 0) return false;
    for (let i = 0; i < questions.length; i++) {
      const sel = selections.get(i) || [];
      if (sel.length === 0) return false;
      if (sel.includes(TYPE_SOMETHING_MARKER) && sel.length === 1 && !(customInputs.get(i) || '').trim()) {
        return false;
      }
    }
    return true;
  }, [isInteractive, questions, selections, customInputs]);

  const formatResponse = useCallback((): Record<string, unknown> => {
    const formatted = questions.map((_q: any, idx: number) => {
      const sel = selections.get(idx) || [];
      const selectedOptions = sel.filter(s => s !== TYPE_SOMETHING_MARKER);
      const customText = sel.includes(TYPE_SOMETHING_MARKER) ? (customInputs.get(idx) || '').trim() : null;
      return { index: idx, selectedOptions, customInput: customText };
    });
    return { questions: formatted };
  }, [questions, selections, customInputs]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !onSubmit || !matchedPending) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const result = formatResponse();
      const outcome = await onSubmit(matchedPending.toolCallId, result);
      if (outcome && !outcome.success) {
        setSubmitError(outcome.error || t('askUserQuestionTool.submitFailed', 'Submit failed'));
      }
    } catch (error) {
      console.error('[AskUserQuestion] Submit failed:', error);
      setSubmitError(error instanceof Error ? error.message : t('askUserQuestionTool.submitFailed', 'Submit failed'));
    } finally {
      setIsSubmitting(false);
    }
  }, [canSubmit, onSubmit, matchedPending, formatResponse, t]);

  if (!questions) {
    return (
      <BaseToolComponent
        execution={execution}
        hideToolName={false}
        overrideToolName={t('askUserQuestionTool.title')}
      >
        <div className="text-red-600 text-sm">
          {t('askUserQuestionTool.invalidInput', 'Invalid question input')}
        </div>
      </BaseToolComponent>
    );
  }

  const getSubtitle = () => {
    const first = questions[0];
    const title = first.header || (first.question.length > 30 ? first.question.substring(0, 30) + '...' : first.question);
    return questions.length === 1 ? title : `${title} (+${questions.length - 1})`;
  };

  // Determine whether custom input should be shown for a question.
  const shouldShowCustomInput = (question: any): boolean => {
    const ci = question.customInput;
    if (ci === false) return false;
    if (typeof ci === 'object' && ci !== null && ci.enabled === false) return false;
    return true;
  };

  const getCustomInputConfig = (question: any) => {
    const ci = question.customInput;
    if (typeof ci === 'object' && ci !== null) {
      return {
        placeholder: ci.placeholder || t('askUserQuestionTool.typeSomethingPlaceholder'),
        maxLength: ci.maxLength,
        rows: ci.rows,
      };
    }
    return { placeholder: t('askUserQuestionTool.typeSomethingPlaceholder') };
  };

  return (
    <BaseToolComponent
      execution={execution}
      subtitle={getSubtitle()}
      defaultExpanded={true}
      showResult={false}
      hideToolName={false}
      overrideToolName={t('askUserQuestionTool.title')}
      customIcon={<MessageSquare className="w-4 h-4 text-blue-500" />}
    >
      <div className="space-y-4">
        <div className="space-y-4">
          {questions.map((question: any, questionIndex: number) => {
            const liveSelections = selections.get(questionIndex) || [];
            const qResult = parsedResult?.[questionIndex];
            const submittedOptions = qResult?.selectedOptions || [];
            const submittedCustom = qResult?.customInput || null;

            // When completed, show submitted answers; when interactive, show live selections
            const displaySelected = execution.toolResult ? submittedOptions : liveSelections.filter(s => s !== TYPE_SOMETHING_MARKER);
            const showCustom = shouldShowCustomInput(question);
            const customConfig = getCustomInputConfig(question);

            return (
              <div key={questionIndex} className="border border-gray-200 rounded-lg p-3 bg-white">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium text-gray-700">Q{questionIndex + 1}</span>
                    {question.header && (
                      <span className="text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded-full">
                        {question.header}
                      </span>
                    )}
                    {question.multiSelect && (
                      <span className="text-xs px-2 py-1 bg-purple-100 text-purple-800 rounded-full">
                        {t('askUserQuestionTool.multiSelect')}
                      </span>
                    )}
                  </div>
                </div>

                <div className="mb-3">
                  <p className="text-sm text-gray-800 font-medium">{question.question}</p>
                </div>

                <div className="space-y-2">
                  {(question.options || []).map((option: any, optionIndex: number) => {
                    const isSelected = displaySelected.includes(option.label);
                    const isSubmittedOption = execution.toolResult && submittedOptions.includes(option.label);
                    const canClick = isInteractive;
                    return (
                      <div
                        key={optionIndex}
                        onClick={() => handleOptionClick(questionIndex, option.label, question.multiSelect || false)}
                        className={`
                          flex items-start space-x-2 p-2 rounded border transition-all
                          ${canClick ? 'cursor-pointer' : 'cursor-default'}
                          ${isSubmittedOption ? 'border-green-500 bg-green-50 ring-1 ring-green-500' : ''}
                          ${isSelected && !isSubmittedOption ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : ''}
                          ${!isSelected && !isSubmittedOption ? 'border-gray-100 hover:bg-gray-50' : ''}
                          ${!canClick && !isSelected && !isSubmittedOption ? 'opacity-60' : ''}
                        `}
                      >
                        {question.multiSelect ? (
                          <CheckSquare className={`w-4 h-4 mt-0.5 ${isSubmittedOption ? 'text-green-500' : isSelected ? 'text-blue-500' : 'text-gray-400'}`} checked={isSelected || isSubmittedOption} />
                        ) : (
                          (isSelected || isSubmittedOption) ? <CheckCircle className={`w-4 h-4 mt-0.5 ${isSubmittedOption ? 'text-green-500' : 'text-blue-500'}`} /> : <Circle className="w-4 h-4 mt-0.5 text-gray-400" />
                        )}
                        <div className="flex-1">
                          <div className={`text-sm font-medium ${isSubmittedOption ? 'text-green-700' : isSelected ? 'text-blue-700' : 'text-gray-700'}`}>{option.label}</div>
                          {option.description && <div className="text-xs text-gray-500 mt-1">{option.description}</div>}
                        </div>
                      </div>
                    );
                  })}

                  {showCustom && (() => {
                    const isTypeSomethingSelected = liveSelections.includes(TYPE_SOMETHING_MARKER);
                    const customInputValue = customInputs.get(questionIndex) || '';

                    if (execution.toolResult && submittedCustom) {
                      return (
                        <div className="flex items-start space-x-2 p-2 rounded border border-green-500 bg-green-50 ring-1 ring-green-500">
                          <CheckCircle className="w-4 h-4 mt-0.5 text-green-500" />
                          <div className="flex-1 flex items-center space-x-2">
                            <PenLine className="w-4 h-4 text-green-600" />
                            <span className="text-sm font-medium text-green-700">{submittedCustom}</span>
                          </div>
                        </div>
                      );
                    }

                    if (execution.toolResult) return null;

                    return (
                      <div className="space-y-2">
                        <div
                          onClick={() => handleTypeSomethingClick(questionIndex, question.multiSelect || false)}
                          className={`
                            flex items-start space-x-2 p-2 rounded border transition-all
                            ${isInteractive ? 'cursor-pointer' : 'cursor-default'}
                            ${isTypeSomethingSelected ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-gray-100 border-dashed hover:bg-gray-50'}
                            ${!isInteractive && !isTypeSomethingSelected ? 'opacity-60' : ''}
                          `}
                        >
                          {question.multiSelect ? (
                            <CheckSquare className={`w-4 h-4 mt-0.5 ${isTypeSomethingSelected ? 'text-blue-500' : 'text-gray-400'}`} checked={isTypeSomethingSelected} />
                          ) : (
                            isTypeSomethingSelected ? <CheckCircle className="w-4 h-4 mt-0.5 text-blue-500" /> : <Circle className="w-4 h-4 mt-0.5 text-gray-400" />
                          )}
                          <div className="flex-1 flex items-center space-x-2">
                            <PenLine className={`w-4 h-4 ${isTypeSomethingSelected ? 'text-blue-500' : 'text-gray-400'}`} />
                            <div className={`text-sm font-medium ${isTypeSomethingSelected ? 'text-blue-700' : 'text-gray-500'}`}>
                              {t('askUserQuestionTool.typeSomething')}
                            </div>
                          </div>
                        </div>

                        {isTypeSomethingSelected && isInteractive && (
                          <div className="ml-6">
                            <input
                              ref={(el) => { inputRefs.current.set(questionIndex, el); }}
                              type="text"
                              value={customInputValue}
                              onChange={(e) => handleCustomInputChange(questionIndex, e.target.value)}
                              placeholder={customConfig.placeholder}
                              maxLength={customConfig.maxLength}
                              className="w-full px-3 py-2 text-sm border border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && canSubmit) { e.preventDefault(); handleSubmit(); }
                              }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })}
        </div>

        {isInteractive && (
          <div className="flex justify-end pt-2">
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || isSubmitting}
              className={`
                flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
                ${canSubmit && !isSubmitting
                  ? 'bg-blue-500 text-white hover:bg-blue-600 shadow-sm'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'}
              `}
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>{t('askUserQuestionTool.submitting')}</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>{t('askUserQuestionTool.submit')}</span>
                </>
              )}
            </button>
          </div>
        )}

        {execution.toolResult && !execution.isError && (
          <div className="flex items-center space-x-2 text-green-600 py-2">
            <Check className="w-4 h-4" />
            <span className="text-sm font-medium">{t('askUserQuestionTool.completed')}</span>
          </div>
        )}

        {submitError && (
          <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-lg p-2 mt-1">
            <div className="flex items-center space-x-2 text-red-600">
              <MessageSquare className="w-4 h-4" />
              <span className="text-sm">{submitError}</span>
            </div>
            <button
              onClick={() => { setSubmitError(null); }}
              className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-100"
            >
              {t('askUserQuestionTool.dismiss', 'Dismiss')}
            </button>
          </div>
        )}

        {execution.isExecuting && !matchedPending && !submitError && (
          <div className="flex items-center space-x-2 text-blue-600 py-2">
            <MessageSquare className="w-4 h-4 animate-pulse" />
            <span className="text-sm">{t('askUserQuestionTool.waitingForResponse')}</span>
          </div>
        )}

        {execution.isError && (
          <div className="flex items-center space-x-2 text-red-600 py-2">
            <MessageSquare className="w-4 h-4" />
            <span className="text-sm">{t('askUserQuestionTool.error')}</span>
          </div>
        )}
      </div>
    </BaseToolComponent>
  );
};

const CheckSquare = ({ className, checked }: { className?: string; checked?: boolean }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" strokeWidth="2" />
    {checked && <path d="M9 12l2 2 4-4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
  </svg>
);
