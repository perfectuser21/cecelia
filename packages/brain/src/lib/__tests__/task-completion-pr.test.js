import {describe,it,expect,vi} from 'vitest';
import {verifyTaskCompletionPr} from '../task-completion-pr.js';
const url='https://github.com/owned/repo/pull/1', mergedAt='2026-11-14T00:00:00Z';
describe('完成任务的PR事实核验',()=>{
  it.each(['OPEN','CLOSED',null])('首次result上报%s不能用merged自述完成',async state=>{
    const readPr=vi.fn().mockResolvedValue({url,state,mergedAt});
    await expect(verifyTaskCompletionPr({},{result:{pr_url:url,merged:true}},{readPr})).rejects.toMatchObject({code:'PR_NOT_MERGED'});
    expect(readPr).toHaveBeenCalledWith(url);
  });
  it('精确URL、MERGED状态、合并时间都存在才采信',async()=>{
    const readPr=vi.fn().mockResolvedValue({url,state:'MERGED',mergedAt});
    await expect(verifyTaskCompletionPr({},{result:{pr_url:url}},{readPr})).resolves.toEqual({url,mergedAt});
  });
  it.each([{url:'https://github.com/other/repo/pull/1',state:'MERGED',mergedAt},{url,state:'MERGED'},{url,state:'MERGED',mergedAt:'unknown'}])('身份/事实不完整%s保持未核验',async response=>{
    await expect(verifyTaskCompletionPr({},{pr_url:url},{readPr:async()=>response})).rejects.toMatchObject({code:'PR_MERGE_UNVERIFIED'});
  });
  it('读取失败不伪装成功',async()=>{
    await expect(verifyTaskCompletionPr({},{pr_url:url},{readPr:async()=>{throw Error('network')}})).rejects.toMatchObject({code:'PR_MERGE_UNVERIFIED'});
  });
  it('不把已有合并记录套到请求的另一条PR上',async()=>{
    const readPr=vi.fn();
    await expect(verifyTaskCompletionPr({pr_url:url,pr_merged_at:mergedAt},{pr_url:'https://github.com/owned/repo/pull/2'},{readPr})).rejects.toMatchObject({code:'PR_MERGE_UNVERIFIED'});
    expect(readPr).not.toHaveBeenCalled();
  });
  it('相同PR的数据库合并事实无需重新访问外部服务',async()=>{
    const readPr=vi.fn();
    await expect(verifyTaskCompletionPr({pr_url:url,pr_merged_at:mergedAt},{result:{pr_url:url}},{readPr})).resolves.toEqual({url,mergedAt});
    expect(readPr).not.toHaveBeenCalled();
  });
  it('无关联PR的通用任务保留完成路径，非法URL不进入命令',async()=>{
    const readPr=vi.fn();
    await expect(verifyTaskCompletionPr({},{},{readPr})).resolves.toBeNull();
    await expect(verifyTaskCompletionPr({},{pr_url:'$(echo bad)'},{readPr})).rejects.toMatchObject({code:'PR_MERGE_UNVERIFIED'});
    expect(readPr).not.toHaveBeenCalled();
  });
});
