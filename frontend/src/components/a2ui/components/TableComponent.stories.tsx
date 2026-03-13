import type { Meta, StoryObj } from '@storybook/react';
import { A2UITable } from './TableComponent';
import { tableColumns, tableData } from './__mocks__/a2uiMockData';

const meta = {
  title: 'A2UI/Components/Table',
  component: A2UITable,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Table 数据表格 — Data table component with column definitions, sorting, and pagination. Supports 20+ rows with configurable page sizes.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof A2UITable>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Default table rendering all 22 rows with sorting enabled */
export const Default: Story = {
  args: {
    columns: tableColumns,
    data: tableData,
    title: 'Team Members',
  },
};

/** Sortable table — click column headers to sort ascending/descending */
export const Sortable: Story = {
  args: {
    columns: tableColumns,
    data: tableData,
    title: 'Sortable Team Members',
    sortable: true,
  },
};

/** Paginated table with 5 rows per page */
export const Paginated: Story = {
  args: {
    columns: tableColumns,
    data: tableData,
    title: 'Paginated Table (5 rows/page)',
    pageSize: 5,
  },
};

/** Small page size of 3 to show more pages */
export const SmallPageSize: Story = {
  args: {
    columns: tableColumns,
    data: tableData,
    title: 'Small Page Size (3 rows/page)',
    pageSize: 3,
    sortable: true,
  },
};
