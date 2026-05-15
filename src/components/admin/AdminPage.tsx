// Admin shell. Sub-nav lives here so adding a new admin surface is just
// one entry in ADMIN_SUBS + one branch in the renderer.

import React from 'react';
import { Database } from 'lucide-react';
import DataManagementPage from './DataManagementPage';

export type AdminSub = 'data';

export const ADMIN_SUBS: { id: AdminSub; label: string; icon: React.ReactNode }[] = [
  { id: 'data', label: 'Data Management', icon: <Database size={14} /> },
];

interface Props {
  sub: AdminSub;
}

export default function AdminPage({ sub }: Props) {
  switch (sub) {
    case 'data':
    default:
      return <DataManagementPage />;
  }
}
