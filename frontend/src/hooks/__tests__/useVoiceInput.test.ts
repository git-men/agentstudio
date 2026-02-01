/**
 * Unit tests for useVoiceInput hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useVoiceInput } from '../useVoiceInput';

// Mock authFetch
vi.mock('../../lib/authFetch', () => ({
  authFetch: vi.fn(),
}));

// Mock MediaRecorder
const mockMediaRecorder = {
  start: vi.fn(),
  stop: vi.fn(),
  state: 'inactive' as RecordingState,
  ondataavailable: null as ((event: BlobEvent) => void) | null,
  onstop: null as (() => void) | null,
  mimeType: 'audio/webm;codecs=opus',
};

const mockMediaStream = {
  getTracks: () => [
    {
      stop: vi.fn(),
    },
  ],
};

// Setup global mocks
beforeEach(() => {
  vi.clearAllMocks();

  // Mock MediaRecorder
  global.MediaRecorder = vi.fn().mockImplementation(() => mockMediaRecorder) as any;
  (global.MediaRecorder as any).isTypeSupported = vi.fn().mockReturnValue(true);

  // Mock navigator.mediaDevices
  Object.defineProperty(global.navigator, 'mediaDevices', {
    value: {
      getUserMedia: vi.fn().mockResolvedValue(mockMediaStream),
    },
    writable: true,
  });
});

describe('useVoiceInput', () => {
  describe('initial state', () => {
    it('should have idle status initially', async () => {
      const { authFetch } = await import('../../lib/authFetch');
      vi.mocked(authFetch).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            enabled: true,
            availableProviders: ['openai'],
            defaultProvider: 'openai',
          }),
      } as Response);

      const { result } = renderHook(() => useVoiceInput());

      expect(result.current.status).toBe('idle');
      expect(result.current.isRecording).toBe(false);
      expect(result.current.isProcessing).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should load service status on mount', async () => {
      const { authFetch } = await import('../../lib/authFetch');
      vi.mocked(authFetch).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            enabled: true,
            availableProviders: ['openai', 'groq'],
            defaultProvider: 'openai',
          }),
      } as Response);

      const { result } = renderHook(() => useVoiceInput());

      await waitFor(() => {
        expect(result.current.serviceStatus).not.toBeNull();
      });

      expect(result.current.serviceStatus?.enabled).toBe(true);
      expect(result.current.serviceStatus?.availableProviders).toContain('openai');
    });
  });

  describe('startRecording', () => {
    it('should set error if service is not enabled', async () => {
      const { authFetch } = await import('../../lib/authFetch');
      vi.mocked(authFetch).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            enabled: false,
            availableProviders: [],
            defaultProvider: null,
          }),
      } as Response);

      const { result } = renderHook(() => useVoiceInput());

      await waitFor(() => {
        expect(result.current.isServiceLoading).toBe(false);
      });

      await act(async () => {
        await result.current.startRecording();
      });

      expect(result.current.status).toBe('error');
      expect(result.current.error).toContain('未启用');
    });

    it('should request microphone permission and start recording', async () => {
      const { authFetch } = await import('../../lib/authFetch');
      vi.mocked(authFetch).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            enabled: true,
            availableProviders: ['openai'],
            defaultProvider: 'openai',
          }),
      } as Response);

      const { result } = renderHook(() => useVoiceInput());

      await waitFor(() => {
        expect(result.current.serviceStatus?.enabled).toBe(true);
      });

      await act(async () => {
        await result.current.startRecording();
      });

      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
        audio: expect.objectContaining({
          echoCancellation: true,
          noiseSuppression: true,
        }),
      });
      expect(result.current.isRecording).toBe(true);
      expect(mockMediaRecorder.start).toHaveBeenCalled();
    });

    it('should handle permission denied error', async () => {
      const { authFetch } = await import('../../lib/authFetch');
      vi.mocked(authFetch).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            enabled: true,
            availableProviders: ['openai'],
            defaultProvider: 'openai',
          }),
      } as Response);

      // Mock permission denied
      vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(
        new DOMException('Permission denied', 'NotAllowedError')
      );

      const { result } = renderHook(() => useVoiceInput());

      await waitFor(() => {
        expect(result.current.serviceStatus?.enabled).toBe(true);
      });

      await act(async () => {
        await result.current.startRecording();
      });

      expect(result.current.status).toBe('error');
      expect(result.current.error).toContain('麦克风');
    });
  });

  describe('cancelRecording', () => {
    it('should cancel recording and reset state', async () => {
      const { authFetch } = await import('../../lib/authFetch');
      vi.mocked(authFetch).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            enabled: true,
            availableProviders: ['openai'],
            defaultProvider: 'openai',
          }),
      } as Response);

      const { result } = renderHook(() => useVoiceInput());

      await waitFor(() => {
        expect(result.current.serviceStatus?.enabled).toBe(true);
      });

      await act(async () => {
        await result.current.startRecording();
      });

      expect(result.current.isRecording).toBe(true);

      act(() => {
        result.current.cancelRecording();
      });

      expect(result.current.status).toBe('idle');
      expect(result.current.isRecording).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  describe('refreshServiceStatus', () => {
    it('should reload service status', async () => {
      const { authFetch } = await import('../../lib/authFetch');
      let callCount = 0;

      vi.mocked(authFetch).mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              enabled: callCount === 1 ? false : true,
              availableProviders: callCount === 1 ? [] : ['openai'],
              defaultProvider: callCount === 1 ? null : 'openai',
            }),
        } as Response);
      });

      const { result } = renderHook(() => useVoiceInput());

      await waitFor(() => {
        expect(result.current.serviceStatus?.enabled).toBe(false);
      });

      await act(async () => {
        await result.current.refreshServiceStatus();
      });

      expect(result.current.serviceStatus?.enabled).toBe(true);
      expect(result.current.serviceStatus?.availableProviders).toContain('openai');
    });
  });
});
