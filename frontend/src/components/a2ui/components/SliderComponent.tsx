/**
 * A2UI Slider Component
 * Numeric range input with min/max bounds and current value display.
 * Supports user drag interaction via onChange callback.
 */

import React, { useState, useCallback, useEffect } from 'react';

interface SliderComponentProps {
  /** Current value of the slider */
  value: number;
  /** Minimum allowed value (default: 0) */
  minValue?: number;
  /** Maximum allowed value (default: 100) */
  maxValue?: number;
  /** Callback fired when user drags the slider */
  onChange?: (newValue: number) => void;
}

export const A2UISlider: React.FC<SliderComponentProps> = ({
  value,
  minValue = 0,
  maxValue = 100,
  onChange,
}) => {
  // Internal state to allow interactive dragging
  const clamp = useCallback(
    (v: number) => Math.max(minValue, Math.min(maxValue, v)),
    [minValue, maxValue],
  );

  const [internalValue, setInternalValue] = useState(() => clamp(value));

  // Sync internal state when external value prop changes
  useEffect(() => {
    setInternalValue(clamp(value));
  }, [value, clamp]);

  const percentage =
    maxValue > minValue
      ? ((internalValue - minValue) / (maxValue - minValue)) * 100
      : 0;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newVal = Number(e.target.value);
      setInternalValue(newVal);
      onChange?.(newVal);
    },
    [onChange],
  );

  return (
    <div className="a2ui-slider w-full">
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-500 dark:text-gray-400 min-w-[2ch] text-right">
          {minValue}
        </span>
        <div className="relative flex-1">
          <input
            type="range"
            min={minValue}
            max={maxValue}
            value={internalValue}
            onChange={handleChange}
            className="w-full h-2 rounded-full appearance-none cursor-pointer
              bg-gray-200 dark:bg-gray-700
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-4
              [&::-webkit-slider-thumb]:h-4
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-indigo-600
              [&::-webkit-slider-thumb]:dark:bg-indigo-400
              [&::-webkit-slider-thumb]:shadow-sm
              [&::-webkit-slider-thumb]:cursor-grab
              [&::-webkit-slider-thumb]:active:cursor-grabbing
              [&::-moz-range-thumb]:w-4
              [&::-moz-range-thumb]:h-4
              [&::-moz-range-thumb]:rounded-full
              [&::-moz-range-thumb]:bg-indigo-600
              [&::-moz-range-thumb]:dark:bg-indigo-400
              [&::-moz-range-thumb]:border-0
              [&::-moz-range-thumb]:shadow-sm
              [&::-moz-range-thumb]:cursor-grab
              [&::-moz-range-thumb]:active:cursor-grabbing"
            style={{
              background: `linear-gradient(to right, #6366f1 0%, #6366f1 ${percentage}%, transparent ${percentage}%, transparent 100%), linear-gradient(to right, #e5e7eb, #e5e7eb)`,
            }}
          />
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-400 min-w-[2ch]">
          {maxValue}
        </span>
      </div>
      <div className="text-center mt-1">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {internalValue}
        </span>
      </div>
    </div>
  );
};
