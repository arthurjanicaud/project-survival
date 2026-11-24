import test from 'node:test';
import assert from 'node:assert/strict';
import {ReformRepository} from '../src/reform/store';
import {ReformEngine} from '../src/reform/engine';
import {copyPreflight,startOfficial,finalReport} from '../src/node/launch';
import {hash} from '../src/markets';
import {policyFor} from '../src/reform/policy';
import {repository,env} from './helpers';
async function runtime(id:string){const base=repository(),repo=new ReformRepository(base.sql,base.atomic);repo.set('runtime:backend','github-sqlite');const engine=new ReformEngine(repo,{...env,STORAGE_BACKEND:'github-sqlite',PUBLIC_STAGE:id.endsWith('smoke')?'smoke':'active',PUBLIC_PHASE:'5',REFORM_ACTIVE_MODE:'true',REFORM_IMPROVEMENTS:'true',CF_VERSION_METADATA:{id:'source-code'}});await engine.prepare(id,'FULL');engine.markets.fx=async()=>({usd_per_eur:'1.2',reference_date:'2026-11-24',source:'fixture ECB',method:'unit-test fixture'});return {repo,engine} as any;}
function preflight(rt:any){for(const c of ['weather','football','basketball','tennis','esport'])rt.repo.set('r4:preflight:'+c,{at:new Date().toISOString(),pipeline_ready:true,usable:1,checks:[{id:'m',pipeline_ready:true}]});}
test('Official START needs exact new ID, real-test approval, fresh domains and creates capital once',async()=>{
 const active=await runtime('survival-005-active'),smoke=await runtime('survival-005-smoke');preflight(active);
 await assert.rejects(()=>startOfficial(active,smoke,'survival-004-active'),/EXPLICIT_NEW/);await assert.rejects(()=>startOfficial(active,smoke,'survival-005-active'),/REAL_AZURE/);assert.equal(active.repo.cash(),'0');
 smoke.repo.set('smoke:report',{passed:true,source_code:'source-code',official_policy_hash:await hash(policyFor('FULL',true,true))});
 const result=await startOfficial(active,smoke,'survival-005-active');assert.equal(result.duplicate,false);assert.equal(active.repo.cash(),'1200');assert.equal(active.repo.state().initial_eur,'1000');assert.equal(Date.parse(result.run!.end_at!)-Date.parse(result.run!.started_at!),168*3600000);assert.equal(Date.parse(active.repo.state().end_at)-Date.parse(active.repo.state().betting_deadline),6*3600000);
 assert.equal((await startOfficial(active,smoke,'survival-005-active')).duplicate,true);assert.equal(active.repo.one('SELECT count(*) n FROM ledger').n,1);
});
test('A closed archive and a changed engine cannot reuse launch authorization',async()=>{
 const archive=await runtime('survival-004-active'),smoke=await runtime('survival-005-smoke');await assert.rejects(()=>startOfficial(archive,smoke,'survival-004-active'),/EXPLICIT_NEW/);assert.equal(archive.repo.cash(),'0');
 const active=await runtime('survival-005-active');preflight(active);smoke.repo.set('smoke:report',{passed:true,source_code:'old-code',official_policy_hash:await hash(policyFor('FULL',true,true))});await assert.rejects(()=>startOfficial(active,smoke,'survival-005-active'),/REAL_AZURE/);
});
test('Shared preflight retains original observation timestamps and rejects stale records',async()=>{
 const a=await runtime('survival-005-active'),s=await runtime('survival-005-smoke');preflight(a);copyPreflight(a,s);assert.equal(s.repo.get('r4:preflight:esport').at,a.repo.get('r4:preflight:esport').at);a.repo.set('r4:preflight:esport',{at:'2000-01-01T00:00:00Z',pipeline_ready:true,usable:1});assert.throws(()=>copyPreflight(a,s),/FRESH_FIVE/);
});
test('Final report is saved only after official settlement, and never invents a payment',async()=>{
 const a=await runtime('survival-005-active');await finalReport(a);assert.equal(a.repo.get('report:final'),null);const run=a.engine.run();run.status='FINISHED';a.repo.set('reform_run',run);await finalReport(a);assert.ok(a.repo.get('report:final').financial_sha256);assert.equal(a.repo.cash(),'0');const stored=a.repo.get('report:final').generated_at;await finalReport(a);assert.equal(a.repo.get('report:final').generated_at,stored);
});
