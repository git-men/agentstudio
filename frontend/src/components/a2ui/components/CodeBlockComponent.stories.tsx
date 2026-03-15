import type { Meta, StoryObj } from '@storybook/react';
import { A2UICodeBlock } from './CodeBlockComponent';
import {
  codeBlockSql,
  codeBlockJavaScript,
  codeBlockPython,
  codeBlockGo,
  codeBlockJava,
  codeBlockLong,
} from './__mocks__/a2uiMockData';

const meta = {
  title: 'A2UI/Components/CodeBlock',
  component: A2UICodeBlock,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: 'CodeBlock 代码块 — Code block with syntax highlighting for SQL, JavaScript, Python, Go, and Java. Supports line numbers, line highlighting, and dark mode.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof A2UICodeBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

/** All five supported languages displayed together */
export const AllLanguages: Story = {
  args: {
    code: codeBlockSql,
    language: 'sql',
  },
  render: () => (
    <div className="space-y-6">
      <A2UICodeBlock code={codeBlockSql} language="sql" title="SQL Query" />
      <A2UICodeBlock code={codeBlockJavaScript} language="javascript" title="JavaScript" />
      <A2UICodeBlock code={codeBlockPython} language="python" title="Python" />
      <A2UICodeBlock code={codeBlockGo} language="go" title="Go" />
      <A2UICodeBlock code={codeBlockJava} language="java" title="Java" />
    </div>
  ),
};

/** Line numbers displayed on the left side */
export const WithLineNumbers: Story = {
  args: {
    code: codeBlockPython,
    language: 'python',
    title: 'Python with Line Numbers',
    showLineNumbers: true,
  },
};

/** Specific lines highlighted with yellow background */
export const HighlightLines: Story = {
  args: {
    code: codeBlockJavaScript,
    language: 'javascript',
    title: 'Highlighted Lines (5, 6, 7)',
    showLineNumbers: true,
    highlightLines: [5, 6, 7],
  },
};

/** Code exceeding maxHeight triggers vertical scrollbar */
export const LongCode: Story = {
  args: {
    code: codeBlockLong,
    language: 'javascript',
    title: 'Long Code (scroll to see more)',
    showLineNumbers: true,
    maxHeight: '300px',
  },
};

/** Invalid language falls back to plain text without errors */
export const FallbackPlainText: Story = {
  args: {
    code: 'This is plain text content with no syntax highlighting.\nIt should render without any errors even with an invalid language.',
    language: 'nonexistent-language',
    title: 'Fallback: Invalid Language',
  },
};

/** Dark mode variant - toggle Storybook background to dark */
export const DarkModePreview: Story = {
  args: {
    code: codeBlockGo,
    language: 'go',
    title: 'Go (Dark Mode)',
    showLineNumbers: true,
  },
  parameters: {
    backgrounds: { default: 'dark' },
  },
  decorators: [
    (Story) => {
      document.documentElement.classList.add('dark');
      return (
        <div className="dark bg-gray-900 p-4 rounded-lg">
          <Story />
        </div>
      );
    },
  ],
};
