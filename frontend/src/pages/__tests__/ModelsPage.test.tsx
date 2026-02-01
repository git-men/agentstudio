import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ModelsPage from '../ModelsPage';

// Mock fetch
global.fetch = async (url: string) => {
  if (url.includes('/api/agui/engines')) {
    return {
      ok: true,
      json: async () => ({
        engines: [
          {
            type: 'claude',
            isDefault: true,
            capabilities: {
              features: {
                multiTurn: true,
                thinking: true,
                vision: true,
                streaming: true,
                subagents: true,
                codeExecution: true,
              },
              mcp: { supported: true },
            },
            models: [
              { id: 'sonnet', name: 'Claude Sonnet', isVision: true },
              { id: 'opus', name: 'Claude Opus', isVision: true, isThinking: true },
            ],
            activeSessions: 2,
          },
          {
            type: 'cursor',
            isDefault: false,
            capabilities: {
              features: {
                multiTurn: true,
                thinking: true,
                vision: true,
                streaming: true,
                subagents: false,
                codeExecution: true,
              },
              mcp: { supported: false },
            },
            models: [
              { id: 'sonnet-4.5', name: 'Claude Sonnet 4.5', isVision: true },
              { id: 'gpt-5.2', name: 'GPT 5.2', isVision: true },
            ],
            activeSessions: 0,
          },
        ],
        defaultEngine: 'claude',
        totalActiveSessions: 2,
      }),
    } as Response;
  }
  throw new Error('Not found');
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    {children}
  </QueryClientProvider>
);

describe('ModelsPage', () => {
  it('renders page title', async () => {
    render(<ModelsPage />, { wrapper });
    
    await waitFor(() => {
      expect(screen.getByText('Available AI Models')).toBeInTheDocument();
    });
  });

  it('displays summary statistics', async () => {
    render(<ModelsPage />, { wrapper });
    
    await waitFor(() => {
      expect(screen.getByText('Total Engines')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText('Active Sessions')).toBeInTheDocument();
    });
  });

  it('displays engine information', async () => {
    render(<ModelsPage />, { wrapper });
    
    await waitFor(() => {
      expect(screen.getByText(/claude/i)).toBeInTheDocument();
      expect(screen.getByText(/cursor/i)).toBeInTheDocument();
    });
  });

  it('displays model information', async () => {
    render(<ModelsPage />, { wrapper });
    
    await waitFor(() => {
      expect(screen.getByText('Claude Sonnet')).toBeInTheDocument();
      expect(screen.getByText('Claude Opus')).toBeInTheDocument();
      expect(screen.getByText('GPT 5.2')).toBeInTheDocument();
    });
  });

  it('shows DEFAULT badge for default engine', async () => {
    render(<ModelsPage />, { wrapper });
    
    await waitFor(() => {
      expect(screen.getByText('DEFAULT')).toBeInTheDocument();
    });
  });

  it('displays capabilities tags', async () => {
    render(<ModelsPage />, { wrapper });
    
    await waitFor(() => {
      expect(screen.getByText('Multi-turn')).toBeInTheDocument();
      expect(screen.getByText('Thinking')).toBeInTheDocument();
      expect(screen.getByText('Vision')).toBeInTheDocument();
      expect(screen.getByText('Streaming')).toBeInTheDocument();
    });
  });
});
