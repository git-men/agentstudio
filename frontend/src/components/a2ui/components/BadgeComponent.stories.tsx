import type { Meta, StoryObj } from '@storybook/react';
import { A2UIBadge } from './BadgeComponent';
import {
  badgeVariants,
  badgeCustomColor,
  badgeWithIcons,
} from './__mocks__/a2uiMockData';

const meta = {
  title: 'A2UI/Components/Badge',
  component: A2UIBadge,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Badge 标签徽章 — Inline label / tag component with 5 semantic variants (success, warning, error, info, neutral), optional custom color override, and optional leading icon.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof A2UIBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** All 5 built-in variants side by side */
export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      {badgeVariants.map((b) => (
        <A2UIBadge key={b.variant} text={b.text} variant={b.variant} />
      ))}
    </div>
  ),
};

/** Custom hex color overrides the variant styling */
export const CustomColor: Story = {
  args: {
    text: badgeCustomColor.text,
    color: badgeCustomColor.color,
  },
};

/** Emoji icons displayed before the text label */
export const WithIcon: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      {badgeWithIcons.map((b) => (
        <A2UIBadge key={b.variant} text={b.text} variant={b.variant} icon={b.icon} />
      ))}
    </div>
  ),
};

/** Multiple badges arranged inline — verify spacing and alignment */
export const InlineRow: Story = {
  render: () => (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Deployment status:{' '}
        <A2UIBadge text="v2.1.0" variant="info" icon="🏷️" />{' '}
        <A2UIBadge text="Deployed" variant="success" icon="✅" />{' '}
        <A2UIBadge text="3 replicas" variant="neutral" />
      </p>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Test results:{' '}
        <A2UIBadge text="142 passed" variant="success" />{' '}
        <A2UIBadge text="3 warnings" variant="warning" />{' '}
        <A2UIBadge text="1 failed" variant="error" />
      </p>
    </div>
  ),
};
