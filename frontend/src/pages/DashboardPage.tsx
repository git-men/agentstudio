import React from 'react';
import { ClassicDashboard } from './ClassicDashboard';

/**
 * Dashboard page — always renders the classic dashboard layout.
 * Meta Agent is now available as a global floating widget via Layout.
 */
export const DashboardPage: React.FC = () => {
  return <ClassicDashboard />;
};
