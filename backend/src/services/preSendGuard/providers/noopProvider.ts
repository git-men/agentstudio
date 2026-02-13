import type { PreSendGuardProvider } from '../../../types/preSendGuard.js';

export const noopProvider: PreSendGuardProvider = {
  name: 'noop',
  async evaluate() {
    return {
      decision: 'allow',
      reason: 'No-op provider'
    };
  }
};
