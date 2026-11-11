import type { ReactNode } from 'react';
import { ApplicationShell } from '@/components/application-shell';
import {AuthEntry} from '@/components/auth-entry';
import {requireApplicationAccess} from '@/lib/application-access';
import '../operations/workspace.css';

export const instant = false;

export default async function ApplicationLayout({ children }: { children: ReactNode }) {
  const access=await requireApplicationAccess();
  if(!access)return <AuthEntry mode="login" next="/app"/>;
  return <ApplicationShell key={access.tenant?.clinic.id} {...access}>{children}</ApplicationShell>;
}
