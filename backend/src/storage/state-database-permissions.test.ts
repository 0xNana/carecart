import * as fs from 'node:fs';
import {afterEach,expect,it,vi} from 'vitest';
import {secureStateDatabase} from './state-database-permissions';

vi.mock('node:fs',async original=>{
 const actual=await original<typeof import('node:fs')>();
 return {...actual,readFileSync:vi.fn(actual.readFileSync),statSync:vi.fn(actual.statSync),chmodSync:vi.fn(actual.chmodSync)};
});
afterEach(()=>{vi.restoreAllMocks();vi.clearAllMocks();vi.unstubAllEnvs();});

function fixture(uid=1000,gid=1000,mode=0o640){
 vi.stubEnv('CARECART_SHARED_STATE_GROUP','carecart-payments');
 vi.mocked(fs.readFileSync).mockReturnValue('ubuntu:x:1000:\ncarecart-payments:x:2000:ubuntu\n');
 vi.mocked(fs.statSync).mockReturnValue({uid,gid,mode} as ReturnType<typeof fs.statSync>);
 vi.spyOn(process,'getuid').mockReturnValue(1000);
 vi.spyOn(process,'getgid').mockReturnValue(1000);
 vi.spyOn(process,'getgroups').mockReturnValue([1000,2000]);
 return vi.mocked(fs.chmodSync).mockImplementation(()=>undefined);
}

it('new clinic databases remain owner-only when payment sharing is configured for other files',()=>{
 const chmod=fixture();
 expect(()=>secureStateDatabase('/clinic/state.sqlite')).not.toThrow();
 expect(chmod).toHaveBeenCalledWith('/clinic/state.sqlite',0o600);
});

it('only databases explicitly assigned to the payment group receive group access',()=>{
 const chmod=fixture(1000,2000,0o600);
 secureStateDatabase('/approved/state.sqlite');
 expect(chmod).toHaveBeenCalledWith('/approved/state.sqlite',0o660);
});

it('isolated payment users can open an already secured shared database without trying to chmod its owner files',()=>{
 const chmod=fixture(3000,2000,0o660);
 expect(()=>secureStateDatabase('/approved/state.sqlite')).not.toThrow();
 expect(chmod).not.toHaveBeenCalled();
});

it('an unrelated owner or missing group membership cannot gain shared access',()=>{
 const chmod=fixture(3000,3000);
 expect(()=>secureStateDatabase('/unrelated/state.sqlite')).toThrow('group ownership mismatch');
 expect(chmod).not.toHaveBeenCalled();
 if(!process.getgroups)throw new Error('POSIX group support required');
 vi.mocked(process.getgroups).mockReturnValue([1000]);
 expect(()=>secureStateDatabase('/unrelated/state.sqlite')).toThrow('not a member');
 expect(chmod).not.toHaveBeenCalled();
});

it('unconfigured databases stay private and unsupported group names are rejected',()=>{
 const chmod=fixture();vi.stubEnv('CARECART_SHARED_STATE_GROUP','');
 secureStateDatabase('/private/state.sqlite');
 expect(chmod).toHaveBeenCalledWith('/private/state.sqlite',0o600);
 chmod.mockClear();vi.stubEnv('CARECART_SHARED_STATE_GROUP','arbitrary-group');
 expect(()=>secureStateDatabase('/private/state.sqlite')).toThrow('Unsupported shared state');
 expect(chmod).not.toHaveBeenCalled();
});
