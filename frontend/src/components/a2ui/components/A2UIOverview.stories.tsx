/**
 * A2UI Component Overview Story
 * Renders all 11 custom components in three categories:
 *   - Basic Visualization (7 components)
 *   - Data Display (3 components)
 *   - Interactive Input (2 components)
 */

import React, { Component } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { action } from 'storybook/actions';

// Basic Visualization components
import { A2UIChart } from './ChartComponent';
import { A2UITable } from './TableComponent';
import { A2UIDataCard } from './DataCardComponent';
import { A2UIProgress } from './ProgressComponent';
import { A2UICodeBlock } from './CodeBlockComponent';
import { A2UIMarkdown } from './MarkdownComponent';

// Data Display components
import { A2UITimeline } from './TimelineComponent';
import { A2UIBadge } from './BadgeComponent';
import { A2UIJsonViewer } from './JsonViewerComponent';

// Interactive Input components
import { A2UISlider } from './SliderComponent';
import { A2UIDateTimeInput } from './DateTimeInputComponent';

// Mock data
import {
  // Basic Visualization
  chartBarData,
  chartLineData,
  chartPieData,
  tableColumns,
  tableData,
  dataCardUp,
  dataCardDown,
  dataCardFlat,
  dataCardWithIcon,
  progressLinearSteps,
  progressCircularSteps,
  codeBlockPython,
  markdownRichContent,
  // Data Display
  timelineDefault,
  badgeVariants,
  jsonViewerNested,
  // Interactive Input
  sliderDefault,
  dateTimeInputDateOnly,
  dateTimeInputTimeOnly,
  dateTimeInputBoth,
} from './__mocks__/a2uiMockData';

// ==================== ErrorBoundary ====================

interface ErrorBoundaryProps {
  name: string;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class ComponentErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-lg border-2 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10 p-4">
          <p className="text-sm font-medium text-red-700 dark:text-red-300">
            ⚠️ {this.props.name} failed to render
          </p>
          <p className="text-xs text-red-500 dark:text-red-400 mt-1 font-mono">
            {this.state.error?.message}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

// ==================== Section Layout ====================

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4 pb-2 border-b-2 border-blue-500/30">
    {children}
  </h2>
);

const ComponentCard: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/30 shadow-sm overflow-hidden">
    <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{title}</h3>
    </div>
    <div className="p-4">
      <ComponentErrorBoundary name={title}>{children}</ComponentErrorBoundary>
    </div>
  </div>
);

// ==================== Story Config ====================

const meta = {
  title: 'A2UI/Overview',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Overview 组件总览 — Complete overview of all 11 A2UI custom components organised into 3 categories: **Basic Visualization** (Chart 图表, Table 数据表格, DataCard 数据卡片, Progress 进度指示器, CodeBlock 代码块, Markdown Markdown渲染器), **Data Display** (Timeline 时间线, Badge 标签徽章, JsonViewer JSON查看器), **Interactive Input** (Slider 滑块, DateTimeInput 日期时间输入).',      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const onAction = action('onAction');

export const AllComponents: Story = {
  render: () => (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
        A2UI Custom Components
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
        11 components across 3 categories — Basic Visualization, Data Display &amp; Interactive Input
      </p>

      {/* ========== Basic Visualization ========== */}
      <SectionTitle>📈 Basic Visualization Components</SectionTitle>
      <div className="grid gap-6 mb-10">
        {/* Chart — Bar */}
        <ComponentCard title="Chart — Bar chart (monthly sales)">
          <A2UIChart
            chartType={chartBarData.chartType}
            title={chartBarData.title}
            data={chartBarData.data}
          />
        </ComponentCard>

        {/* Chart — Line */}
        <ComponentCard title="Chart — Line chart (user trend)">
          <A2UIChart
            chartType={chartLineData.chartType}
            title={chartLineData.title}
            data={chartLineData.data}
          />
        </ComponentCard>

        {/* Chart — Pie */}
        <ComponentCard title="Chart — Pie chart (traffic source)">
          <A2UIChart
            chartType={chartPieData.chartType}
            title={chartPieData.title}
            data={chartPieData.data}
          />
        </ComponentCard>

        {/* Table */}
        <ComponentCard title="Table — Sortable data table with pagination">
          <A2UITable
            columns={tableColumns}
            data={tableData}
            title="Team Members"
            sortable
            pageSize={5}
          />
        </ComponentCard>

        {/* DataCard */}
        <ComponentCard title="DataCard — Metric cards with trend indicators">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <A2UIDataCard {...dataCardUp} />
            <A2UIDataCard {...dataCardDown} />
            <A2UIDataCard {...dataCardFlat} />
            <A2UIDataCard {...dataCardWithIcon} />
          </div>
        </ComponentCard>

        {/* Progress */}
        <ComponentCard title="Progress — Linear and circular indicators">
          <div className="space-y-6">
            <div className="space-y-3 max-w-md">
              {progressLinearSteps.slice(1, 4).map((step) => (
                <A2UIProgress
                  key={step.value}
                  value={step.value}
                  label={step.label}
                  variant="linear"
                  color={step.color}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-4">
              {progressCircularSteps.slice(1, 4).map((step) => (
                <A2UIProgress
                  key={step.value}
                  value={step.value}
                  label={step.label}
                  variant="circular"
                  color={step.color}
                />
              ))}
            </div>
          </div>
        </ComponentCard>

        {/* CodeBlock */}
        <ComponentCard title="CodeBlock — Syntax-highlighted code">
          <A2UICodeBlock code={codeBlockPython} language="python" title="Python Example" showLineNumbers />
        </ComponentCard>

        {/* Markdown */}
        <ComponentCard title="Markdown — Rich text content renderer">
          <A2UIMarkdown content={markdownRichContent} />
        </ComponentCard>
      </div>

      {/* ========== Data Display ========== */}
      <SectionTitle>📊 Data Display Components</SectionTitle>
      <div className="grid gap-6 mb-10">
        {/* Timeline */}
        <ComponentCard title="Timeline — Chronological events">
          <A2UITimeline items={timelineDefault} title="Project Progress" />
        </ComponentCard>

        {/* Badge */}
        <ComponentCard title="Badge — Inline status labels">
          <div className="flex flex-wrap gap-2">
            {badgeVariants.map((b) => (
              <A2UIBadge key={b.variant} text={b.text} variant={b.variant} />
            ))}
          </div>
        </ComponentCard>

        {/* JsonViewer */}
        <ComponentCard title="JsonViewer — Collapsible JSON tree">
          <A2UIJsonViewer data={jsonViewerNested} title="Service Config" />
        </ComponentCard>
      </div>

      {/* ========== Interactive Input ========== */}
      <SectionTitle>🎛️ Interactive Input Components</SectionTitle>
      <div className="grid gap-6 mb-10">
        {/* Slider */}
        <ComponentCard title="Slider — Numeric range input">
          <div className="max-w-md space-y-4">
            <A2UISlider value={sliderDefault.value} minValue={sliderDefault.minValue} maxValue={sliderDefault.maxValue} />
          </div>
        </ComponentCard>

        {/* DateTimeInput */}
        <ComponentCard title="DateTimeInput — Date and time pickers">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <A2UIDateTimeInput {...dateTimeInputDateOnly} />
            <A2UIDateTimeInput {...dateTimeInputTimeOnly} />
            <A2UIDateTimeInput {...dateTimeInputBoth} />
          </div>
        </ComponentCard>
      </div>
    </div>
  ),
};
