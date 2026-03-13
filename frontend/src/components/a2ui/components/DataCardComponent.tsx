/**
 * A2UI DataCard Component
 * Displays a metric with optional trend indicator, change label, and sparkline.
 * Combines features from the former StatPanel component.
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
  /** Extra label next to the trend indicator (e.g. "vs last month") */
  changeLabel?: string;
  /** Array of numbers rendered as a mini sparkline SVG */
  sparkline?: number[];
}

// ==================== Helpers ====================

/**
 * Auto-format a numeric value with K / M suffix when appropriate.
 * Strings are returned as-is.
 */
function formatDisplayValue(value: string | number): string {
  if (typeof value === 'number') {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    if (Number.isInteger(value)) return value.toLocaleString();
    return value.toFixed(2);
  }
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return '-';
}

// ==================== MiniSparkline ====================

const MiniSparkline: React.FC<{ data: number[] }> = ({ data }) => {
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const width = 60;
  const height = 20;
  const padding = 2;

  const points = data
    .map((val, i) => {
      const x = padding + (i / (data.length - 1)) * (width - padding * 2);
      const y = height - padding - ((val - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} className="inline-block ml-1">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-blue-400 dark:text-blue-500"
      />
    </svg>
  );
};

// ==================== Component ====================

export const A2UIDataCard: React.FC<DataCardComponentProps> = ({
  title,
  value,
  unit,
  trend,
  trendValue,
  icon,
  changeLabel,
  sparkline,
}) => {
  const trendColor =
    trend === 'up'
      ? 'text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-900/30'
      : trend === 'down'
        ? 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-900/30'
        : 'text-gray-500 bg-gray-50 dark:text-gray-400 dark:bg-gray-800';

  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;

  const displayValue = formatDisplayValue(value);

  return (
    <div className="a2ui-datacard rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 min-w-[160px]">
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          {title}
        </span>
        {icon && <span className="text-lg">{icon}</span>}
      </div>
      <div className="flex items-baseline gap-1 mb-1">
        <span className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
          {displayValue}
        </span>
        {unit && (
          <span className="text-sm text-gray-500 dark:text-gray-400">{unit}</span>
        )}
      </div>
      {(trend || sparkline) && (
        <div className="flex items-center justify-between mt-1">
          {trend && (
            <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${trendColor}`}>
              <TrendIcon className="w-3 h-3" />
              {trendValue && <span>{trendValue}</span>}
              {changeLabel && (
                <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-0.5 font-normal">
                  {changeLabel}
                </span>
              )}
            </div>
          )}
          {sparkline && <MiniSparkline data={sparkline} />}
        </div>
      )}
    </div>
  );
};
