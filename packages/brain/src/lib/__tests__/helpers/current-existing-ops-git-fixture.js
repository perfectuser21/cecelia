import {fixtureGit} from './fixed-existing-ops-git-fixture.js';
import {readExistingOpsGitTree} from './read-existing-ops-git-tree.js';

// 当前候选真实HEAD快照；只供测试输入，不授予历史main或发布来源资格。
export function readCurrentExistingOpsGitFixture(){
 return readExistingOpsGitTree(fixtureGit,fixtureGit('rev-parse','HEAD').trim());
}
