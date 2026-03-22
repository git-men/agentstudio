/**
 * Hook for enterprise authentication state.
 * Polls /api/enterprise/profile to track login status.
 */

import { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../lib/authFetch';
import { API_BASE } from '../lib/config';

export interface EnterpriseProfile {
  authenticated: boolean;
  userId?: string | number;
  name?: string;
  email?: string;
  avatarUrl?: string;
  enterpriseUrl?: string;
  loginAt?: string;
}

export function useEnterpriseProfile() {
  const [profile, setProfile] = useState<EnterpriseProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async () => {
    try {
      const resp = await authFetch(`${API_BASE}/enterprise/profile`);
      if (resp.ok) {
        const data = await resp.json();
        setProfile(data);
      }
    } catch {
      // ignore network errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
    const interval = setInterval(fetchProfile, 30000);
    return () => clearInterval(interval);
  }, [fetchProfile]);

  const startLogin = useCallback(async (enterpriseUrl?: string) => {
    try {
      const resp = await authFetch(`${API_BASE}/enterprise/auth/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enterprise_url: enterpriseUrl }),
      });
      const data = await resp.json();
      if (data.auth_url) {
        window.open(data.auth_url, '_blank');
        // Start polling for auth completion
        pollForAuth();
      }
      return data;
    } catch {
      return null;
    }
  }, []);

  const pollForAuth = useCallback(async () => {
    let attempts = 0;
    const maxAttempts = 60;
    const poll = async () => {
      if (attempts >= maxAttempts) return;
      attempts++;
      const resp = await authFetch(`${API_BASE}/enterprise/profile`).catch(() => null);
      if (resp?.ok) {
        const data = await resp.json();
        if (data.authenticated) {
          setProfile(data);
          return;
        }
      }
      setTimeout(poll, 2000);
    };
    setTimeout(poll, 2000);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authFetch(`${API_BASE}/enterprise/logout`, { method: 'POST' });
      setProfile({ authenticated: false });
    } catch {
      // ignore
    }
  }, []);

  return {
    profile,
    loading,
    isAuthenticated: profile?.authenticated ?? false,
    startLogin,
    logout,
    refresh: fetchProfile,
  };
}
