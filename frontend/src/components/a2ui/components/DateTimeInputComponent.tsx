/**
 * A2UI DateTimeInput Component
 * Date and/or time picker with configurable mode.
 * Supports user interaction via onChange callback.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';

interface DateTimeInputComponentProps {
  /** Current date/time value (ISO format string) */
  value: string;
  /** Enable date selection (default: true) */
  enableDate?: boolean;
  /** Enable time selection (default: false) */
  enableTime?: boolean;
  /** Callback fired when user selects a new date/time */
  onChange?: (newValue: string) => void;
}

/**
 * Determines the HTML input type based on enableDate/enableTime flags.
 * - date only  → "date"
 * - time only  → "time"
 * - both       → "datetime-local"
 * - neither/undefined → "date" (default)
 */
function resolveInputType(enableDate?: boolean, enableTime?: boolean): string {
  if (enableDate && enableTime) return 'datetime-local';
  if (!enableDate && enableTime) return 'time';
  // enableDate only, or both undefined/false → default to date
  return 'date';
}

export const A2UIDateTimeInput: React.FC<DateTimeInputComponentProps> = ({
  value,
  enableDate,
  enableTime,
  onChange,
}) => {
  const inputType = resolveInputType(enableDate, enableTime);
  const inputRef = useRef<HTMLInputElement>(null);

  // Internal state to allow interactive selection
  const [internalValue, setInternalValue] = useState(value || '');

  // Sync internal state when external value prop changes
  useEffect(() => {
    setInternalValue(value || '');
  }, [value]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newVal = e.target.value;
      setInternalValue(newVal);
      onChange?.(newVal);
    },
    [onChange],
  );

  // Click anywhere on the input to open the native picker
  const handleClick = useCallback(() => {
    try {
      inputRef.current?.showPicker();
    } catch {
      // showPicker() may not be supported in all browsers; fall back silently
    }
  }, []);

  const label =
    inputType === 'datetime-local'
      ? 'Date & Time'
      : inputType === 'time'
        ? 'Time'
        : 'Date';

  return (
    <div className="a2ui-datetime-input w-full">
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
        {label}
      </label>
      <input
        ref={inputRef}
        type={inputType}
        value={internalValue}
        onChange={handleChange}
        onClick={handleClick}
        className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600
          bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300
          cursor-pointer hover:border-indigo-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500
          focus:outline-none transition-colors
          [&::-webkit-calendar-picker-indicator]:absolute
          [&::-webkit-calendar-picker-indicator]:inset-0
          [&::-webkit-calendar-picker-indicator]:w-full
          [&::-webkit-calendar-picker-indicator]:h-full
          [&::-webkit-calendar-picker-indicator]:opacity-0
          [&::-webkit-calendar-picker-indicator]:cursor-pointer
          relative"
      />
    </div>
  );
};
