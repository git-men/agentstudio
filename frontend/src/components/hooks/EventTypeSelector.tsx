import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { useEventTypes } from '@/hooks/usePlatformHooks';
import type { EventTypeInfo } from '@/lib/platformHooksApi';

interface EventTypeSelectorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export const EventTypeSelector: React.FC<EventTypeSelectorProps> = ({ value, onChange, disabled }) => {
  const { t } = useTranslation('hooks');
  const { data: eventTypes = [] } = useEventTypes();

  const grouped = useMemo(() => {
    const groups: Record<string, EventTypeInfo[]> = {};
    for (const et of eventTypes) {
      if (!groups[et.category]) groups[et.category] = [];
      groups[et.category].push(et);
    }
    return groups;
  }, [eventTypes]);

  const selectedLabel = useMemo(() => {
    const found = eventTypes.find(et => et.type === value);
    return found ? found.type : undefined;
  }, [eventTypes, value]);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        className={disabled ? 'opacity-50 pointer-events-none' : ''}
        aria-label={t('form.eventType')}
      >
        <SelectValue placeholder={t('form.eventTypePlaceholder')}>
          {selectedLabel}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {Object.entries(grouped).map(([category, items]) => (
          <div key={category}>
            <div className="px-2 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              {t(`events.categories.${category}`, category)}
            </div>
            {items.map(et => (
              <SelectItem key={et.type} value={et.type}>
                <div className="flex items-center gap-2">
                  <span>{et.type}</span>
                  {et.phase > 1 && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                      {t('events.comingSoon')}
                    </span>
                  )}
                </div>
              </SelectItem>
            ))}
          </div>
        ))}
      </SelectContent>
    </Select>
  );
};
