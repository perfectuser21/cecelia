import {it,expect,vi} from 'vitest';
const refs=vi.hoisted(()=>({creator:null,createTask:vi.fn(async()=>({success:true}))}));
vi.mock('../../actions.js',()=>({createTask:refs.createTask}));
vi.mock('../../linux-pool/onboarding-flow.js',()=>({createLinuxOnboardingFlow:({createTask})=>{refs.creator=createTask;return {};}}));
import {createOnboardingService} from '../service.js';
import {LINUX_POOL_AUTHORITY} from '../../linux-pool/task-authority.js';
it('正式接入服务默认creator透传私有Symbol，enroll不丢失专用controller权限',async()=>{
 createOnboardingService({pool:{}});
 const args={task_type:'audit'},internal={linuxPoolAuthority:LINUX_POOL_AUTHORITY};
 await refs.creator(args,internal);expect(refs.createTask).toHaveBeenCalledWith(args,internal);
});
