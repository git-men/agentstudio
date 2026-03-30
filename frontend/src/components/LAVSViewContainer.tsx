/**
 * LAVS View Container
 *
 * Dynamically loads and displays LAVS view components for agents.
 * This component:
 * 1. Checks if agent has lavs.json
 * 2. Loads the manifest
 * 3. Loads the view component (local/CDN/npm)
 * 4. Injects LAVSClient
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { LAVSClient, LAVSViewComponent } from 'lavs-client';
import type { LAVSManifest } from 'lavs-client';
import type { AgentConfig } from '../types';
import { useAgentStore } from '../stores/useAgentStore';
import { eventBus, EVENTS } from '../utils/eventBus';
import { API_BASE, getCurrentHost } from '../lib/config';
import { authFetch } from '../lib/authFetch';

interface LAVSViewContainerProps {
  agent: AgentConfig;
  projectPath?: string;
  onToolExecuted?: (toolName: string, toolInput: any, toolResult: any) => void;
}

export const LAVSViewContainer: React.FC<LAVSViewContainerProps> = ({
  agent,
  projectPath,
}) => {
  const [manifest, setManifest] = useState<LAVSManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [componentLoaded, setComponentLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lavsClientRef = useRef<LAVSClient | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const messageHandlerCleanupRef = useRef<(() => void) | null>(null);

  // Subscribe to tool execution notifications from store
  const lastToolExecution = useAgentStore((state) => state.lastToolExecution);

  // Initialize LAVS client with projectPath and resolved backend URL
  useEffect(() => {
    lavsClientRef.current = new LAVSClient({
      agentId: agent.id,
      baseURL: getCurrentHost(),
      projectPath,
    });
  }, [agent.id, projectPath]);

  // Load manifest
  useEffect(() => {
    const loadManifest = async () => {
      if (!lavsClientRef.current) return;

      try {
        setLoading(true);
        setError(null);

        const manifestData = await lavsClientRef.current.getManifest();
        setManifest(manifestData);
      } catch (err: any) {
        console.error('[LAVS] Failed to load manifest:', err);
        setError(err.message || 'Failed to load LAVS manifest');
      } finally {
        setLoading(false);
      }
    };

    loadManifest();
  }, [agent.id]);

  // Load view component when manifest is available
  useEffect(() => {
    console.log('[LAVS] Load component effect triggered', {
      hasManifest: !!manifest,
      hasView: !!manifest?.view,
      hasContainer: !!containerRef.current
    });

    if (!manifest || !manifest.view || !containerRef.current) return;

    // Clear previous content to avoid duplicate iframes on re-runs
    const container = containerRef.current;
    container.innerHTML = '';
    iframeRef.current = null;
    setComponentLoaded(false);

    let cancelled = false;

    const loadComponent = async () => {
      try {
        const { component } = manifest.view!;
        console.log('[LAVS] Loading component', { type: component.type, path: (component as any).path });

        switch (component.type) {
          case 'local': {
            await loadLocalComponent(component.path);
            break;
          }

          case 'cdn': {
            await loadCDNComponent(component.url, component.exportName);
            break;
          }

          case 'npm': {
            console.warn('[LAVS] NPM component loading not yet implemented');
            setError('NPM component loading not yet implemented');
            break;
          }

          case 'inline': {
            loadInlineComponent(component.code);
            break;
          }

          default:
            throw new Error(`Unknown component type: ${(component as any).type}`);
        }

        if (!cancelled) setComponentLoaded(true);
      } catch (err: any) {
        console.error('[LAVS] Failed to load component:', err);
        if (!cancelled) setError(err.message || 'Failed to load view component');
      }
    };

    loadComponent();

    return () => {
      cancelled = true;
      container.innerHTML = '';
      iframeRef.current = null;
      messageHandlerCleanupRef.current?.();
      messageHandlerCleanupRef.current = null;
    };
  }, [manifest]);

  // Inject LAVS client into component after it's loaded
  useEffect(() => {
    if (!componentLoaded || !containerRef.current || !lavsClientRef.current) return;

    // Find the custom element and inject client
    const customElement = containerRef.current.querySelector('*[data-lavs-component]');
    if (customElement && 'setLAVSClient' in customElement) {
      console.log('[LAVS] Injecting LAVS client into component');
      (customElement as LAVSViewComponent).setLAVSClient(lavsClientRef.current);
    }
  }, [componentLoaded]);

  // Listen for tool execution notifications and notify iframe
  useEffect(() => {
    if (!componentLoaded || !iframeRef.current || !lastToolExecution) return;

    console.log('[LAVS] Tool execution detected:', lastToolExecution);

    // Notify iframe view component via postMessage
    if (iframeRef.current.contentWindow) {
      const message = {
        type: 'lavs-agent-action',
        action: {
          type: 'tool_executed',
          tool: lastToolExecution.toolName,
          timestamp: lastToolExecution.timestamp,
        }
      };

      console.log('[LAVS] Sending postMessage to iframe:', message);
      iframeRef.current.contentWindow.postMessage(message, '*');
    }
  }, [lastToolExecution, componentLoaded]);

  // Fallback: refresh LAVS view when AI response completes (covers all tool execution paths)
  useEffect(() => {
    if (!componentLoaded || !iframeRef.current) return;

    const handleResponseComplete = () => {
      if (iframeRef.current?.contentWindow) {
        const message = {
          type: 'lavs-agent-action',
          action: {
            type: 'tool_executed',
            tool: '__lavs_refresh__',
            timestamp: Date.now(),
          }
        };
        console.log('[LAVS] AI response complete — sending refresh to iframe');
        iframeRef.current.contentWindow.postMessage(message, '*');
      }
    };

    eventBus.on(EVENTS.AI_RESPONSE_COMPLETE, handleResponseComplete);
    return () => {
      eventBus.off(EVENTS.AI_RESPONSE_COMPLETE, handleResponseComplete);
    };
  }, [componentLoaded]);

  // ---------------------------------------------------------------------------
  // AI Bridge: handle lavs-ai-silent and lavs-ai-chat from iframe
  // ---------------------------------------------------------------------------

  const handleSilentAICall = useCallback(async (requestId: number, prompt: string) => {
    try {
      const sessionId = useAgentStore.getState().currentSessionId;
      const response = await authFetch(`${API_BASE}/agents/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: prompt,
          agentId: agent.id,
          sessionId: `silent-${agent.id}`,
          projectPath,
          permissionMode: 'bypassPermissions',
          outputFormat: 'default',
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let lastAssistantText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const parsed = JSON.parse(line.slice(6));

            // Each 'assistant' event contains the full message for that turn.
            // Use only the last one (multi-turn agents may have several).
            if (parsed.type === 'assistant' && parsed.message?.content) {
              let text = '';
              for (const block of parsed.message.content) {
                if (block.type === 'text') text += block.text;
              }
              if (text) lastAssistantText = text;
            }
          } catch { /* skip non-JSON lines */ }
        }
      }

      const assistantText = lastAssistantText;

      iframeRef.current?.contentWindow?.postMessage({
        type: 'lavs-ai-result',
        id: requestId,
        result: assistantText,
      }, '*');
    } catch (err: any) {
      console.error('[LAVS AI Bridge] Silent call failed:', err);
      iframeRef.current?.contentWindow?.postMessage({
        type: 'lavs-ai-result',
        id: requestId,
        error: err.message || String(err),
      }, '*');
    }
  }, [agent.id, projectPath]);

  useEffect(() => {
    if (!componentLoaded || !iframeRef.current) return;

    const handleAIBridge = (event: MessageEvent) => {
      if (event.data.type === 'lavs-ai-silent') {
        console.log('[LAVS AI Bridge] Silent call:', event.data.prompt?.substring(0, 80));
        handleSilentAICall(event.data.id, event.data.prompt);
      }

      if (event.data.type === 'lavs-ai-chat') {
        console.log('[LAVS AI Bridge] Chat message:', event.data.message?.substring(0, 80));
        eventBus.emit(EVENTS.LAVS_SEND_CHAT_MESSAGE, event.data.message);
      }
    };

    window.addEventListener('message', handleAIBridge);
    return () => window.removeEventListener('message', handleAIBridge);
  }, [componentLoaded, handleSilentAICall]);

  // Forward chat completion back to iframe
  useEffect(() => {
    if (!componentLoaded || !iframeRef.current) return;

    const handleChatDone = () => {
      const messages = useAgentStore.getState().messages;
      const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');

      console.log('[LAVS AI Bridge] Chat done, lastAssistant parts:', lastAssistant?.parts?.length,
        'types:', lastAssistant?.parts?.map((p: any) => p.type));

      // Collect text from all text parts
      let text = '';
      if (lastAssistant?.parts) {
        for (const p of lastAssistant.parts as any[]) {
          if (p.type === 'text' && p.content) text += p.content;
          if (p.type === 'tool' && p.toolResult) {
            // Tool results may contain the check output
            const result = typeof p.toolResult === 'string' ? p.toolResult : JSON.stringify(p.toolResult);
            text += result;
          }
        }
      }

      console.log('[LAVS AI Bridge] Extracted text (first 200):', text.substring(0, 200));

      iframeRef.current?.contentWindow?.postMessage({
        type: 'lavs-ai-chat-done',
        message: text,
      }, '*');
    };

    eventBus.on(EVENTS.AI_RESPONSE_COMPLETE, handleChatDone);
    return () => eventBus.off(EVENTS.AI_RESPONSE_COMPLETE, handleChatDone);
  }, [componentLoaded]);

  /**
   * Load local component as iframe
   */
  const loadLocalComponent = async (_path: string) => {
    console.log('[LAVS] loadLocalComponent called', { path: _path, hasContainer: !!containerRef.current, projectPath });
    if (!containerRef.current) return;

    // Use the resolved backend host so the iframe works in Tauri prod mode
    // where window.location.origin (tauri://localhost) differs from the API host.
    let componentURL = `${getCurrentHost()}/api/agents/${agent.id}/lavs-view`;
    if (projectPath) {
      componentURL += `?projectPath=${encodeURIComponent(projectPath)}`;
    }
    console.log('[LAVS] Loading iframe from:', componentURL);

    // Create iframe
    const iframe = document.createElement('iframe');
    iframe.src = componentURL;
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.setAttribute('data-lavs-component', 'true');

    // Register the postMessage bridge BEFORE appending the iframe to the DOM.
    // This prevents a race condition: the iframe's module script runs before the
    // load event fires, so it may call window.parent.postMessage('lavs-call')
    // while the parent has not yet set up its listener. Moving the listener here
    // ensures no messages are lost.
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'lavs-call') {
        if (!lavsClientRef.current) return;
        lavsClientRef.current.call(event.data.endpoint, event.data.input)
          .then(result => {
            iframe.contentWindow?.postMessage({
              type: 'lavs-result',
              id: event.data.id,
              result,
            }, '*');
          })
          .catch(error => {
            iframe.contentWindow?.postMessage({
              type: 'lavs-error',
              id: event.data.id,
              error: error.message,
            }, '*');
          });
      }
    };
    window.addEventListener('message', handleMessage);
    messageHandlerCleanupRef.current = () => window.removeEventListener('message', handleMessage);

    console.log('[LAVS] Iframe created, appending to DOM');

    const loadPromise = new Promise<void>((resolve, reject) => {
      iframe.onload = () => {
        console.log('[LAVS] Iframe loaded successfully');
        resolve();
      };
      iframe.onerror = (err) => {
        console.error('[LAVS] Iframe failed to load', err);
        window.removeEventListener('message', handleMessage);
        reject(err);
      };
    });

    // Add iframe to DOM (this triggers loading)
    containerRef.current.appendChild(iframe);
    console.log('[LAVS] Iframe appended to DOM, waiting for load...');

    // Save iframe reference for later communication
    iframeRef.current = iframe;

    // Wait for iframe to load
    try {
      await loadPromise;
    } catch (err) {
      // handleMessage already removed on onerror; re-throw to caller
      throw err;
    }
  };

  /**
   * Load component from CDN
   */
  const loadCDNComponent = async (url: string, _exportName?: string) => {
    // Load script from CDN
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.type = 'module';
      script.onload = () => resolve();
      script.onerror = reject;
      document.head.appendChild(script);
    });

    // Component should auto-register as custom element
    // Wait a bit for registration
    await new Promise(resolve => setTimeout(resolve, 100));
  };

  /**
   * Load inline component
   */
  const loadInlineComponent = (code: string) => {
    // Create script element with inline code
    const script = document.createElement('script');
    script.type = 'module';
    script.textContent = code;
    document.head.appendChild(script);
  };

  // Render loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <div className="text-gray-600 dark:text-gray-400">Loading LAVS view...</div>
        </div>
      </div>
    );
  }

  // Render error state
  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-md text-center">
          <div className="text-red-500 text-6xl mb-4">⚠️</div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Failed to Load View
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {error}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // No manifest (agent doesn't have LAVS)
  if (!manifest) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-md text-center">
          <div className="text-gray-400 text-6xl mb-4">📄</div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            No LAVS View
          </h3>
          <p className="text-gray-600 dark:text-gray-400">
            This agent doesn't have a custom visualization interface.
          </p>
        </div>
      </div>
    );
  }

  // Render container for component
  return (
    <div
      ref={containerRef}
      className="h-full w-full bg-white dark:bg-gray-900"
      data-lavs-container
    />
  );
};
