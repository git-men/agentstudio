/**
 * Git Version Management Hooks
 * 
 * React Query hooks for interacting with the Git version management API.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authFetch } from '../lib/authFetch';
import { API_BASE } from '../lib/config';

// ========================================
// Types
// ========================================

export interface VersionInfo {
  tag: string;
  message: string;
  date: string;
  hash: string;
  isCurrent: boolean;
}

export interface VersionStatus {
  initialized: boolean;
  currentVersion: string | null;
  isDirty: boolean;
  untrackedFiles: number;
  modifiedFiles: number;
  totalVersions: number;
}

export interface CreateVersionResult {
  success: boolean;
  version: {
    tag: string;
    hash: string;
    message: string;
  };
}

export interface CheckoutResult {
  success: boolean;
  message: string;
  tag: string;
}

// ========================================
// API Functions
// ========================================

const fetchVersions = async (projectId: string): Promise<VersionInfo[]> => {
  const response = await authFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/versions`
  );

  if (!response.ok) {
    throw new Error('Failed to fetch versions');
  }

  const data = await response.json();
  return data.versions || [];
};

const fetchVersionStatus = async (projectId: string): Promise<VersionStatus> => {
  const response = await authFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/versions/status`
  );

  if (!response.ok) {
    throw new Error('Failed to fetch version status');
  }

  return response.json();
};

const createVersionApi = async (
  projectId: string,
  message: string
): Promise<CreateVersionResult> => {
  const response = await authFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/versions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    }
  );

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to create version');
  }

  return response.json();
};

const checkoutVersionApi = async (
  projectId: string,
  tag: string,
  force: boolean = false
): Promise<CheckoutResult> => {
  const response = await authFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/versions/checkout`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag, force }),
    }
  );

  if (!response.ok) {
    const errorData = await response.json();
    if (errorData.code === 'DIRTY_WORKING_TREE') {
      const error = new Error(errorData.message || 'Working tree has uncommitted changes') as Error & { code: string };
      error.code = 'DIRTY_WORKING_TREE';
      throw error;
    }
    throw new Error(errorData.error || 'Failed to checkout version');
  }

  return response.json();
};

const deleteVersionApi = async (
  projectId: string,
  tag: string
): Promise<{ success: boolean; message: string }> => {
  const response = await authFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(tag)}`,
    {
      method: 'DELETE',
    }
  );

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to delete version');
  }

  return response.json();
};

// ========================================
// Hooks
// ========================================

/**
 * Hook to fetch version list for a project
 */
export const useVersions = (projectId: string) => {
  return useQuery({
    queryKey: ['versions', projectId],
    queryFn: () => fetchVersions(projectId),
    enabled: !!projectId,
    staleTime: 30 * 1000, // 30 seconds
    retry: 1,
  });
};

/**
 * Hook to fetch version status for a project
 */
export const useVersionStatus = (projectId: string) => {
  return useQuery({
    queryKey: ['versionStatus', projectId],
    queryFn: () => fetchVersionStatus(projectId),
    enabled: !!projectId,
    staleTime: 10 * 1000, // 10 seconds - status changes more frequently
    retry: 1,
  });
};

/**
 * Hook to create a new version
 */
export const useCreateVersion = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, message }: { projectId: string; message: string }) =>
      createVersionApi(projectId, message),
    onSuccess: (_, variables) => {
      // Invalidate both versions list and status
      queryClient.invalidateQueries({ queryKey: ['versions', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['versionStatus', variables.projectId] });
    },
  });
};

/**
 * Hook to checkout (switch to) a version
 */
export const useCheckoutVersion = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      tag,
      force = false,
    }: {
      projectId: string;
      tag: string;
      force?: boolean;
    }) => checkoutVersionApi(projectId, tag, force),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['versions', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['versionStatus', variables.projectId] });
    },
  });
};

/**
 * Hook to delete a version
 */
export const useDeleteVersion = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, tag }: { projectId: string; tag: string }) =>
      deleteVersionApi(projectId, tag),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['versions', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['versionStatus', variables.projectId] });
    },
  });
};
