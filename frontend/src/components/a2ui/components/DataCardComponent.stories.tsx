import type { Meta, StoryObj } from '@storybook/react';
import { A2UIDataCard } from './DataCardComponent';
import {
  dataCardUp,
  dataCardDown,
  dataCardFlat,
  dataCardWithIcon,
  dataCardDashboard,
} from './__mocks__/a2uiMockData';

const meta = {
  title: 'A2UI/Components/DataCard',
  component: A2UIDataCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'DataCard 数据卡片 — Metric display card with trend indicators (up/down/flat), optional icon, change description label, sparkline mini charts, and auto-formatted large numbers (K/M suffix).',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof A2UIDataCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** All three trend types displayed side by side */
export const AllTrends: Story = {
  args: {
    title: dataCardUp.title,
    value: dataCardUp.value,
  },
  render: () => (
    <div className="flex flex-wrap gap-4">
      <A2UIDataCard {...dataCardUp} />
      <A2UIDataCard {...dataCardDown} />
      <A2UIDataCard {...dataCardFlat} />
    </div>
  ),
};

/** Data card with a custom icon displayed in top-right corner */
export const WithIcon: Story = {
  args: {
    ...dataCardWithIcon,
  },
};

/** Single card with upward trend — green arrow and positive change */
export const TrendUp: Story = {
  args: {
    ...dataCardUp,
  },
};

/** Single card with downward trend — red arrow and negative change */
export const TrendDown: Story = {
  args: {
    ...dataCardDown,
  },
};

/** All four card variants in a dashboard-style grid layout */
export const DashboardGrid: Story = {
  args: {
    title: dataCardUp.title,
    value: dataCardUp.value,
  },
  render: () => (
    <div className="grid grid-cols-2 gap-4 max-w-2xl">
      <A2UIDataCard {...dataCardUp} />
      <A2UIDataCard {...dataCardDown} />
      <A2UIDataCard {...dataCardFlat} />
      <A2UIDataCard {...dataCardWithIcon} />
    </div>
  ),
};

/** Dashboard with change labels and sparkline mini charts (merged from StatPanel) */
export const WithSparklines: Story = {
  args: {
    title: dataCardDashboard[0].title,
    value: dataCardDashboard[0].value,
  },
  render: () => (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">System Dashboard</h4>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {dataCardDashboard.map((card) => (
          <A2UIDataCard key={card.title} {...card} />
        ))}
      </div>
    </div>
  ),
};

/** Large numeric values auto-formatted with K/M suffix */
export const LargeNumbers: Story = {
  args: {
    title: 'API Calls',
    value: 1234567,
    trend: 'up',
    trendValue: '+8.3%',
  },
  render: () => (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <A2UIDataCard title="API Calls" value={1234567} trend="up" trendValue="+8.3%" />
      <A2UIDataCard title="Data Processed" value={9876543} unit="GB" trend="up" trendValue="+15.7%" />
      <A2UIDataCard title="Cache Hits" value={45678901} trend="up" trendValue="+2.1%" />
      <A2UIDataCard title="Requests/sec" value={12345} trend="down" trendValue="-1.8%" />
    </div>
  ),
};
