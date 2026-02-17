/**
 * A2UI Progress Component
 * Displays a progress bar or circular indicator
 */

import React from 'react';

interface ProgressComponentProps {
  value: number;
  label?: string;
  variant?: 'linear' | 'circular';
  color?: string;
}

export const A2UIProgress: React.FC<ProgressComponentProps> = ({
  value,
  label,
  variant = 'linear',
  color = '#6366f1',
}) => {
  const clampedValue = Math.max(0, Math.min(100, value));

  if (variant === 'circular') {
    const radius = 36;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (clampedValue / 100) * circumference;

    return (
      <div className="a2ui-progress inline-flex flex-col items-center gap-1">
        <div className="relative w-20 h-20">
          <svg className="w-20 h-20 transform -rotate-90" viewBox="0 0 80 80">
            <circle
              cx="40" cy="40" r={radius}
              strokeWidth="6"
              fill="none"
              className="stroke-gray-200 dark:stroke-gray-700"
            />
            <circle
              cx="40" cy="40" r={radius}
              strokeWidth="6"
              fill="none"
              stroke={color}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              style={{ transition: 'stroke-dashoffset 0.6s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              {Math.round(clampedValue)}%
            </span>
          </div>
        </div>
        {label && (
          <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
        )}
      </div>
    );
  }

  // Linear progress bar
  return (
    <div className="a2ui-progress w-full">
      {label && (
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-gray-600 dark:text-gray-400">{label}</span>
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
            {Math.round(clampedValue)}%
          </span>
        </div>
      )}
      <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${clampedValue}%`,
            backgroundColor: color,
          }}
        />
      </div>
    </div>
  );
};
