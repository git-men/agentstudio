import type { Meta, StoryObj } from '@storybook/react';
import { A2UIMarkdown } from './MarkdownComponent';
import {
  markdownRichContent,
  markdownCodeSnippet,
} from './__mocks__/a2uiMockData';

const meta = {
  title: 'A2UI/Components/Markdown',
  component: A2UIMarkdown,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Markdown Markdown渲染器 — Markdown content renderer supporting headings, bold/italic text, inline code, links, ordered/unordered lists, code blocks, and tables.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof A2UIMarkdown>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Rich content showcasing all supported Markdown syntax elements */
export const RichContent: Story = {
  args: {
    content: markdownRichContent,
  },
};

/** Code-focused content demonstrating syntax-highlighted code blocks */
export const CodeSnippet: Story = {
  args: {
    content: markdownCodeSnippet,
  },
};

/** Minimal content — just a single paragraph */
export const MinimalContent: Story = {
  args: {
    content: 'A simple paragraph with **bold** and *italic* text and a [link](https://example.com).',
  },
};
