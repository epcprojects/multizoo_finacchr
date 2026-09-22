import type { ReactNode } from 'react';
import { UserProvider } from '../../components/layout/UserProvider';
import { DashboardShell } from '../../components/layout/DashboardShell';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <UserProvider>
      <DashboardShell>{children}</DashboardShell>
    </UserProvider>
  );
}
