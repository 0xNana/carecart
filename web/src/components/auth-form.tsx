'use client';
import Link from 'next/link';import {useActionState,useEffect,useRef} from 'react';import {authAction} from '@/app/auth/actions';import styles from './identity.module.css';
export function AuthForm({mode,next,notice=''}:{mode:'login'|'signup'|'forgot-password'|'reset-password';next:string;notice?:string}){
 const [state,action,pending]=useActionState(authAction,{message:'',error:false});const status=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{if(state.message)status.current?.focus();},[state]);
 const title={login:'Sign in to CareCart',signup:'Create your account','forgot-password':'Recover your password','reset-password':'Set a new password'}[mode];
 return <main className={styles.page}><section className={styles.panel}><Link href="/">CareCart</Link><h1>{title}</h1><p>{mode==='login'?'Access your clinic’s stock and purchasing records.':mode==='signup'?'Create an account, verify your email, then set up your clinic.':mode==='forgot-password'?'We’ll send a link to reset your password.':'Choose a password with at least 12 characters.'}</p>
 {notice&&<p role="alert">{notice}</p>}<form action={action}><input type="hidden" name="mode" value={mode}/><input type="hidden" name="next" value={next}/>
 {mode!=='reset-password'&&<label>Email address<input type="email" name="email" autoComplete="email" maxLength={254} required disabled={pending}/></label>}
 {mode!=='forgot-password'&&<label>{mode==='reset-password'?'New password':'Password'}<input type="password" name="password" autoComplete={mode==='login'?'current-password':'new-password'} minLength={mode==='login'?1:12} maxLength={128} required disabled={pending}/></label>}
 {['signup','reset-password'].includes(mode)&&<label>Confirm password<input type="password" name="confirmation" autoComplete="new-password" minLength={12} maxLength={128} required disabled={pending}/></label>}
 {mode==='signup'&&<p>Use at least 12 characters.</p>}
 <button disabled={pending}>{pending?'Please wait…':mode==='login'?'Sign in':mode==='signup'?'Create account':mode==='forgot-password'?'Send recovery email':'Update password'}</button>
 <p ref={status} tabIndex={-1} role={state.error?'alert':'status'}>{state.message}</p></form>
 <nav aria-label="Account navigation">{mode!=='login'&&<Link href={'/login?next='+encodeURIComponent(next)}>Sign in</Link>}{mode==='login'&&<Link href={'/signup?next='+encodeURIComponent(next)}>Create account</Link>}{mode==='login'&&<Link href="/forgot-password">Forgot password?</Link>}</nav>
 </section></main>;
}
