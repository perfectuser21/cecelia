import { it, expect, vi } from 'vitest';
import { phoneMetadataOnly, readPhonePatchAuthority, checkPhonePatchWrite } from '../task-phone-patch.js';
it('only supported human metadata is classified as phone metadata, mixed execution stays fenced',()=>{
 expect(phoneMetadataOnly({title:'x',description:'y',priority:'P1'})).toBe(true);
 for(const body of [{},{title:'x',status:'queued'},{result:{}},{title:'x',payload:{}},{description:'x',executor_kind:'phone-ssh-controller'}])expect(phoneMetadataOnly(body)).toBe(false);
});
it.each([true,false,null,undefined])('actual request-pool authority %s is explicit and unknown fails closed',async value=>{
 const pool={query:vi.fn().mockResolvedValue({rows:[{id:'task',ordinary_eligible:value}]})};
 if(typeof value==='boolean')expect(await readPhonePatchAuthority(pool,'task')).toBe(value?'ordinary':'phone');
 else await expect(readPhonePatchAuthority(pool,'task')).rejects.toThrow('authority_unknown');
 expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM tasks WHERE id = $1'),['task']);
 expect(pool.query.mock.calls[0][0]).toContain('phone_task_owners');
});
it.each(['missing','phone','ordinary'])('zero-write adapter re-reads %s authority before reporting outcome',async value=>{
 const pool={query:vi.fn().mockResolvedValue({rows:value==='missing'?[]:[{ordinary_eligible:value==='ordinary'}]})};
 const res={status:vi.fn().mockReturnThis(),json:vi.fn().mockReturnThis()};
 expect(await checkPhonePatchWrite(pool,{rowCount:0,rows:[]},res,'task')).toBe(false);
 expect(res.status).toHaveBeenCalledWith(value==='missing'?404:409);
 expect(res.json).toHaveBeenCalledWith(expect.objectContaining({error:value==='missing'?'Task not found':value==='phone'?'phone_task_owned':'task_patch_conflict'}));
});
it('inconsistent native driver counts cannot report success or run a reconciliation read',async()=>{
 const pool={query:vi.fn()},res={};
 for(const r of [{rowCount:0,rows:[{}]},{rowCount:1,rows:[]},{rowCount:2,rows:[{},{}]}])await expect(checkPhonePatchWrite(pool,r,res,'task')).rejects.toThrow('mutation_count_unknown');
 expect(pool.query).not.toHaveBeenCalled();expect(await checkPhonePatchWrite(pool,{rowCount:1,rows:[{}]},res,'task')).toBe(true);
});
