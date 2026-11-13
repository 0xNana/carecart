import { Suspense,type ReactNode } from 'react';
import {headers} from 'next/headers';
import {siteOrigins} from '@/lib/application-routing';
import {connection} from 'next/server';
import { ApplicationShell } from '@/components/application-shell';
import {AuthEntry} from '@/components/auth-entry';
import {requireApplicationAccess} from '@/lib/application-access';
import '../operations/workspace.css';
import '@/components/clinic-workspace.css';

export const instant = false;

export default function ApplicationLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<main role="status" aria-busy="true">Loading clinic workspace…</main>}>
    <RequestApplicationLayout>{children}</RequestApplicationLayout>
  </Suspense>;
}

async function RequestApplicationLayout({children}:{children:ReactNode}){
  await connection();
  const access=await requireApplicationAccess();
  const origins=siteOrigins(),host=(await headers()).get('host');
  const cleanPaths=!!origins&&host===new URL(origins.app).host;
  if(!access)return <AuthEntry mode="login" next="/app"/>;
  return <ApplicationShell key={access.tenant?.clinic.id} cleanPaths={cleanPaths} siteOrigin={origins?.site} {...access}>{children}</ApplicationShell>;
}
