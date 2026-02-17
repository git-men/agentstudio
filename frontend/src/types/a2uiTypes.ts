/**
 * A2UI (Agent-to-UI) Protocol Types for AgentStudio
 * Based on Google's A2UI v0.8 specification
 * @see https://google.github.io/A2UI/
 */

// ==================== Core Protocol Types ====================

/** A2UI message types from server to client */
export type A2UIServerMessage =
  | A2UISurfaceUpdate
  | A2UIDataModelUpdate
  | A2UIBeginRendering
  | A2UIDeleteSurface;

/** Surface update - defines or updates UI components */
export interface A2UISurfaceUpdate {
  surfaceUpdate: {
    surfaceId?: string;
    components: A2UIComponentInstance[];
  };
}

/** Data model update - updates application state */
export interface A2UIDataModelUpdate {
  dataModelUpdate: {
    surfaceId?: string;
    path?: string;
    contents: A2UIDataEntry[];
  };
}

/** Begin rendering signal */
export interface A2UIBeginRendering {
  beginRendering: {
    surfaceId?: string;
    root: string;
    catalogId?: string;
  };
}

/** Delete surface signal */
export interface A2UIDeleteSurface {
  deleteSurface: {
    surfaceId: string;
  };
}

/** A single component instance in the adjacency list */
export interface A2UIComponentInstance {
  id: string;
  component: Record<string, any>;
  weight?: number;
}

/** Data entry in the data model */
export interface A2UIDataEntry {
  key: string;
  valueString?: string;
  valueNumber?: number;
  valueBoolean?: boolean;
  valueMap?: A2UIDataEntry[];
  valueArray?: any[];
}

/** Bound value - can be literal or data-bound */
export interface A2UIBoundValue {
  literalString?: string;
  literalNumber?: number;
  literalBoolean?: boolean;
  literalArray?: any[];
  path?: string;
}

/** Action definition for interactive components */
export interface A2UIAction {
  name: string;
  context?: Array<{
    key: string;
    value: A2UIBoundValue;
  }>;
}

/** Children definition for container components */
export interface A2UIChildren {
  explicitList?: string[];
  template?: {
    dataBinding: string;
    componentId: string;
  };
}

// ==================== Client-to-Server Types ====================

/** User action event sent from client to server */
export interface A2UIUserAction {
  userAction: {
    name: string;
    surfaceId: string;
    sourceComponentId: string;
    timestamp: string;
    context: Record<string, any>;
  };
}

// ==================== Standard Catalog Components ====================

export interface TextComponent {
  Text: {
    text: A2UIBoundValue;
    usageHint?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'caption' | 'body';
  };
}

export interface ImageComponent {
  Image: {
    url: A2UIBoundValue;
  };
}

export interface IconComponent {
  Icon: {
    name: A2UIBoundValue;
  };
}

export interface DividerComponent {
  Divider: {
    axis?: 'horizontal' | 'vertical';
  };
}

export interface ButtonComponent {
  Button: {
    child: string;
    primary?: boolean;
    action: A2UIAction;
  };
}

export interface TextFieldComponent {
  TextField: {
    label: A2UIBoundValue;
    text: A2UIBoundValue;
    textFieldType?: 'date' | 'longText' | 'number' | 'shortText' | 'obscured';
  };
}

export interface CheckBoxComponent {
  CheckBox: {
    label: A2UIBoundValue;
    value: A2UIBoundValue;
  };
}

export interface RowComponent {
  Row: {
    children: A2UIChildren;
    alignment?: 'start' | 'center' | 'end' | 'stretch';
    distribution?: 'start' | 'center' | 'end' | 'spaceBetween' | 'spaceAround' | 'spaceEvenly';
  };
}

export interface ColumnComponent {
  Column: {
    children: A2UIChildren;
    alignment?: 'start' | 'center' | 'end' | 'stretch';
    distribution?: 'start' | 'center' | 'end' | 'spaceBetween' | 'spaceAround' | 'spaceEvenly';
  };
}

export interface CardComponent {
  Card: {
    child: string;
  };
}

export interface ModalComponent {
  Modal: {
    entryPointChild: string;
    contentChild: string;
  };
}

export interface TabsComponent {
  Tabs: {
    tabItems: Array<{
      title: A2UIBoundValue;
      child: string;
    }>;
  };
}

export interface ListComponent {
  List: {
    children: A2UIChildren;
  };
}

// ==================== AgentStudio Custom Components ====================

/** ECharts-based chart component */
export interface ChartComponent {
  Chart: {
    chartType: A2UIBoundValue; // 'line' | 'bar' | 'pie' | 'scatter' | 'radar' | 'heatmap' etc.
    title?: A2UIBoundValue;
    data: A2UIBoundValue; // JSON path or literal data
    options?: A2UIBoundValue; // ECharts option overrides (JSON string)
    width?: A2UIBoundValue;
    height?: A2UIBoundValue;
  };
}

/** Data table component */
export interface TableComponent {
  Table: {
    columns: A2UIBoundValue; // Column definitions (JSON)
    data: A2UIBoundValue; // Row data (JSON path or literal)
    title?: A2UIBoundValue;
    sortable?: A2UIBoundValue;
    pageSize?: A2UIBoundValue;
  };
}

/** Data card - metric display with trend */
export interface DataCardComponent {
  DataCard: {
    title: A2UIBoundValue;
    value: A2UIBoundValue;
    unit?: A2UIBoundValue;
    trend?: A2UIBoundValue; // 'up' | 'down' | 'flat'
    trendValue?: A2UIBoundValue;
    icon?: A2UIBoundValue;
  };
}

/** Progress indicator */
export interface ProgressComponent {
  Progress: {
    value: A2UIBoundValue; // 0-100
    label?: A2UIBoundValue;
    variant?: A2UIBoundValue; // 'linear' | 'circular'
    color?: A2UIBoundValue;
  };
}

/** Code block with syntax highlighting */
export interface CodeBlockComponent {
  CodeBlock: {
    code: A2UIBoundValue;
    language?: A2UIBoundValue;
    title?: A2UIBoundValue;
  };
}

/** Markdown content renderer */
export interface MarkdownComponent {
  Markdown: {
    content: A2UIBoundValue;
  };
}

// ==================== Surface State Management ====================

/** Represents a single A2UI surface being rendered */
export interface A2UISurfaceState {
  surfaceId: string;
  rootId?: string;
  catalogId?: string;
  components: Map<string, A2UIComponentInstance>;
  dataModel: Record<string, any>;
  isReady: boolean;
}

/** A2UI data stored in a MessagePart */
export interface A2UISurfaceData {
  surfaceId: string;
  messages: A2UIServerMessage[];
  isComplete: boolean;
}

// ==================== Catalog Definition ====================

/**
 * AgentStudio A2UI Component Catalog
 * This catalog extends the standard A2UI catalog with custom components
 */
export const AGENTSTUDIO_CATALOG_ID = 'https://agentstudio.ai/a2ui/v1/catalog';

export const STANDARD_CATALOG_COMPONENTS = [
  'Text', 'Image', 'Icon', 'Divider',
  'Button', 'TextField', 'CheckBox',
  'Row', 'Column', 'Card', 'Modal', 'Tabs', 'List'
] as const;

export const CUSTOM_CATALOG_COMPONENTS = [
  'Chart', 'Table', 'DataCard', 'Progress', 'CodeBlock', 'Markdown'
] as const;

export const ALL_CATALOG_COMPONENTS = [
  ...STANDARD_CATALOG_COMPONENTS,
  ...CUSTOM_CATALOG_COMPONENTS,
] as const;

export type StandardComponentName = typeof STANDARD_CATALOG_COMPONENTS[number];
export type CustomComponentName = typeof CUSTOM_CATALOG_COMPONENTS[number];
export type ComponentName = typeof ALL_CATALOG_COMPONENTS[number];
