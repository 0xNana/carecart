import {expect,it} from 'vitest';
import {operationsCookie} from './combined-sandbox';

const ops='carecart_ops='+'a'.repeat(64);
const app='carecart_app='+'a'.repeat(64);

it('retains the operations-scoped cookie across session responses that refresh only the app cookie',()=>{
 const login=new Headers();login.append('Set-Cookie',ops+'; HttpOnly; Path=/api/operations; SameSite=Strict');
 login.append('Set-Cookie',app+'; HttpOnly; Path=/app; SameSite=Strict');
 const cookie=operationsCookie(login);expect(cookie).toBe(ops);
 const session=new Headers({'Set-Cookie':app+'; HttpOnly; Path=/app; SameSite=Strict'});
 expect(operationsCookie(session,cookie)).toBe(ops);
});

it('handles cookie header ordering, operations rotation and logout without forwarding the app-scoped cookie',()=>{
 const headers=new Headers();headers.append('Set-Cookie',app+'; Path=/app');headers.append('Set-Cookie',ops+'; Path=/api/operations');
 expect(operationsCookie(headers)).toBe(ops);
 const rotated='carecart_ops='+'b'.repeat(64);
 expect(operationsCookie(new Headers({'Set-Cookie':rotated+'; Path=/api/operations'}),ops)).toBe(rotated);
 expect(operationsCookie(new Headers({'Set-Cookie':'carecart_ops=; Path=/api/operations; Max-Age=0'}),ops)).toBe('carecart_ops=');
});
