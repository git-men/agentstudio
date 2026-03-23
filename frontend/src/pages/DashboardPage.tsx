import React from 'react';
import { NewDashboard } from './NewDashboard';

/**
 * Dashboard page — new dashboard with Agent grid + embedded Meta Agent panel.
 * Classic dashboard preserved as ClassicDashboard.tsx if rollback is needed.
 */
export const DashboardPage: React.FC = () => {
  return <NewDashboard />;
};
