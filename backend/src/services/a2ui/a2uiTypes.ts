/**
 * A2UI Backend Types
 * Shared types for A2UI protocol support in AgentStudio backend
 */

/** A2UI server-to-client message */
export type A2UIServerMessage =
  | { surfaceUpdate: { surfaceId?: string; components: A2UIComponentInstance[] } }
  | { dataModelUpdate: { surfaceId?: string; path?: string; contents: A2UIDataEntry[] } }
  | { beginRendering: { surfaceId?: string; root: string; catalogId?: string } }
  | { deleteSurface: { surfaceId: string } };

export interface A2UIComponentInstance {
  id: string;
  component: Record<string, any>;
  weight?: number;
}

export interface A2UIDataEntry {
  key: string;
  valueString?: string;
  valueNumber?: number;
  valueBoolean?: boolean;
  valueMap?: A2UIDataEntry[];
  valueArray?: any[];
}

/**
 * The catalog of components available in AgentStudio's A2UI renderer.
 * This is injected into the agent's system prompt so it knows what components to use.
 */
export const A2UI_CATALOG_PROMPT = `
## A2UI Rich UI Components

You can generate rich interactive UIs using the A2UI protocol. When the user's request would benefit from visual presentation (charts, tables, data cards, etc.), generate A2UI JSON to create a rich UI experience.

### How to use
Call the \`render_ui\` tool with A2UI messages as the \`messages\` parameter. Each message is a JSON object with one of these types:
- \`surfaceUpdate\`: Define UI component structure
- \`dataModelUpdate\`: Provide data for data-bound components
- \`beginRendering\`: Signal the UI is ready to render

### Available Components

**Layout**: Row, Column
**Display**: Text (usageHint: h1-h5, caption, body), Image, Icon, Divider
**Interactive**: Button, TextField, CheckBox, Slider, DateTimeInput
**Container**: Card, Tabs, List

**Custom (AgentStudio) — Data Display**:
- **Chart**: ECharts visualization. Props: chartType (line/bar/pie/scatter/radar), title, data, options, width, height
  - Data formats for line/bar: \`{categories: string[], series: [{name, data: number[]}]}\` or \`{xAxis: string[], yAxis: number[]}\`
  - Data format for pie: \`[{name, value}]\`
- **Table**: Data table. Props: columns ({key, label, align?, width?}[]), data (row objects[]), title, sortable, pageSize
- **DataCard**: Metric card. Props: title, value, unit, trend (up/down/flat), trendValue, icon
- **Progress**: Progress indicator. Props: value (0-100), label, variant (linear/circular), color
- **CodeBlock**: Code display with syntax highlighting. Props: code, language (sql/javascript/python/go/java and more), title, showLineNumbers (bool), maxHeight (e.g. "400px"), highlightLines (number[] of line numbers to highlight)
- **Markdown**: Rich text. Props: content
- **Timeline**: Chronological event list. Props: items ({title, description?, time?, status?: completed|active|pending|error}[]), title, direction (vertical|horizontal). Use dataModelUpdate to provide items via path binding.
- **Badge**: Inline status label/tag. Props: text, variant (success|warning|error|info|neutral), color (custom hex override), icon. Render multiple Badges in a Row for status lists.
- **JsonViewer**: Collapsible JSON tree viewer. Props: data (JSON object/array via path), title, defaultExpandDepth (default 2), theme (light|dark). Use for displaying API responses or complex data structures.
- **Slider**: Numeric range input with draggable thumb. Props: value (current number), minValue (default 0), maxValue (default 100). Triggers action on change. Use for adjustable numeric settings like thresholds, percentages, or volume controls.
- **DateTimeInput**: Date and/or time picker. Props: value (ISO format string, e.g. "2024-06-15" or "14:30" or "2024-06-15T14:30"), enableDate (bool, default true), enableTime (bool, default false). Modes: date-only (enableDate:true), time-only (enableTime:true), combined datetime (both true). Triggers action on change.

### Component Structure
Components use an adjacency list (flat list with ID references):
\`\`\`json
{"surfaceUpdate": {"components": [
  {"id": "root", "component": {"Column": {"children": {"explicitList": ["title", "chart1"]}}}},
  {"id": "title", "component": {"Text": {"text": {"literalString": "Sales Report"}, "usageHint": "h2"}}},
  {"id": "chart1", "component": {"Chart": {"chartType": {"literalString": "bar"}, "title": {"literalString": "Monthly Sales"}, "data": {"path": "/sales"}}}}
]}}
{"dataModelUpdate": {"contents": [{"key": "sales", "valueMap": [{"key": "categories", "valueArray": ["Jan","Feb","Mar"]}, {"key": "series", "valueArray": [{"name":"Revenue","data":[100,200,150]}]}]}]}}
{"beginRendering": {"root": "root"}}
\`\`\`

### Values
Properties accept BoundValue objects:
- Literal: \`{"literalString": "Hello"}\` or \`{"literalNumber": 42}\` or \`{"literalBoolean": true}\`
- Data-bound: \`{"path": "/data/field"}\`
- Both (init + bind): \`{"literalString": "default", "path": "/data/field"}\`
`.trim();
