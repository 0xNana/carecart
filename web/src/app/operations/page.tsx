import { OperationsHub } from '../../components/live-operations';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseMode } from '@/lib/auth-config';
import './workspace.css';
export const instant = false;
export default async function OperationsPage() {
  await cookies();
  if (supabaseMode()) redirect('/app');
  return <OperationsHub/>;
}
