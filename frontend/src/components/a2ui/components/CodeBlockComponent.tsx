/**
 * A2UI CodeBlock Component
 * Renders code with syntax highlighting
 */

import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface CodeBlockComponentProps {
  code: string;
  language?: string;
  title?: string;
}

export const A2UICodeBlock: React.FC<CodeBlockComponentProps> = ({
  code,
  language = 'text',
  title,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback copy
    }
  };

  return (
    <div className="a2ui-codeblock rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
          {title || language}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto bg-gray-50 dark:bg-gray-900">
        <code className="text-xs font-mono text-gray-800 dark:text-gray-200 leading-relaxed">
          {code}
        </code>
      </pre>
    </div>
  );
};
