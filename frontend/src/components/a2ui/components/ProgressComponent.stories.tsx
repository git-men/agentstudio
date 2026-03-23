import type { Meta, StoryObj } from '@storybook/react';
import { A2UIProgress } from './ProgressComponent';
import {
  progressLinearSteps,
  progressCircularSteps,
} from './__mocks__/a2uiMockData';

const meta = {
  title: 'A2UI/Components/Progress',
  component: A2UIProgress,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Progress 进度指示器 — Progress indicator component supporting linear bar and circular ring variants. Displays values from 0% to 100% with customizable colors and labels.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof A2UIProgress>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Linear progress bars at 0%, 25%, 50%, 75%, and 100% */
export const Linear: Story = {
  args: {
    value: 50,
    label: 'Halfway',
    variant: 'linear',
  },
  render: () => (
    <div className="space-y-4 max-w-md">
      {progressLinearSteps.map((step) => (
        <A2UIProgress
          key={step.value}
          value={step.value}
          label={step.label}
          variant="linear"
          color={step.color}
        />
      ))}
    </div>
  ),
};

/** Circular progress rings at 0%, 25%, 50%, 75%, and 100% */
export const Circular: Story = {
  args: {
    value: 50,
    label: 'Processing',
    variant: 'circular',
  },
  render: () => (
    <div className="flex flex-wrap gap-6">
      {progressCircularSteps.map((step) => (
        <A2UIProgress
          key={step.value}
          value={step.value}
          label={step.label}
          variant="circular"
          color={step.color}
        />
      ))}
    </div>
  ),
};

/** Single linear progress bar at 75% */
export const SingleLinear: Story = {
  args: {
    value: 75,
    label: 'Uploading...',
    variant: 'linear',
    color: '#8b5cf6',
  },
};

/** Single circular progress ring at 60% */
export const SingleCircular: Story = {
  args: {
    value: 60,
    label: 'Processing',
    variant: 'circular',
    color: '#06b6d4',
  },
};
