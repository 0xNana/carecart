import { Suspense,type ReactNode } from 'react';
import {connection} from 'next/server';
import { ApplicationShell } from '@/components/application-shell';
import {AuthEntry} from '@/components/auth-entry';
import {requireApplicationAccess} from '@/lib/application-access';
import '../operations/workspace.css';

export const instant = false;

export default function ApplicationLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<main role="status" aria-busy="true">Loading clinic workspace…</main>}>
    <RequestApplicationLayout>{children}</RequestApplicationLayout>
  </Suspense>;
}

async function RequestApplicationLayout({children}:{children:ReactNode}){
  await connection();
  const access=await requireApplicationAccess();
  if(!access)return <AuthEntry mode="login" next="/app"/>;
  return <ApplicationShell key={access.tenant?.clinic.id} {...access}>{children}</ApplicationShell>;
}
