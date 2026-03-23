import type { Meta, StoryObj } from '@storybook/react';
import { A2UITimeline } from './TimelineComponent';
import {
  timelineDefault,
  timelineMixedStatuses,
  timelineManyNodes,
  timelineSingle,
  timelineError,
} from './__mocks__/a2uiMockData';

const meta = {
  title: 'A2UI/Components/Timeline',
  component: A2UITimeline,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Timeline 时间线 — Displays events in chronological order with vertical or horizontal layout. Supports completed, active, pending, and error statuses. Automatically collapses when items exceed 10.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof A2UITimeline>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Vertical timeline with 5 nodes showing completed / active / pending statuses */
export const Default: Story = {
  args: {
    items: timelineDefault,
    title: 'Project Progress',
    direction: 'vertical',
  },
};

/** Horizontal layout with nodes arranged left-to-right */
export const Horizontal: Story = {
  args: {
    items: timelineDefault,
    title: 'Deployment Pipeline',
    direction: 'horizontal',
  },
};

/** 15 nodes — exceeds the 10-node threshold, triggers collapse / expand toggle */
export const ManyNodes: Story = {
  args: {
    items: timelineManyNodes,
    title: 'CI/CD Pipeline (15 stages)',
    direction: 'vertical',
  },
};

/** Many nodes in horizontal direction to verify horizontal collapse */
export const ManyNodesHorizontal: Story = {
  args: {
    items: timelineManyNodes,
    title: 'CI/CD Pipeline — Horizontal (15 stages)',
    direction: 'horizontal',
  },
};

/** Only a single node — minimal data set rendering */
export const SingleNode: Story = {
  args: {
    items: timelineSingle,
    title: 'Single Event',
    direction: 'vertical',
  },
};

/** Timeline with an error status node showing red icon and styling */
export const ErrorState: Story = {
  args: {
    items: timelineError,
    title: 'Data Processing Pipeline',
    direction: 'vertical',
  },
};

/** Mixed statuses including error — comprehensive status demonstration */
export const MixedStatuses: Story = {
  args: {
    items: timelineMixedStatuses,
    title: 'Deployment Steps (mixed statuses)',
    direction: 'vertical',
  },
};

/** Side-by-side comparison of vertical vs horizontal layout */
export const LayoutComparison: Story = {
  render: () => (
    <div className="space-y-8">
      <div>
        <h3 className="text-sm font-bold text-gray-600 dark:text-gray-300 mb-2 uppercase tracking-wide">
          Vertical Layout
        </h3>
        <A2UITimeline items={timelineDefault} direction="vertical" title="Project Progress" />
      </div>
      <hr className="border-gray-200 dark:border-gray-700" />
      <div>
        <h3 className="text-sm font-bold text-gray-600 dark:text-gray-300 mb-2 uppercase tracking-wide">
          Horizontal Layout
        </h3>
        <A2UITimeline items={timelineDefault} direction="horizontal" title="Project Progress" />
      </div>
    </div>
  ),
};
