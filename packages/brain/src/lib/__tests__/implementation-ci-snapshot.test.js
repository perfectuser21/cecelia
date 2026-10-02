import {expect,it} from 'vitest';
import * as snapshot from '../implementation-ci-snapshot.js';
it('仅本机scratch或GitHub Actions隔离test库可创建CI schema，任意生产/其它本机库拒绝',()=>{
 expect(snapshot.isImplementationScratchDatabase,'必须同时识别正式CI隔离库与本机scratch').toBeTypeOf('function');
 const allowed=snapshot.isImplementationScratchDatabase;
 expect(allowed('cecelia_scratch',{})).toBe(true);
 expect(allowed('cecelia_test',{CI:'true',GITHUB_ACTIONS:'true'})).toBe(true);
 for(const env of [{},{CI:'true'},{GITHUB_ACTIONS:'true'},{CI:'false',GITHUB_ACTIONS:'true'}])expect(allowed('cecelia_test',env)).toBe(false);
 for(const name of ['cecelia','cecelia_staging','postgres','zenithjoy','cecelia_test_copy'])expect(allowed(name,{CI:'true',GITHUB_ACTIONS:'true'})).toBe(false);
});
