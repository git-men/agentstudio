/**
 * A2UI Badge Component
 * Inline label/tag with variant colors and optional icon
 */

import React from 'react';

interface BadgeComponentProps {
  text: string;
  variant?: 'success' | 'warning' | 'error' | 'info' | 'neutral';
  color?: string;
  icon?: string;
}

const variantStyles: Record<string, { bg: string; text: string; border: string }> = {
  success: {
    bg: 'bg-green-100 dark:bg-green-900/30',
    text: 'text-green-700 dark:text-green-300',
    border: 'border-green-200 dark:border-green-800',
  },
  warning: {
    bg: 'bg-yellow-100 dark:bg-yellow-900/30',
    text: 'text-yellow-700 dark:text-yellow-300',
    border: 'border-yellow-200 dark:border-yellow-800',
  },
  error: {
    bg: 'bg-red-100 dark:bg-red-900/30',
    text: 'text-red-700 dark:text-red-300',
    border: 'border-red-200 dark:border-red-800',
  },
  info: {
    bg: 'bg-blue-100 dark:bg-blue-900/30',
    text: 'text-blue-700 dark:text-blue-300',
    border: 'border-blue-200 dark:border-blue-800',
  },
  neutral: {
    bg: 'bg-gray-100 dark:bg-gray-800',
    text: 'text-gray-700 dark:text-gray-300',
    border: 'border-gray-200 dark:border-gray-700',
  },
};

export const A2UIBadge: React.FC<BadgeComponentProps> = ({
  text,
  variant = 'neutral',
  color,
  icon,
}) => {
  const styles = variantStyles[variant] || variantStyles.neutral;

  // If custom color is provided, override variant styles
  const customStyle: React.CSSProperties = color
    ? {
        backgroundColor: `${color}20`,
        color: color,
        borderColor: `${color}40`,
      }
    : {};

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
        color ? '' : `${styles.bg} ${styles.text} ${styles.border}`
      }`}
      style={customStyle}
    >
      {icon && <span className="text-[10px]">{icon}</span>}
      {text}
    </span>
  );
};
