/**
 * A2UI Timeline Component
 * Displays events in chronological order with vertical/horizontal layout
 */

import React, { useState } from 'react';
import { CheckCircle, Circle, Clock, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';

interface TimelineItem {
  title: string;
  description?: string;
  time?: string;
  status?: 'completed' | 'active' | 'pending' | 'error';
  icon?: string;
}

interface TimelineComponentProps {
  items: TimelineItem[];
  title?: string;
  direction?: 'vertical' | 'horizontal';
}

const COLLAPSE_THRESHOLD = 10;

const statusConfig: Record<string, { color: string; bgColor: string; icon: React.ReactNode }> = {
  completed: {
    color: 'text-green-500',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    icon: <CheckCircle className="w-4 h-4" />,
  },
  active: {
    color: 'text-blue-500',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
    icon: <Clock className="w-4 h-4 animate-pulse" />,
  },
  pending: {
    color: 'text-gray-400 dark:text-gray-500',
    bgColor: 'bg-gray-100 dark:bg-gray-800',
    icon: <Circle className="w-4 h-4" />,
  },
  error: {
    color: 'text-red-500',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    icon: <AlertCircle className="w-4 h-4" />,
  },
};

export const A2UITimeline: React.FC<TimelineComponentProps> = ({
  items,
  title,
  direction = 'vertical',
}) => {
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse = items.length > COLLAPSE_THRESHOLD && !expanded;

  const displayItems = shouldCollapse
    ? [...items.slice(0, 3), ...items.slice(-2)]
    : items;
  const hiddenCount = items.length - 5;

  if (direction === 'horizontal') {
    return (
      <div className="a2ui-timeline">
        {title && (
          <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">{title}</h4>
        )}
        <div className="flex items-start overflow-x-auto pb-2 gap-1">
          {displayItems.map((item, index) => {
            const status = item.status || 'pending';
            const config = statusConfig[status] || statusConfig.pending;
            const isCollapsePlaceholder = shouldCollapse && index === 3;

            if (isCollapsePlaceholder) {
              return (
                <React.Fragment key="collapse">
                  <div className="flex flex-col items-center min-w-[100px]">
                    <button
                      onClick={() => setExpanded(true)}
                      className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                    >
                      <ChevronDown className="w-3 h-3" />
                      {hiddenCount} more
                    </button>
                  </div>
                  <HorizontalNode item={displayItems[index]} config={statusConfig[(displayItems[index]?.status || 'pending')]} isLast={index === displayItems.length - 1} />
                </React.Fragment>
              );
            }

            return (
              <HorizontalNode key={index} item={item} config={config} isLast={index === displayItems.length - 1} />
            );
          })}
        </div>
        {expanded && items.length > COLLAPSE_THRESHOLD && (
          <button
            onClick={() => setExpanded(false)}
            className="mt-2 flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
          >
            <ChevronUp className="w-3 h-3" />
            Collapse
          </button>
        )}
      </div>
    );
  }

  // Vertical layout (default)
  return (
    <div className="a2ui-timeline">
      {title && (
        <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">{title}</h4>
      )}
      <div className="relative">
        {displayItems.map((item, index) => {
          const status = item.status || 'pending';
          const config = statusConfig[status] || statusConfig.pending;
          const isLast = index === displayItems.length - 1;
          const isCollapsePlaceholder = shouldCollapse && index === 3;

          if (isCollapsePlaceholder) {
            return (
              <React.Fragment key="collapse">
                <div className="flex items-center gap-3 py-2 pl-1">
                  <div className="w-6 flex justify-center">
                    <div className="w-0.5 h-4 bg-gray-200 dark:bg-gray-700" />
                  </div>
                  <button
                    onClick={() => setExpanded(true)}
                    className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                  >
                    <ChevronDown className="w-3 h-3" />
                    Show {hiddenCount} more items
                  </button>
                </div>
                <VerticalNode item={displayItems[index]} config={statusConfig[(displayItems[index]?.status || 'pending')]} isLast={isLast} />
              </React.Fragment>
            );
          }

          return (
            <VerticalNode key={index} item={item} config={config} isLast={isLast} />
          );
        })}
      </div>
      {expanded && items.length > COLLAPSE_THRESHOLD && (
        <button
          onClick={() => setExpanded(false)}
          className="mt-2 flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 transition-colors ml-9"
        >
          <ChevronUp className="w-3 h-3" />
          Collapse
        </button>
      )}
    </div>
  );
};

const VerticalNode: React.FC<{
  item: TimelineItem;
  config: { color: string; bgColor: string; icon: React.ReactNode };
  isLast: boolean;
}> = ({ item, config, isLast }) => (
  <div className="flex gap-3">
    {/* Left: icon + line */}
    <div className="flex flex-col items-center">
      <div className={`w-6 h-6 rounded-full flex items-center justify-center ${config.bgColor} ${config.color}`}>
        {config.icon}
      </div>
      {!isLast && <div className="w-0.5 flex-1 bg-gray-200 dark:bg-gray-700 min-h-[20px]" />}
    </div>
    {/* Right: content */}
    <div className={`pb-4 ${isLast ? '' : ''}`}>
      <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{item.title}</p>
      {item.description && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{item.description}</p>
      )}
      {item.time && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{item.time}</p>
      )}
    </div>
  </div>
);

const HorizontalNode: React.FC<{
  item: TimelineItem;
  config: { color: string; bgColor: string; icon: React.ReactNode };
  isLast: boolean;
}> = ({ item, config, isLast }) => (
  <div className="flex items-start min-w-[120px]">
    <div className="flex flex-col items-center">
      <div className={`w-6 h-6 rounded-full flex items-center justify-center ${config.bgColor} ${config.color}`}>
        {config.icon}
      </div>
      <div className="mt-1 text-center">
        <p className="text-xs font-medium text-gray-800 dark:text-gray-200 max-w-[100px]">{item.title}</p>
        {item.time && (
          <p className="text-[10px] text-gray-400 dark:text-gray-500">{item.time}</p>
        )}
      </div>
    </div>
    {!isLast && (
      <div className="h-0.5 w-8 bg-gray-200 dark:bg-gray-700 mt-3 flex-shrink-0" />
    )}
  </div>
);
