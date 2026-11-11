import { afterEach, expect, it } from 'vitest';
import { mkdtempSync,rmSync,mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../profiles/storage';
import { openLocalOperations } from './local';
import { OperatorAuth } from './auth';
const clean:(()=>void)[]=[];
afterEach(()=>{for(const close of clean.splice(0).reverse())close();});
function fixture(){const name=`auth-${Date.now()}-${Math.random().toString(16).slice(2)}`;const local=openLocalOperations(name);const auth=new OperatorAuth(local.store,'http://localhost:3000','operator-'.repeat(5),'viewer-'.repeat(6));
 clean.push(()=>rmSync(join(PROJECT_ROOT,'backend/data/local-v2/local-operations',name),{recursive:true,force:true}));clean.push(()=>local.close());clean.push(()=>auth.close());return {auth,local};}
it('creates expiring opaque sessions with viewer/operator authorization and session-bound CSRF/nonces',()=>{
 const {auth}=fixture();expect(()=>auth.login('wrong')).toThrow();const login=auth.login('operator-'.repeat(5));
 const cookies=auth.cookie(login.token);expect(cookies).toHaveLength(2);expect(cookies[0]).toContain('carecart_ops=');
 expect(cookies[0]).toContain('Path=/api/operations');expect(cookies[1]).toContain('carecart_app=');expect(cookies[1]).toContain('Path=/app');
 const session=auth.session(login.token);expect(session.role).toBe('operator');const nonce=auth.issueNonce(session);
 expect(()=>auth.authorizeMutation(session,'http://evil.invalid',session.csrf,nonce)).toThrow();
 expect(()=>auth.authorizeMutation(session,'http://localhost:3000','wrong',nonce)).toThrow();
 expect(auth.authorizeMutation(session,'http://localhost:3000',session.csrf,nonce)).toBe(nonce);
 expect(auth.session(auth.login('viewer-'.repeat(6)).token).role).toBe('viewer');
});
it('binds session state to the profile and refuses unknown sessions',()=>{const {auth}=fixture();expect(()=>auth.session('fabricated')).toThrow();});
it('revokes sessions on credential rotation and expires sessions/nonces across reopen',()=>{
 const {auth,local}=fixture();const login=auth.login('operator-'.repeat(5));const old=auth.session(login.token);const nonce=auth.issueNonce(old);auth.close();
 const reopened=new OperatorAuth(local.store,'http://localhost:3000','operator-'.repeat(5),'viewer-'.repeat(6),()=>Date.now()+31*60_000);clean.push(()=>reopened.close());
 expect(()=>reopened.session(login.token)).toThrow(/AUTH_EXPIRED/);expect(()=>reopened.authorizeMutation(old,'http://localhost:3000',old.csrf,nonce)).toThrow();reopened.close();
 const rotated=new OperatorAuth(local.store,'http://localhost:3000','changed-operator-'.repeat(3));clean.push(()=>rotated.close());expect(()=>rotated.session(login.token)).toThrow();
});
