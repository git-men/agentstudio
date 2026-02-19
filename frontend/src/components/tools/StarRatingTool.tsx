/**
 * StarRatingTool
 *
 * Custom frontend tool UI: renders a star-rating widget in the chat.
 * Used by `useRatingTool` (via `useFrontendTool`) so the AI can ask
 * the user to rate something and receive the numeric score back.
 */

import React, { useState } from 'react';
import { Star } from 'lucide-react';

interface StarRatingToolProps {
  /** The question / prompt from the AI. */
  question: string;
  /** Number of stars (default 5). */
  maxStars?: number;
  /** Labels for each star value (optional). */
  labels?: string[];
  /** Called when the user submits their rating. */
  onSubmit: (result: unknown) => void;
}

export const StarRatingTool: React.FC<StarRatingToolProps> = ({
  question,
  maxStars = 5,
  labels,
  onSubmit,
}) => {
  const [hovered, setHovered] = useState<number>(0);
  const [selected, setSelected] = useState<number>(0);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    if (selected === 0 || submitted) return;
    setSubmitted(true);
    onSubmit({ rating: selected, maxStars, question });
  };

  const stars = Array.from({ length: maxStars }, (_, i) => i + 1);

  return (
    <div className="my-2 rounded-xl border border-yellow-200 bg-yellow-50 p-4 shadow-sm max-w-md">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Star className="w-4 h-4 text-yellow-500 fill-yellow-400" />
        <span className="text-sm font-semibold text-yellow-800">请为以下内容评分</span>
      </div>

      {/* Question */}
      <p className="text-sm text-gray-700 mb-4 leading-relaxed">{question}</p>

      {/* Stars */}
      <div className="flex gap-1 mb-3">
        {stars.map((star) => {
          const active = submitted ? star <= selected : star <= (hovered || selected);
          return (
            <button
              key={star}
              disabled={submitted}
              onMouseEnter={() => !submitted && setHovered(star)}
              onMouseLeave={() => !submitted && setHovered(0)}
              onClick={() => !submitted && setSelected(star)}
              className={`
                transition-transform duration-100 focus:outline-none
                ${submitted ? 'cursor-default' : 'cursor-pointer hover:scale-110'}
              `}
              title={labels ? labels[star - 1] : `${star} 星`}
              aria-label={labels ? labels[star - 1] : `${star} 星`}
            >
              <Star
                className={`w-7 h-7 transition-colors duration-100 ${
                  active
                    ? 'text-yellow-400 fill-yellow-400'
                    : 'text-gray-300 fill-transparent'
                }`}
              />
            </button>
          );
        })}
      </div>

      {/* Label hint */}
      {labels && !submitted && (
        <p className="text-xs text-gray-400 mb-3">
          {hovered > 0 ? labels[hovered - 1] : selected > 0 ? labels[selected - 1] : '悬停或点击星星来评分'}
        </p>
      )}

      {/* Submitted state */}
      {submitted && (
        <p className="text-xs text-yellow-700 mb-3 font-medium">
          ✅ 已提交评分：{selected} / {maxStars} 星
          {labels ? `（${labels[selected - 1]}）` : ''}
        </p>
      )}

      {/* Submit button */}
      {!submitted && (
        <button
          onClick={handleSubmit}
          disabled={selected === 0}
          className={`
            mt-1 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors duration-150
            ${selected === 0
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-yellow-400 text-yellow-900 hover:bg-yellow-500 cursor-pointer'
            }
          `}
        >
          提交评分
        </button>
      )}
    </div>
  );
};
