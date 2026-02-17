/**
 * A2UI DataCard Component
 * Displays a metric with optional trend indicator
 */

import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface DataCardComponentProps {
  title: string;
  value: string | number;
  unit?: string;
  trend?: 'up' | 'down' | 'flat';
  trendValue?: string;
  icon?: string;
}

export const A2UIDataCard: React.FC<DataCardComponentProps> = ({
  title,
  value,
  unit,
  trend,
  trendValue,
  icon,
}) => {
  const trendColor = trend === 'up'
    ? 'text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-900/30'
    : trend === 'down'
      ? 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-900/30'
      : 'text-gray-500 bg-gray-50 dark:text-gray-400 dark:bg-gray-800';

  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;

  return (
    <div className="a2ui-datacard rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 min-w-[160px]">
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          {title}
        </span>
        {icon && (
          <span className="text-lg">{icon}</span>
        )}
      </div>
      <div className="flex items-baseline gap-1 mb-1">
        <span className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </span>
        {unit && (
          <span className="text-sm text-gray-500 dark:text-gray-400">{unit}</span>
        )}
      </div>
      {trend && (
        <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${trendColor}`}>
          <TrendIcon className="w-3 h-3" />
          {trendValue && <span>{trendValue}</span>}
        </div>
      )}
    </div>
  );
};
