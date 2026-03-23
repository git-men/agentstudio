/**
 * A2UI Renderer
 * 
 * The main component that takes A2UI server messages and renders
 * the declarative component tree into React components.
 * Supports both standard A2UI catalog and AgentStudio custom components.
 */

import React, { useMemo, useCallback } from 'react';
import { A2UISurfaceManager } from './A2UISurfaceManager';
import type {
  A2UIServerMessage,
  A2UISurfaceState,
  A2UIComponentInstance,
  A2UIBoundValue,
  A2UIChildren,
  A2UIAction,
} from '../../types/a2uiTypes';

// Custom components
import { A2UIChart } from './components/ChartComponent';
import { A2UITable } from './components/TableComponent';
import { A2UIDataCard } from './components/DataCardComponent';
import { A2UIProgress } from './components/ProgressComponent';
import { A2UICodeBlock } from './components/CodeBlockComponent';
import { A2UIMarkdown } from './components/MarkdownComponent';
import { A2UITimeline } from './components/TimelineComponent';
import { A2UIBadge } from './components/BadgeComponent';
import { A2UIJsonViewer } from './components/JsonViewerComponent';
import { A2UISlider } from './components/SliderComponent';
import { A2UIDateTimeInput } from './components/DateTimeInputComponent';

interface A2UIRendererProps {
  /** A2UI server messages to render */
  messages: A2UIServerMessage[];
  /** Callback when user performs an action */
  onAction?: (actionName: string, context: Record<string, any>, surfaceId: string, componentId: string) => void;
  /** Custom class name */
  className?: string;
}

/**
 * Main A2UI Renderer - takes messages and renders surfaces
 */
export const A2UIRenderer: React.FC<A2UIRendererProps> = ({
  messages,
  onAction,
  className = '',
}) => {
  // Build surface state from messages
  const surfaces = useMemo(() => {
    const manager = new A2UISurfaceManager();
    manager.processMessages(messages);
    return manager.getReadySurfaces();
  }, [messages]);

  if (surfaces.length === 0) {
    return null;
  }

  return (
    <div className={`a2ui-renderer ${className}`}>
      {surfaces.map(surface => (
        <A2UISurface
          key={surface.surfaceId}
          surface={surface}
          onAction={onAction}
        />
      ))}
    </div>
  );
};

/**
 * Renders a single A2UI surface
 */
const A2UISurface: React.FC<{
  surface: A2UISurfaceState;
  onAction?: (actionName: string, context: Record<string, any>, surfaceId: string, componentId: string) => void;
}> = ({ surface, onAction }) => {
  if (!surface.rootId) return null;

  const rootComponent = surface.components.get(surface.rootId);
  if (!rootComponent) return null;

  return (
    <div className="a2ui-surface" data-surface-id={surface.surfaceId}>
      <ComponentRenderer
        component={rootComponent}
        surface={surface}
        onAction={onAction}
      />
    </div>
  );
};

/**
 * Recursively renders a component and its children
 */
const ComponentRenderer: React.FC<{
  component: A2UIComponentInstance;
  surface: A2UISurfaceState;
  onAction?: (actionName: string, context: Record<string, any>, surfaceId: string, componentId: string) => void;
}> = ({ component, surface, onAction }) => {
  const manager = useMemo(() => new A2UISurfaceManager(), []);

  const resolve = useCallback((bv: A2UIBoundValue | undefined): any => {
    return manager.resolveBoundValue(surface, bv);
  }, [manager, surface]);

  const renderChild = useCallback((childId: string) => {
    const child = surface.components.get(childId);
    if (!child) return null;
    return (
      <ComponentRenderer
        key={childId}
        component={child}
        surface={surface}
        onAction={onAction}
      />
    );
  }, [surface, onAction]);

  const renderChildren = useCallback((children: A2UIChildren | undefined) => {
    if (!children) return null;
    if (children.explicitList) {
      return children.explicitList.map(id => renderChild(id));
    }
    // Template rendering for dynamic lists
    if (children.template) {
      const listData = manager.resolveBoundValue(surface, { path: children.template.dataBinding });
      if (Array.isArray(listData)) {
        return listData.map((_item, idx) => {
          const templateComp = surface.components.get(children.template!.componentId);
          if (!templateComp) return null;
          return (
            <ComponentRenderer
              key={`${children.template!.componentId}-${idx}`}
              component={templateComp}
              surface={surface}
              onAction={onAction}
            />
          );
        });
      }
    }
    return null;
  }, [surface, onAction, manager, renderChild]);

  const handleAction = useCallback((action: A2UIAction) => {
    if (!onAction) return;
    const context: Record<string, any> = {};
    if (action.context) {
      for (const item of action.context) {
        context[item.key] = resolve(item.value);
      }
    }
    onAction(action.name, context, surface.surfaceId, component.id);
  }, [onAction, resolve, surface.surfaceId, component.id]);

  // Get the component type (first key in the component object)
  const comp = component.component;
  const typeName = Object.keys(comp)[0];
  const props = comp[typeName];

  // Render based on component type
  switch (typeName) {
    // ==================== Layout Components ====================
    case 'Row':
      return (
        <div
          className="a2ui-row flex flex-wrap gap-3"
          style={{
            alignItems: mapAlignment(props.alignment),
            justifyContent: mapDistribution(props.distribution),
            width: props.width || '100%'
          }}
        >
          {renderChildren(props.children)}
        </div>
      );

    case 'Column':
      return (
        <div
          className="a2ui-column flex flex-col gap-2"
          style={{
            alignItems: mapAlignment(props.alignment),
            justifyContent: mapDistribution(props.distribution),
          }}
        >
          {renderChildren(props.children)}
        </div>
      );

    // ==================== Display Components ====================
    case 'Text': {
      const text = resolve(props.text) || '';
      const Tag = getTextTag(props.usageHint);
      const textClass = getTextClass(props.usageHint);
      return <Tag className={`a2ui-text ${textClass}`}>{text}</Tag>;
    }

    case 'Image': {
      const url = resolve(props.url);
      return url ? (
        <img
          src={url}
          alt=""
          className="a2ui-image max-w-full rounded-md"
        />
      ) : null;
    }

    case 'Icon': {
      const name = resolve(props.name);
      return (
        <span className="a2ui-icon material-icons text-gray-600 dark:text-gray-400">
          {name}
        </span>
      );
    }

    case 'Divider':
      return props.axis === 'vertical'
        ? <div className="a2ui-divider w-px bg-gray-200 dark:bg-gray-700 self-stretch" />
        : <hr className="a2ui-divider border-gray-200 dark:border-gray-700 my-2" />;

    // ==================== Interactive Components ====================
    case 'Button': {
      const childContent = props.child ? renderChild(props.child) : null;
      return (
        <button
          className={`a2ui-button inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors
            ${props.primary
              ? 'bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600'
              : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-750'
            }`}
          onClick={() => props.action && handleAction(props.action)}
        >
          {childContent}
        </button>
      );
    }

    case 'TextField': {
      const label = resolve(props.label);
      const text = resolve(props.text) || '';
      return (
        <div className="a2ui-textfield w-full">
          {label && (
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>
          )}
          <input
            type={mapTextFieldType(props.textFieldType)}
            value={text}
            readOnly
            className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
          />
        </div>
      );
    }

    case 'CheckBox': {
      const label = resolve(props.label);
      const checked = resolve(props.value) || false;
      return (
        <label className="a2ui-checkbox inline-flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={checked} readOnly className="rounded border-gray-300 dark:border-gray-600" />
          <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
        </label>
      );
    }

    case 'Slider': {
      const sliderValue = resolve(props.value) || 0;
      return (
        <A2UISlider
          value={sliderValue}
          minValue={props.minValue}
          maxValue={props.maxValue}
          onChange={(newValue) => {
            if (onAction) {
              onAction('sliderChange', { value: newValue }, surface.surfaceId, component.id);
            }
          }}
        />
      );
    }

    case 'DateTimeInput': {
      const dtValue = resolve(props.value) || '';
      return (
        <A2UIDateTimeInput
          value={dtValue}
          enableDate={props.enableDate}
          enableTime={props.enableTime}
          onChange={(newValue) => {
            if (onAction) {
              onAction('dateTimeChange', { value: newValue }, surface.surfaceId, component.id);
            }
          }}
        />
      );
    }

    // ==================== Container Components ====================
    case 'Card':
      return (
        <div className="a2ui-card rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 shadow-sm">
          {props.child && renderChild(props.child)}
        </div>
      );

    case 'Tabs': {
      const [activeTab, setActiveTab] = React.useState(0);
      const items = props.tabItems || [];
      return (
        <div className="a2ui-tabs">
          <div className="flex border-b border-gray-200 dark:border-gray-700 mb-3">
            {items.map((tab: any, idx: number) => (
              <button
                key={idx}
                className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors
                  ${idx === activeTab
                    ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                onClick={() => setActiveTab(idx)}
              >
                {resolve(tab.title)}
              </button>
            ))}
          </div>
          {items[activeTab]?.child && renderChild(items[activeTab].child)}
        </div>
      );
    }

    case 'List':
      return (
        <div className="a2ui-list flex flex-col gap-2">
          {renderChildren(props.children)}
        </div>
      );

    case 'Modal':
      // Modal: render entry point inline, content in a simple overlay
      return (
        <div className="a2ui-modal">
          {props.entryPointChild && renderChild(props.entryPointChild)}
        </div>
      );

    // ==================== AgentStudio Custom Components ====================
    case 'Chart':
      return (
        <A2UIChart
          chartType={resolve(props.chartType) || 'bar'}
          title={resolve(props.title)}
          data={resolve(props.data)}
          options={resolve(props.options)}
          width={resolve(props.width)}
          height={resolve(props.height)}
        />
      );

    case 'Table':
      return (
        <A2UITable
          columns={resolve(props.columns)}
          data={resolve(props.data)}
          title={resolve(props.title)}
          sortable={resolve(props.sortable)}
          pageSize={resolve(props.pageSize)}
        />
      );

    case 'DataCard':
      return (
        <A2UIDataCard
          title={resolve(props.title) ?? ''}
          value={resolve(props.value) ?? '-'}
          unit={resolve(props.unit)}
          trend={resolve(props.trend)}
          trendValue={resolve(props.trendValue)}
          icon={resolve(props.icon)}
          changeLabel={resolve(props.changeLabel)}
          sparkline={resolve(props.sparkline)}
        />
      );

    case 'Progress':
      return (
        <A2UIProgress
          value={resolve(props.value) || 0}
          label={resolve(props.label)}
          variant={resolve(props.variant)}
          color={resolve(props.color)}
        />
      );

    case 'CodeBlock':
      return (
        <A2UICodeBlock
          code={resolve(props.code) || ''}
          language={resolve(props.language)}
          title={resolve(props.title)}
          showLineNumbers={resolve(props.showLineNumbers)}
          maxHeight={resolve(props.maxHeight)}
          highlightLines={resolve(props.highlightLines)}
        />
      );

    case 'Markdown':
      return (
        <A2UIMarkdown content={resolve(props.content) || ''} />
      );

    // ==================== New Data Display Components ====================
    case 'Timeline':
      return (
        <A2UITimeline
          items={resolve(props.items) || []}
          title={resolve(props.title)}
          direction={resolve(props.direction)}
        />
      );

    case 'Badge':
      return (
        <A2UIBadge
          text={resolve(props.text) || ''}
          variant={resolve(props.variant)}
          color={resolve(props.color)}
          icon={resolve(props.icon)}
        />
      );

    case 'JsonViewer':
      return (
        <A2UIJsonViewer
          data={resolve(props.data)}
          title={resolve(props.title)}
          defaultExpandDepth={resolve(props.defaultExpandDepth)}
          theme={resolve(props.theme)}
        />
      );



    // ==================== Unknown Component ====================
    default:
      return (
        <div className="a2ui-unknown text-xs text-gray-400 italic p-2 border border-dashed border-gray-300 dark:border-gray-600 rounded">
          Unknown component: {typeName}
        </div>
      );
  }
};

// ==================== Helper Functions ====================

function mapAlignment(alignment?: string): string {
  switch (alignment) {
    case 'start': return 'flex-start';
    case 'center': return 'center';
    case 'end': return 'flex-end';
    case 'stretch': return 'stretch';
    default: return 'flex-start';
  }
}

function mapDistribution(distribution?: string): string {
  switch (distribution) {
    case 'start': return 'flex-start';
    case 'center': return 'center';
    case 'end': return 'flex-end';
    case 'spaceBetween': return 'space-between';
    case 'spaceAround': return 'space-around';
    case 'spaceEvenly': return 'space-evenly';
    default: return 'flex-start';
  }
}

function getTextTag(hint?: string): keyof JSX.IntrinsicElements {
  switch (hint) {
    case 'h1': return 'h1';
    case 'h2': return 'h2';
    case 'h3': return 'h3';
    case 'h4': return 'h4';
    case 'h5': return 'h5';
    case 'caption': return 'span';
    default: return 'p';
  }
}

function getTextClass(hint?: string): string {
  switch (hint) {
    case 'h1': return 'text-xl font-bold text-gray-900 dark:text-gray-100';
    case 'h2': return 'text-lg font-semibold text-gray-900 dark:text-gray-100';
    case 'h3': return 'text-base font-semibold text-gray-800 dark:text-gray-200';
    case 'h4': return 'text-sm font-semibold text-gray-800 dark:text-gray-200';
    case 'h5': return 'text-sm font-medium text-gray-700 dark:text-gray-300';
    case 'caption': return 'text-xs text-gray-500 dark:text-gray-400';
    default: return 'text-sm text-gray-700 dark:text-gray-300';
  }
}

function mapTextFieldType(type?: string): string {
  switch (type) {
    case 'number': return 'number';
    case 'date': return 'date';
    case 'obscured': return 'password';
    default: return 'text';
  }
}

export default A2UIRenderer;
