import type { Meta, StoryObj } from '@storybook/react';
import { action } from 'storybook/actions';
import { A2UIDateTimeInput } from './DateTimeInputComponent';
import {
  dateTimeInputDateOnly,
  dateTimeInputTimeOnly,
  dateTimeInputBoth,
} from './__mocks__/a2uiMockData';

const meta = {
  title: 'A2UI/Components/DateTimeInput',
  component: A2UIDateTimeInput,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'DateTimeInput 日期时间输入 — Interactive date and/or time picker component. Users can select date/time via the native picker. Supports date-only, time-only, and combined datetime modes via enableDate / enableTime flags.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    onChange: { action: 'onChange' },
  },
} satisfies Meta<typeof A2UIDateTimeInput>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Interactive date-only picker (enableDate: true, enableTime: false) */
export const DateOnly: Story = {
  args: {
    ...dateTimeInputDateOnly,
    onChange: action('date-change'),
  },
};

/** Interactive time-only picker (enableDate: false, enableTime: true) */
export const TimeOnly: Story = {
  args: {
    ...dateTimeInputTimeOnly,
    onChange: action('time-change'),
  },
};

/** Interactive combined date & time picker (enableDate: true, enableTime: true) */
export const DateAndTime: Story = {
  args: {
    ...dateTimeInputBoth,
    onChange: action('datetime-change'),
  },
};

/** All three interactive modes side by side */
export const AllModes: Story = {
  args: dateTimeInputDateOnly,
  render: () => {
    const log = action('datetime-change');
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl">
        <A2UIDateTimeInput {...dateTimeInputDateOnly} onChange={(v) => log('date', v)} />
        <A2UIDateTimeInput {...dateTimeInputTimeOnly} onChange={(v) => log('time', v)} />
        <A2UIDateTimeInput {...dateTimeInputBoth} onChange={(v) => log('datetime', v)} />
      </div>
    );
  },
};
