import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchEventTypes,
  fetchHooks,
  fetchHook,
  createHook,
  updateHook,
  deleteHook,
  testHook,
  fetchExecutions,
  type PlatformHook,
  type HookListFilter,
  type HookCreateRequest,
  type HookUpdateRequest,
  type ExecutionHistoryFilter,
  type ListExecutionsResponse,
  type TestHookResponse,
  type EventTypeInfo,
} from '@/lib/platformHooksApi';

export type { PlatformHook, HookListFilter, HookCreateRequest, HookUpdateRequest, ExecutionHistoryFilter, ListExecutionsResponse, TestHookResponse, EventTypeInfo };

const HOOKS_KEY = ['platform-hooks'] as const;
const EVENTS_KEY = ['platform-hook-events'] as const;
const EXECUTIONS_KEY = ['platform-hook-executions'] as const;

export function useEventTypes() {
  return useQuery({
    queryKey: [...EVENTS_KEY],
    queryFn: fetchEventTypes,
    staleTime: Infinity,
  });
}

export function usePlatformHooks(filters?: HookListFilter) {
  return useQuery({
    queryKey: [...HOOKS_KEY, filters],
    queryFn: () => fetchHooks(filters),
  });
}

export function usePlatformHook(id: string) {
  return useQuery({
    queryKey: [...HOOKS_KEY, id],
    queryFn: () => fetchHook(id),
    enabled: !!id,
  });
}

export function useCreateHook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: HookCreateRequest) => createHook(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...HOOKS_KEY] });
    },
  });
}

export function useUpdateHook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: HookUpdateRequest }) => updateHook(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...HOOKS_KEY] });
    },
  });
}

export function useDeleteHook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteHook(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...HOOKS_KEY] });
    },
  });
}

export function useToggleHook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateHook(id, { enabled }),
    onMutate: async ({ id, enabled }) => {
      await queryClient.cancelQueries({ queryKey: [...HOOKS_KEY] });

      const previousQueries = queryClient.getQueriesData<PlatformHook[]>({ queryKey: [...HOOKS_KEY] });

      queryClient.setQueriesData<PlatformHook[]>(
        { queryKey: [...HOOKS_KEY] },
        (old) => old?.map(h => h.id === id ? { ...h, enabled } : h)
      );

      return { previousQueries };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousQueries) {
        for (const [key, data] of context.previousQueries) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [...HOOKS_KEY] });
    },
  });
}

export function useTestHook() {
  return useMutation({
    mutationFn: (id: string) => testHook(id),
  });
}

export function useExecutionHistory(
  filters?: ExecutionHistoryFilter,
  pagination?: { limit: number; offset: number }
) {
  return useQuery({
    queryKey: [...EXECUTIONS_KEY, filters, pagination],
    queryFn: () => fetchExecutions(filters, pagination),
    refetchInterval: 10000,
  });
}
