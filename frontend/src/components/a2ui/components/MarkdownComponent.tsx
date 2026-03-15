/**
 * A2UI Markdown Component
 * Renders markdown content
 */

import React from 'react';

interface MarkdownComponentProps {
  content: string;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Apply inline markdown formatting (bold, italic, inline code, links)
 */
function renderInline(text: string): string {
  return text
    .replace(/`(.+?)`/g, '<code class="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-xs font-mono">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" class="text-indigo-600 dark:text-indigo-400 underline" target="_blank" rel="noopener">$1</a>');
}

/**
 * Render a markdown table block (header + separator + body rows) into HTML
 */
function renderTable(lines: string[]): string {
  const parseRow = (line: string): string[] =>
    line.split('|').map(cell => cell.trim()).filter((_, i, arr) => i > 0 && i < arr.length);

  const headerCells = parseRow(lines[0]);
  const bodyLines = lines.slice(2); // skip separator row

  let html = '<div class="overflow-x-auto my-2"><table class="min-w-full text-sm border border-gray-200 dark:border-gray-700 rounded">';
  html += '<thead class="bg-gray-50 dark:bg-gray-800"><tr>';
  for (const cell of headerCells) {
    html += `<th class="px-3 py-1.5 text-left font-semibold border-b border-gray-200 dark:border-gray-700">${renderInline(escapeHtml(cell))}</th>`;
  }
  html += '</tr></thead><tbody>';
  for (const row of bodyLines) {
    if (!row.trim()) continue;
    const cells = parseRow(row);
    html += '<tr class="border-b border-gray-100 dark:border-gray-700/50">';
    for (const cell of cells) {
      html += `<td class="px-3 py-1.5">${renderInline(escapeHtml(cell))}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  return html;
}

/**
 * Full markdown-to-HTML renderer for A2UI
 * Handles: headers, bold, italic, inline code, fenced code blocks, links,
 * ordered/unordered lists, tables, and paragraphs.
 */
function renderMarkdown(md: string): string {
  const lines = md.split('\n');
  const output: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // --- Fenced code block ---
    if (line.trimStart().startsWith('```')) {
      const lang = line.trimStart().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      const code = escapeHtml(codeLines.join('\n'));
      output.push(
        `<pre class="my-2 p-3 bg-gray-900 dark:bg-gray-950 text-gray-100 rounded-lg overflow-x-auto text-xs font-mono leading-relaxed">`
        + `<code${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}>${code}</code></pre>`
      );
      continue;
    }

    // --- Table block (header | separator | rows) ---
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      /^\s*\|?[\s-]+(\|[\s-]+)+\|?\s*$/.test(lines[i + 1])
    ) {
      const tableLines: string[] = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].includes('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      output.push(renderTable(tableLines));
      continue;
    }

    // --- Headers ---
    if (line.startsWith('### ')) {
      output.push(`<h3 class="text-base font-semibold mt-3 mb-1">${renderInline(escapeHtml(line.slice(4)))}</h3>`);
      i++; continue;
    }
    if (line.startsWith('## ')) {
      output.push(`<h2 class="text-lg font-semibold mt-3 mb-1">${renderInline(escapeHtml(line.slice(3)))}</h2>`);
      i++; continue;
    }
    if (line.startsWith('# ')) {
      output.push(`<h1 class="text-xl font-bold mt-3 mb-1">${renderInline(escapeHtml(line.slice(2)))}</h1>`);
      i++; continue;
    }

    // --- Unordered list ---
    if (/^- (.+)$/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^- (.+)$/.test(lines[i])) {
        items.push(renderInline(escapeHtml(lines[i].slice(2))));
        i++;
      }
      output.push('<ul class="my-1">' + items.map(item => `<li class="ml-4 list-disc">${item}</li>`).join('') + '</ul>');
      continue;
    }

    // --- Ordered list ---
    if (/^\d+\. (.+)$/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. (.+)$/.test(lines[i])) {
        const match = lines[i].match(/^\d+\. (.+)$/);
        items.push(renderInline(escapeHtml(match![1])));
        i++;
      }
      output.push('<ol class="my-1">' + items.map(item => `<li class="ml-4 list-decimal">${item}</li>`).join('') + '</ol>');
      continue;
    }

    // --- Blank line ---
    if (line.trim() === '') {
      i++; continue;
    }

    // --- Paragraph (default) ---
    output.push(`<p class="mb-2">${renderInline(escapeHtml(line))}</p>`);
    i++;
  }

  return output.join('');
}

export const A2UIMarkdown: React.FC<MarkdownComponentProps> = ({ content }) => {
  return (
    <div
      className="a2ui-markdown text-sm text-gray-700 dark:text-gray-300 leading-relaxed"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
    />
  );
};
