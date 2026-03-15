/**
 * A2UI CodeBlock Component
 * Renders code with syntax highlighting using react-syntax-highlighter (Prism)
 */

import React, { useState, useEffect } from 'react';
import { Copy, Check } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { tomorrow, vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface CodeBlockComponentProps {
  code: string;
  language?: string;
  title?: string;
  showLineNumbers?: boolean;
  maxHeight?: string;
  highlightLines?: number[];
}

export const A2UICodeBlock: React.FC<CodeBlockComponentProps> = ({
  code,
  language = 'text',
  title,
  showLineNumbers = false,
  maxHeight = '400px',
  highlightLines = [],
}) => {
  const [copied, setCopied] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    const checkDarkMode = () => {
      setIsDarkMode(document.documentElement.classList.contains('dark'));
    };
    checkDarkMode();

    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback copy
    }
  };

  const highlightSet = new Set(highlightLines);

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
      <div
        className="overflow-auto"
        style={{ maxHeight }}
      >
        <SyntaxHighlighter
          language={language === 'text' ? undefined : language}
          style={isDarkMode ? vscDarkPlus : tomorrow}
          customStyle={{
            margin: 0,
            background: 'transparent',
            fontSize: '12px',
            lineHeight: '1.6',
          }}
          className="!bg-gray-50 dark:!bg-gray-900"
          showLineNumbers={showLineNumbers}
          lineNumberStyle={{
            minWidth: '3em',
            paddingRight: '1em',
            color: isDarkMode ? '#6b7280' : '#9ca3af',
            borderRight: isDarkMode ? '1px solid #374151' : '1px solid #e5e7eb',
            marginRight: '1em',
          }}
          wrapLines={true}
          wrapLongLines={true}
          lineProps={(lineNumber: number) => {
            const style: React.CSSProperties = {};
            if (highlightSet.has(lineNumber)) {
              style.backgroundColor = isDarkMode
                ? 'rgba(251, 191, 36, 0.1)'
                : 'rgba(251, 191, 36, 0.15)';
              style.borderLeft = '3px solid #f59e0b';
              style.paddingLeft = '8px';
              style.marginLeft = '-3px';
            }
            return { style };
          }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
};
