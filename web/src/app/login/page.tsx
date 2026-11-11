import {AuthEntry} from '@/components/auth-entry';
export const instant=false;
export default async function Page({searchParams}:{searchParams:Promise<{next?:string;error?:string}>}){return <AuthEntry mode='login' next={(await searchParams).next} error={(await searchParams).error}/>;}
