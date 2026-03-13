import type { Meta, StoryObj } from '@storybook/react';
import { A2UIChart } from './ChartComponent';
import {
  chartBarData,
  chartLineData,
  chartPieData,
} from './__mocks__/a2uiMockData';

const meta = {
  title: 'A2UI/Components/Chart',
  component: A2UIChart,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Chart 图表 — ECharts-based chart component supporting bar, line, and pie chart types with customizable data and options.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof A2UIChart>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Bar chart showing monthly sales revenue with two series */
export const BarChart: Story = {
  args: {
    chartType: chartBarData.chartType,
    title: chartBarData.title,
    data: chartBarData.data,
  },
};

/** Line chart showing daily active users trend comparison */
export const LineChart: Story = {
  args: {
    chartType: chartLineData.chartType,
    title: chartLineData.title,
    data: chartLineData.data,
  },
};

/** Pie chart showing traffic source distribution */
export const PieChart: Story = {
  args: {
    chartType: chartPieData.chartType,
    title: chartPieData.title,
    data: chartPieData.data,
  },
};

/** All three chart types displayed together */
export const AllChartTypes: Story = {
  args: {
    chartType: 'bar',
    data: chartBarData.data,
  },
  render: () => (
    <div className="space-y-6">
      <A2UIChart
        chartType={chartBarData.chartType}
        title={chartBarData.title}
        data={chartBarData.data}
      />
      <A2UIChart
        chartType={chartLineData.chartType}
        title={chartLineData.title}
        data={chartLineData.data}
      />
      <A2UIChart
        chartType={chartPieData.chartType}
        title={chartPieData.title}
        data={chartPieData.data}
      />
    </div>
  ),
};
