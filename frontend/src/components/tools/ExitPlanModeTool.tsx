import React from 'react';
import { BaseToolComponent } from './BaseToolComponent';
import type { BaseToolExecution } from './sdk-types';
import type { ExitPlanModeInput } from '@anthropic-ai/claude-agent-sdk/sdk-tools';
import { useTranslation } from 'react-i18next';

interface ExitPlanModeToolProps {
  execution: BaseToolExecution;
}

export const ExitPlanModeTool: React.FC<ExitPlanModeToolProps> = ({ execution }) => {
  const { t } = useTranslation('components');
  const input = execution.toolInput as unknown as ExitPlanModeInput;
  // SDK 0.2.x 移除了 plan 字段，但运行时仍可能存在，安全地提取
  const plan = (input as Record<string, unknown>).plan as string | undefined;

  return (
    <BaseToolComponent execution={execution} hideToolName={false}>
      <div>
        {plan && (
        <div className="mb-3">
          <p className="text-xs font-medium text-gray-600 mb-2">{t('exitPlanModeTool.implementationPlan')}</p>
          <div className="p-3 rounded-md border bg-emerald-50 border-emerald-200">
            <div className="text-sm text-emerald-800 whitespace-pre-wrap break-words">
              {plan}
            </div>
          </div>
        </div>
        )}

        <div className="text-xs text-emerald-600 bg-emerald-100 p-2 rounded">
          📋 {t('exitPlanModeTool.planModeExited')}
        </div>
      </div>
      
    </BaseToolComponent>
  );
};