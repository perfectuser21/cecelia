import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import EvidenceView from './EvidenceView';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('运行列表显示每次执行自己的固定版本，升级当前流程不能替旧run换版',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({runs:[
    {id:'one',run_id:'native:old',workflow_id:'wf',workflow_definition_version_id:'immutable-old-version',definition_status:'native_fixed',record_source:'runs'},
    {id:'two',run_id:'native:new',workflow_id:'wf',workflow_definition_version_id:'immutable-new-version',definition_status:'native_fixed',record_source:'runs'},
  ],total:2,limit:20,offset:0}))));
  render(<EvidenceView mode="运行" workflow="wf" workflows={[{id:'wf',name:'持续对账'}]} />);
  expect(await screen.findByText('immutable-old-version')).toBeInTheDocument();
  expect(screen.getByText('immutable-new-version')).toBeInTheDocument();
});
