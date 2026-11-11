import {redirect} from 'next/navigation';
import {requireApplicationAccess} from '@/lib/application-access';
export const instant=false;
export default async function RetiredPlayground(){
 const access=await requireApplicationAccess();
 if(!access)redirect('/login?next=%2Fapp');
 redirect('/app');
}
