import {it,expect} from 'vitest';
import {requireCandidateEnvironment} from '../../workflow-authoring/assembly-orchestration.js';
import {authoringFixtureReader} from './authoring-execution-db.js';

it('候选fixture遵守实际库边界，生产同名schema不能当scratch',async()=>{await expect(requireCandidateEnvironment({query:async()=>({rows:[{name:'cecelia'}]})})).rejects.toMatchObject({code:'candidate_environment_unsupported'});});

it('历史无锁fixture只在显式allowMissing时证明锁缺失，纯reader不连接数据库',async()=>{
 expect(typeof authoringFixtureReader).toBe('function');
 const definition={source:{repo:'perfectuser21/cecelia',revision:'a'.repeat(40),ref:'contracts/pure.json'}};
 const content='---\nname: authoring-pure\nversion: 1.0.0\n---\n固定正文';
 const reader=authoringFixtureReader(definition,content);
 const source={repo:definition.source.repo,revision:definition.source.revision,path:'.skills-source.json'};
 expect(await reader(source,{allowMissing:true})).toBeNull();
 await expect(reader(source)).rejects.toThrow('fixture_file_missing');
 await expect(reader({...source,path:'unknown/SKILL.md'})).rejects.toThrow('fixture_file_missing');
 expect(await reader({...source,path:'skills/pure/SKILL.md'})).toBe(content);
 await expect(reader({...source,repo:'unknown/repo'},{allowMissing:true})).rejects.toThrow('fixture_source_unknown');
 await expect(reader({...source,revision:'b'.repeat(40)},{allowMissing:true})).rejects.toThrow('fixture_source_unknown');
});
