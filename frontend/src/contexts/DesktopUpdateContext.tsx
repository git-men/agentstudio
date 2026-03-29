import React, { createContext, useContext } from 'react';

type CheckStatus = 'idle' | 'checking' | 'up_to_date' | 'error';

interface DesktopUpdateContextValue {
  checkForUpdate: () => Promise<void>;
  checkStatus: CheckStatus;
  checkError: string | null;
}

const DesktopUpdateContext = createContext<DesktopUpdateContextValue | null>(null);

export const DesktopUpdateProvider = DesktopUpdateContext.Provider;

/**
 * Access the Tauri-native update checker from anywhere in the component tree.
 * Returns null in non-Tauri (web) mode.
 */
export function useDesktopUpdate(): DesktopUpdateContextValue | null {
  return useContext(DesktopUpdateContext);
}
