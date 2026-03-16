/**
 * A2UI Chart Component
 * Renders ECharts-based data visualizations
 */

import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';

interface ChartComponentProps {
  chartType: string;
  title?: string;
  data: any;
  options?: string;
  width?: string;
  height?: string;
}

/**
 * Build ECharts options from A2UI Chart component data
 */
function buildChartOption(props: ChartComponentProps): EChartsOption {
  const { chartType, title, data } = props;

  // Parse custom options if provided
  let customOptions: Partial<EChartsOption> = {};
  if (props.options) {
    try {
      customOptions = typeof props.options === 'string'
        ? JSON.parse(props.options)
        : props.options;
    } catch {
      // Ignore invalid JSON
    }
  }

  // Parse data if it's a string
  let chartData = data;
  if (typeof data === 'string') {
    try {
      chartData = JSON.parse(data);
    } catch {
      chartData = [];
    }
  }

  // Build base option
  const baseOption: EChartsOption = {
    title: title ? {
      text: title,
      left: 'center',
      textStyle: {
        fontSize: 14,
        fontWeight: 500,
        color: '#374151',
      },
    } : undefined,
    tooltip: {
      trigger: chartType === 'pie' ? 'item' : 'axis',
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      containLabel: true,
    },
    animation: true,
    animationDuration: 600,
  };

  // Build type-specific options
  switch (chartType) {
    case 'line':
    case 'bar':
      return buildAxisChart(baseOption, chartType, chartData, customOptions);
    case 'pie':
      return buildPieChart(baseOption, chartData, customOptions);
    case 'scatter':
      return buildScatterChart(baseOption, chartData, customOptions);
    case 'radar':
      return buildRadarChart(baseOption, chartData, customOptions);
    default:
      return { ...baseOption, ...customOptions };
  }
}

function buildAxisChart(
  base: EChartsOption,
  type: 'line' | 'bar',
  data: any,
  custom: Partial<EChartsOption>
): EChartsOption {
  // Support two data formats:
  // 1. { categories: string[], series: [{name, data}] }
  // 2. { xAxis: string[], yAxis: number[] } (simple)
  if (data.categories && data.series) {
    const hasLegend = data.series.length > 1;
    return {
      ...base,
      ...(hasLegend ? {
        grid: {
          ...((base as any).grid || {}),
          bottom: '15%',
          containLabel: true,
        },
        legend: {
          bottom: 0,
          left: 'center',
          type: 'scroll',
        },
      } : {}),
      xAxis: { type: 'category', data: data.categories },
      yAxis: { type: 'value' },
      series: data.series.map((s: any) => ({
        ...s,
        type,
        smooth: type === 'line',
      })),
      ...custom,
    };
  }

  if (data.xAxis && data.yAxis) {
    return {
      ...base,
      xAxis: { type: 'category', data: data.xAxis },
      yAxis: { type: 'value' },
      series: [{ type, data: data.yAxis, smooth: type === 'line' }],
      ...custom,
    };
  }

  // Fallback: array of {name, value} pairs
  if (Array.isArray(data)) {
    return {
      ...base,
      xAxis: { type: 'category', data: data.map((d: any) => d.name || d.label || d.x) },
      yAxis: { type: 'value' },
      series: [{ type, data: data.map((d: any) => d.value || d.y) }],
      ...custom,
    };
  }

  return { ...base, ...custom };
}

function buildPieChart(
  base: EChartsOption,
  data: any,
  custom: Partial<EChartsOption>
): EChartsOption {
  let pieData = data;
  if (data.series && Array.isArray(data.series)) {
    pieData = data.series;
  }

  return {
    ...base,
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
      label: { show: true, formatter: '{b}: {d}%' },
      data: Array.isArray(pieData) ? pieData : [],
    }],
    ...custom,
  };
}

function buildScatterChart(
  base: EChartsOption,
  data: any,
  custom: Partial<EChartsOption>
): EChartsOption {
  return {
    ...base,
    xAxis: { type: 'value' },
    yAxis: { type: 'value' },
    series: [{
      type: 'scatter',
      data: Array.isArray(data) ? data : (data.points || []),
      symbolSize: 8,
    }],
    ...custom,
  };
}

function buildRadarChart(
  base: EChartsOption,
  data: any,
  custom: Partial<EChartsOption>
): EChartsOption {
  return {
    ...base,
    radar: {
      indicator: data.indicators || [],
    },
    series: [{
      type: 'radar',
      data: data.series || [],
    }],
    ...custom,
  };
}

function isPercentageWidth(w: string): boolean {
  return /^\d+(\.\d+)?%$/.test(w);
}

const CHART_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#f97316', '#eab308',
  '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
];

export const A2UIChart: React.FC<ChartComponentProps> = (props) => {
  const option = useMemo(() => {
    const opt = buildChartOption(props);
    // Apply color palette
    if (!opt.color) {
      opt.color = CHART_COLORS;
    }
    return opt;
  }, [props]);

  const width = props.width || '100%';
  const height = props.height || '320px';

  // When a percentage width is used inside a flex container with gap,
  // raw percentages overflow (e.g. two 50% children + 12px gap > 100%).
  // Use calc() to subtract half the gap (parent uses gap-3 = 12px) so
  // columns fit on one row.  For 50% this becomes calc(50% - 6px).
  const style: React.CSSProperties = isPercentageWidth(width)
    ? { width: `calc(${width} - 6px)`, minWidth: 0, boxSizing: 'border-box' }
    : { width };

  return (
    <div className="a2ui-chart rounded-lg overflow-hidden" style={style}>
      <ReactECharts
        option={option}
        style={{ height, width: '100%' }}
        opts={{ renderer: 'svg' }}
        notMerge={true}
      />
    </div>
  );
};
