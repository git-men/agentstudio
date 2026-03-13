/**
 * A2UI JsonViewer Component
 * Collapsible tree view for JSON data with syntax highlighting
 */

import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Copy, Check } from 'lucide-react';

interface JsonViewerComponentProps {
  data: any;
  title?: string;
  defaultExpandDepth?: number;
  theme?: 'light' | 'dark';
}

const STRING_TRUNCATE_LENGTH = 100;

const JsonValue: React.FC<{
  value: any;
  depth: number;
  defaultExpandDepth: number;
  keyName?: string;
  isLast?: boolean;
}> = ({ value, depth, defaultExpandDepth, keyName, isLast = true }) => {
  const [expanded, setExpanded] = useState(depth < defaultExpandDepth);
  const [showFull, setShowFull] = useState(false);

  const renderValue = () => {
    if (value === null) {
      return <span className="text-gray-400 dark:text-gray-500 italic">null</span>;
    }
    if (value === undefined) {
      return <span className="text-gray-400 dark:text-gray-500 italic">undefined</span>;
    }
    if (typeof value === 'boolean') {
      return (
        <span className="text-purple-600 dark:text-purple-400">{value.toString()}</span>
      );
    }
    if (typeof value === 'number') {
      return <span className="text-blue-600 dark:text-blue-400">{value}</span>;
    }
    if (typeof value === 'string') {
      const isLong = value.length > STRING_TRUNCATE_LENGTH;
      const displayValue = isLong && !showFull
        ? value.slice(0, STRING_TRUNCATE_LENGTH) + '...'
        : value;
      return (
        <span>
          <span className="text-green-600 dark:text-green-400">
            &quot;{displayValue}&quot;
          </span>
          {isLong && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowFull(!showFull); }}
              className="ml-1 text-[10px] text-blue-500 hover:text-blue-700 dark:hover:text-blue-300"
            >
              {showFull ? 'collapse' : `${value.length} chars`}
            </button>
          )}
        </span>
      );
    }
    return <span className="text-gray-600 dark:text-gray-400">{String(value)}</span>;
  };

  // Primitive value
  if (typeof value !== 'object' || value === null) {
    return (
      <div className="flex items-start" style={{ paddingLeft: depth * 16 }}>
        {keyName !== undefined && (
          <>
            <span className="text-red-600 dark:text-red-400">&quot;{keyName}&quot;</span>
            <span className="text-gray-500 dark:text-gray-400 mx-1">:</span>
          </>
        )}
        {renderValue()}
        {!isLast && <span className="text-gray-500 dark:text-gray-400">,</span>}
      </div>
    );
  }

  // Array or Object
  const isArray = Array.isArray(value);
  const entries = isArray ? value : Object.entries(value);
  const isEmpty = entries.length === 0;
  const openBracket = isArray ? '[' : '{';
  const closeBracket = isArray ? ']' : '}';

  if (isEmpty) {
    return (
      <div className="flex items-start" style={{ paddingLeft: depth * 16 }}>
        {keyName !== undefined && (
          <>
            <span className="text-red-600 dark:text-red-400">&quot;{keyName}&quot;</span>
            <span className="text-gray-500 dark:text-gray-400 mx-1">:</span>
          </>
        )}
        <span className="text-gray-500 dark:text-gray-400">
          {openBracket}{closeBracket}
        </span>
        {!isLast && <span className="text-gray-500 dark:text-gray-400">,</span>}
      </div>
    );
  }

  return (
    <div>
      <div
        className="flex items-start cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 -mx-1 px-1 rounded"
        style={{ paddingLeft: depth * 16 }}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-gray-400 mr-0.5">
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
        {keyName !== undefined && (
          <>
            <span className="text-red-600 dark:text-red-400">&quot;{keyName}&quot;</span>
            <span className="text-gray-500 dark:text-gray-400 mx-1">:</span>
          </>
        )}
        <span className="text-gray-500 dark:text-gray-400">{openBracket}</span>
        {!expanded && (
          <>
            <span className="text-gray-400 dark:text-gray-500 mx-1 text-xs">
              {isArray ? `${entries.length} items` : `${entries.length} keys`}
            </span>
            <span className="text-gray-500 dark:text-gray-400">{closeBracket}</span>
            {!isLast && <span className="text-gray-500 dark:text-gray-400">,</span>}
          </>
        )}
      </div>
      {expanded && (
        <>
          {isArray
            ? value.map((item: any, i: number) => (
                <JsonValue
                  key={i}
                  value={item}
                  depth={depth + 1}
                  defaultExpandDepth={defaultExpandDepth}
                  isLast={i === value.length - 1}
                />
              ))
            : Object.entries(value).map(([k, v], i, arr) => (
                <JsonValue
                  key={k}
                  keyName={k}
                  value={v}
                  depth={depth + 1}
                  defaultExpandDepth={defaultExpandDepth}
                  isLast={i === arr.length - 1}
                />
              ))}
          <div style={{ paddingLeft: depth * 16 }}>
            <span className="text-gray-500 dark:text-gray-400 ml-[18px]">{closeBracket}</span>
            {!isLast && <span className="text-gray-500 dark:text-gray-400">,</span>}
          </div>
        </>
      )}
    </div>
  );
};

export const A2UIJsonViewer: React.FC<JsonViewerComponentProps> = ({
  data,
  title,
  defaultExpandDepth = 2,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <div className="a2ui-jsonviewer rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
          {title || 'JSON'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="p-3 overflow-auto max-h-[500px] bg-gray-50 dark:bg-gray-900 font-mono text-xs leading-relaxed">
        <JsonValue
          value={data}
          depth={0}
          defaultExpandDepth={defaultExpandDepth}
        />
      </div>
    </div>
  );
};
