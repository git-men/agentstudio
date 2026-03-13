import type { Meta, StoryObj } from '@storybook/react';
import { A2UIJsonViewer } from './JsonViewerComponent';
import {
  jsonViewerNested,
  jsonViewerLongString,
} from './__mocks__/a2uiMockData';

const meta = {
  title: 'A2UI/Components/JsonViewer',
  component: A2UIJsonViewer,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'JsonViewer JSON查看器 — Collapsible tree view for JSON data with type-based syntax colouring (string/number/boolean/null/array/object). Supports configurable default expand depth, long-string truncation, and copy to clipboard.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof A2UIJsonViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Multi-level nested object — default expand depth of 2 */
export const Default: Story = {
  args: {
    data: jsonViewerNested,
    title: 'Service Configuration',
  },
};

/** Verify type-based colouring: string (green), number (blue), boolean (purple), null (gray) */
export const TypeColors: Story = {
  args: {
    data: {
      string: 'hello world',
      number: 42,
      float: 3.14159,
      boolTrue: true,
      boolFalse: false,
      nullValue: null,
      emptyArray: [],
      emptyObject: {},
      nestedArray: [1, 'two', true, null],
    },
    title: 'All JSON Types',
    defaultExpandDepth: 3,
  },
};

/** String exceeding 100 chars is truncated with expand toggle */
export const LongString: Story = {
  args: {
    data: jsonViewerLongString,
    title: 'Long String Truncation',
    defaultExpandDepth: 3,
  },
};

/** All nodes collapsed at root level (defaultExpandDepth=0) */
export const FullyCollapsed: Story = {
  args: {
    data: jsonViewerNested,
    title: 'Collapsed (click to expand)',
    defaultExpandDepth: 0,
  },
};

/** Copy button action — click "Copy" and verify "Copied" feedback */
export const CopyAction: Story = {
  args: {
    data: { message: 'Copy me!', count: 42 },
    title: 'Click Copy Button →',
    defaultExpandDepth: 2,
  },
};
