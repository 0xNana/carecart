import {AuthEntry} from '@/components/auth-entry';
export const instant=false;
export default async function Page({searchParams}:{searchParams:Promise<{next?:string}>}){return <AuthEntry mode='signup' next={(await searchParams).next}/>;}
