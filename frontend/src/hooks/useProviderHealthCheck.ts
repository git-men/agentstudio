import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../lib/config';
import { authFetch } from '../lib/authFetch';
import { useEngine } from './useEngine';
import { useClaudeVersions } from './useClaudeVersions';

const STORAGE_KEY = 'provider_health_checked';

export interface ProviderHealthStatus {
  checked: boolean;
  available: boolean;
  error?: string;
  message?: string;
  loading: boolean;
  dismissed: boolean;
}

async function testProvider(versionId: string): Promise<{
  available: boolean;
  error?: string;
  message?: string;
}> {
  const response = await authFetch(`${API_BASE}/settings/claude-versions/${versionId}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

export function useProviderHealthCheck() {
  const { isClaudeEngine, isLoading: engineLoading } = useEngine();
  const { data: versionsData, isLoading: versionsLoading } = useClaudeVersions();
  const [status, setStatus] = useState<ProviderHealthStatus>({
    checked: false,
    available: true,
    loading: false,
    dismissed: false,
  });

  const dismiss = useCallback(() => {
    setStatus(prev => ({ ...prev, dismissed: true }));
  }, []);

  const recheck = useCallback(async () => {
    if (!versionsData) return;

    if (versionsData.versions.length === 0) {
      setStatus({
        checked: true,
        available: false,
        error: 'no_provider',
        message: '尚未配置任何模型供应商，请前往供应商设置添加 API 密钥。',
        loading: false,
        dismissed: false,
      });
      return;
    }

    const defaultVersion = versionsData.versions.find(v => v.id === versionsData.defaultVersionId)
      ?? versionsData.versions.find(v => v.isSystem);
    if (!defaultVersion) {
      setStatus({
        checked: true,
        available: false,
        error: 'no_default_provider',
        message: '尚未设置默认模型供应商，请前往供应商设置进行配置。',
        loading: false,
        dismissed: false,
      });
      return;
    }

    setStatus(prev => ({ ...prev, loading: true }));
    try {
      const result = await testProvider(defaultVersion.id);
      const newStatus: ProviderHealthStatus = {
        checked: true,
        available: result.available,
        error: result.error,
        message: result.message,
        loading: false,
        dismissed: false,
      };
      setStatus(newStatus);

      if (result.available) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          timestamp: Date.now(),
          available: true,
        }));
      }
    } catch (err) {
      setStatus(prev => ({
        ...prev,
        loading: false,
        checked: true,
        available: false,
        error: 'network_error',
        message: err instanceof Error ? err.message : '检查失败',
      }));
    }
  }, [versionsData]);

  useEffect(() => {
    if (engineLoading || versionsLoading) return;
    if (!isClaudeEngine) return;

    if (!versionsData) return;

    // No providers configured at all → show banner immediately, bypass cache
    if (versionsData.versions.length === 0) {
      setStatus({
        checked: true,
        available: false,
        error: 'no_provider',
        message: '尚未配置任何模型供应商，请前往供应商设置添加 API 密钥。',
        loading: false,
        dismissed: false,
      });
      return;
    }

    // Has providers — check the cache before making API call
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      try {
        const data = JSON.parse(cached);
        if (data.available) {
          setStatus({
            checked: true,
            available: true,
            loading: false,
            dismissed: false,
          });
          return;
        }
      } catch {
        // ignore parse errors
      }
    }

    const defaultVersion = versionsData.versions.find(v => v.id === versionsData.defaultVersionId)
      ?? versionsData.versions.find(v => v.isSystem);
    if (!defaultVersion) {
      // Has versions but none set as default/system — still guide user to configure
      setStatus({
        checked: true,
        available: false,
        error: 'no_default_provider',
        message: '尚未设置默认模型供应商，请前往供应商设置进行配置。',
        loading: false,
        dismissed: false,
      });
      return;
    }

    let cancelled = false;

    setStatus(prev => ({ ...prev, loading: true }));
    testProvider(defaultVersion.id)
      .then(result => {
        if (cancelled) return;
        setStatus({
          checked: true,
          available: result.available,
          error: result.error,
          message: result.message,
          loading: false,
          dismissed: false,
        });

        if (result.available) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({
            timestamp: Date.now(),
            available: true,
          }));
        }
      })
      .catch(err => {
        if (cancelled) return;
        setStatus({
          checked: true,
          available: false,
          error: 'network_error',
          message: err instanceof Error ? err.message : '检查失败',
          loading: false,
          dismissed: false,
        });
      });

    return () => { cancelled = true; };
  }, [isClaudeEngine, engineLoading, versionsLoading, versionsData]);

  const shouldShowBanner = status.checked && !status.available && !status.dismissed;

  return {
    ...status,
    shouldShowBanner,
    dismiss,
    recheck,
  };
}
