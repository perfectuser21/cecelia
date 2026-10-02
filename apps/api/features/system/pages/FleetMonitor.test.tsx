import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import FleetMonitor from './FleetMonitor';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('Worker展示实测总内存与数据路径磁盘，不以压力推算已用量或补零负载',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({json:async()=>({servers:[{
  id:'us-mac-m4',name:'MMV',status:'online',role:'worker',location:'测试',
  cpu:{cores:10,model:null,loadAvg1:null,loadAvg5:null,loadAvg15:null,usagePercent:12},
  memory:{totalGB:16,usedGB:null,usagePercent:25},
  disk:{total:null,used:null,freeBytes:10*1024**3,usagePercent:95,scope:'execution_paths'},
  uptime:null,hostname:null,platform:null,
 }],summary:{total:1,online:1,offline:0},timestamp:Date.now()})}));
 render(<FleetMonitor/>);
 expect(await screen.findByText('总内存 16.0 GB')).toBeInTheDocument();
 expect(screen.getByText('内存压力')).toBeInTheDocument();
 expect(screen.getByText('执行数据路径最小可用 10.0 GiB')).toBeInTheDocument();
 expect(screen.getByText('执行数据路径最高占用')).toBeInTheDocument();
 expect(screen.queryByText(/load /)).toBeNull();
 expect(screen.queryByText(/4GB \/ 16GB/)).toBeNull();
});
