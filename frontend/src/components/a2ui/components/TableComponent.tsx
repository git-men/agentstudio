/**
 * A2UI Table Component
 * Renders data tables with sorting and pagination
 */

import React, { useMemo, useState } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

interface ColumnDef {
  key: string;
  label: string;
  align?: 'left' | 'center' | 'right';
  width?: string;
}

interface TableComponentProps {
  columns: ColumnDef[] | string;
  data: any[] | string;
  title?: string;
  sortable?: boolean;
  pageSize?: number;
}

export const A2UITable: React.FC<TableComponentProps> = (props) => {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);

  const columns: ColumnDef[] = useMemo(() => {
    if (typeof props.columns === 'string') {
      try { return JSON.parse(props.columns); } catch { return []; }
    }
    return props.columns || [];
  }, [props.columns]);

  const rawData: any[] = useMemo(() => {
    if (typeof props.data === 'string') {
      try { return JSON.parse(props.data); } catch { return []; }
    }
    return Array.isArray(props.data) ? props.data : [];
  }, [props.data]);

  const sortable = props.sortable !== false;
  const pageSize = props.pageSize || 10;

  const sortedData = useMemo(() => {
    if (!sortKey || !sortable) return rawData;
    return [...rawData].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (va === vb) return 0;
      const cmp = va < vb ? -1 : 1;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rawData, sortKey, sortDir, sortable]);

  const totalPages = Math.ceil(sortedData.length / pageSize);
  const pagedData = sortedData.slice(page * pageSize, (page + 1) * pageSize);

  const handleSort = (key: string) => {
    if (!sortable) return;
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ colKey }: { colKey: string }) => {
    if (sortKey !== colKey) return <ChevronsUpDown className="w-3 h-3 text-gray-400" />;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-indigo-500" />
      : <ChevronDown className="w-3 h-3 text-indigo-500" />;
  };

  return (
    <div className="a2ui-table rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      {props.title && (
        <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">{props.title}</h4>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800">
              {columns.map(col => (
                <th
                  key={col.key}
                  className={`px-4 py-2.5 font-medium text-gray-600 dark:text-gray-400 whitespace-nowrap
                    ${sortable ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-750 select-none' : ''}
                    text-${col.align || 'left'}`}
                  style={col.width ? { width: col.width } : undefined}
                  onClick={() => handleSort(col.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {sortable && <SortIcon colKey={col.key} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {pagedData.map((row, idx) => (
              <tr
                key={idx}
                className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
              >
                {columns.map(col => (
                  <td
                    key={col.key}
                    className={`px-4 py-2 text-gray-700 dark:text-gray-300 text-${col.align || 'left'}`}
                  >
                    {formatCellValue(row[col.key])}
                  </td>
                ))}
              </tr>
            ))}
            {pagedData.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-gray-400">
                  No data
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="px-4 py-2 flex items-center justify-between border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          <span className="text-xs text-gray-500">
            {sortedData.length} rows · Page {page + 1} of {totalPages}
          </span>
          <div className="flex gap-1">
            <button
              className="px-2 py-1 text-xs rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40"
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              Prev
            </button>
            <button
              className="px-2 py-1 text-xs rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40"
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

function formatCellValue(value: any): React.ReactNode {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
