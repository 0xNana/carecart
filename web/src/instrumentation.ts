import {assertNoSigningCredentials} from './lib/auth-config';

/** Stop the web server before it can handle requests with wallet credentials in its environment. */
export function register(){
 assertNoSigningCredentials(process.env);
}
