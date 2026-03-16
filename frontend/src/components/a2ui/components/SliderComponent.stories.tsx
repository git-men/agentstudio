import type { Meta, StoryObj } from '@storybook/react';
import { action } from 'storybook/actions';
import { A2UISlider } from './SliderComponent';
import {
  sliderDefault,
  sliderCustomRange,
} from './__mocks__/a2uiMockData';

const meta = {
  title: 'A2UI/Components/Slider',
  component: A2UISlider,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Slider 滑块 — Interactive numeric range input component with configurable min/max bounds. Users can drag the thumb to change the value. Displays the current value alongside the slider track.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    onChange: { action: 'onChange' },
  },
} satisfies Meta<typeof A2UISlider>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Default interactive slider: 0–100 range with value at 50 */
export const Default: Story = {
  args: {
    ...sliderDefault,
    onChange: action('slider-change'),
  },
};

/** Custom range: 0–50 with value at 25 */
export const CustomRange: Story = {
  args: {
    ...sliderCustomRange,
    onChange: action('slider-change'),
  },
};

/** Multiple interactive sliders demonstrating various ranges */
export const MultipleSliders: Story = {
  args: sliderDefault,
  render: () => {
    const log = action('slider-change');
    return (
      <div className="space-y-6 max-w-md">
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Volume (0–100)</p>
          <A2UISlider value={75} minValue={0} maxValue={100} onChange={(v) => log('volume', v)} />
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Temperature (−10–40)</p>
          <A2UISlider value={22} minValue={-10} maxValue={40} onChange={(v) => log('temperature', v)} />
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Brightness (0–255)</p>
          <A2UISlider value={128} minValue={0} maxValue={255} onChange={(v) => log('brightness', v)} />
        </div>
      </div>
    );
  },
};
