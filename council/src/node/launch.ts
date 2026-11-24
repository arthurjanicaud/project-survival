import {hash} from '../markets';
import {panel,now,type Category} from '../domain';
import {policyFor} from '../reform/policy';
import type {ReformRuntime} from '../reform/runtime';
export function copyPreflight(from:ReformRuntime,to:ReformRuntime){
 if(!from.engine.readiness().ready)throw Error('FRESH_FIVE_DOMAIN_PREFLIGHT_REQUIRED');
 for(const category of ['weather','football','basketball','tennis','esport'])to.repo.set('r4:preflight:'+category,{...from.repo.get<any>('r4:preflight:'+category),shared_from:from.engine.run().id});
 to.repo.set('r4:preflight_until',new Date(Date.now()+1800000).toISOString());
}
export async function beginSmoke(smoke:ReformRuntime,active:ReformRuntime){
 const r=smoke.repo,e=smoke.engine,run=e.run();if(run.id!=='survival-005-smoke'||active.engine.run().status!=='READY')throw Error('SMOKE_REQUIRES_ISOLATED_SCOPE_BEFORE_LAUNCH');
 if(r.get<any>('smoke:report')?.passed)return {duplicate:true};
 if(run.status==='READY'){
  copyPreflight(active,smoke);if(active.repo.get('r4:prior_learning'))r.set('r4:prior_learning',active.repo.get('r4:prior_learning'));run.policy={...policyFor('FULL',true,true),durationHours:24} as any;run.policy_hash=await hash(run.policy);r.set('reform_run',run);const s=r.state()!;s.mode='test';r.save(s);r.set('smoke:controlled',true);await e.start(run.id);
  r.run("UPDATE jobs SET status='SUPERSEDED',lease_until=NULL WHERE status='PENDING' AND kind NOT IN ('NOTIFY','NOTIFY_RELAY')");
 }
 if(e.run().status!=='RUNNING')throw Error('SMOKE_CANNOT_RESET_A_CLOSED_TEST');
 if(!r.get('smoke:market')){const categories=['weather','esport','football','basketball','tennis'];const available=categories.map(c=>({category:c,check:r.get<any>('r4:preflight:'+c)?.checks?.find((x:any)=>x.pipeline_ready)})).filter(x=>x.check);const chosen=available[0];if(!chosen)throw Error('NO_REAL_SMOKE_DOSSIER');r.set('smoke:market',{category:chosen.category,id:chosen.check.id});for(const item of available)r.enqueue('smoke:prepare:'+item.check.id,'R4_PREPARE',{category:item.category,id:item.check.id});}
 return {started:true,id:run.id,isolated:true};
}
export async function smokeStep(rt:ReformRuntime){
 const e=rt.engine,r=rt.repo;if(!r.get('smoke:controlled')||r.get<any>('smoke:report')?.passed)return;
 const choice=r.get<any>('smoke:market');if(!choice)return;
 let meetingId=r.get<string>('smoke:meeting');
 if(!meetingId){
  const packet=r.one("SELECT * FROM r4_packets WHERE market_id=? ORDER BY at DESC LIMIT 1",choice.id);if(!packet)return;const forecast=r.forecast(packet.id,choice.category.toUpperCase());if(!forecast)return;
  if(forecast.probability===null||forecast.essential_missing.length){r.set('smoke:error',{at:now(),reason:'Specialist could not form a supported opinion',forecast});return;}
  // A labelled technical examination may test a reasoned rejection too. No forecast, side, stake or vote is forced.
  const id='smoke:meeting:'+packet.id,slot=now();r.run('INSERT OR IGNORE INTO r4_agendas VALUES(?,?,?,?,?)',id,slot,'RUNNING',slot,JSON.stringify({agenda:[packet.id],index:0,stage:'INDEPENDENT',deadline:new Date(Date.now()+e.run().policy.maximumMeetingSeconds*1000).toISOString(),urgent:false,kickoff:false,diagnostic:true,proposal:null,discussion:[],missing:[],votes:[],revised:[]}));r.run("UPDATE r4_packets SET status='IN_MEETING' WHERE id=?",packet.id);r.set('smoke:meeting',id);r.event(id+':start','MEETING_START','Conseil de contrôle technique : dossier réel, avis et votes libres, fonds de test séparé.','SECRETARY',id,{diagnostic:true});e.notify(id+':start','Conseil de contrôle','Le conseil de test commence. Aucun résultat de ce fonds ne compte pour la compétition.');e.nextMeeting(id,'INDEPENDENT',0);meetingId=id;
 }
 const row=e.meetingRow(meetingId);if(!row||row.status==='RUNNING')return;
 const proposals=r.rows('SELECT * FROM proposals WHERE meeting_id=? ORDER BY version DESC',meetingId),latest=proposals[0],votes=latest?r.rows('SELECT * FROM votes WHERE proposal_id=? AND version=? ORDER BY round DESC',latest.id,latest.version):[];
 const finalVotes=[...new Map(votes.slice().reverse().map(v=>[v.member_id,v])).values()].map(v=>({...JSON.parse(v.payload),member_id:v.member_id}));
 const members=panel(choice.category as Category),forecasts=r.rows("SELECT actor FROM r4_forecasts WHERE packet_id=? AND phase='BEFORE'",row.payload.agenda[0]).map(x=>x.actor),speeches=r.events(0,meetingId,1000).filter(x=>x.kind==='SPEECH');
 const calls=r.rows("SELECT actor,status,input_tokens,output_tokens FROM calls WHERE status='SUCCESS' AND id NOT LIKE '%:result'"),notes=r.rows("SELECT id,status FROM notifications WHERE id IN (?,?)",meetingId+':start',meetingId+':end'),notificationsOk=notes.length===2&&notes.every(n=>n.status==='SENT');
 const specialists=['WEATHER','ESPORT','FOOTBALL','BASKETBALL','TENNIS'];
 const expressed=finalVotes.filter(v=>v.vote!=='ABSTAIN').length,passed=row.status==='COMPLETED'&&members.every(m=>forecasts.includes(m)&&finalVotes.some(v=>v.member_id===m))&&expressed>=3&&new Set(speeches.map(s=>s.actor)).size>=4&&specialists.every(actor=>calls.some(c=>c.actor===actor))&&calls.length>=18&&notificationsOk;
 const report={at:now(),passed,meeting_id:meetingId,meeting_status:row.status,source_code:e.activeCode(),official_policy_hash:await hash(policyFor('FULL',true,true)),members,specialists_responded:specialists.filter(actor=>calls.some(c=>c.actor===actor)),independent_forecasts:forecasts,final_votes:finalVotes,expressed_votes:expressed,speech_actors:[...new Set(speeches.map(s=>s.actor))],azure_calls:calls.length,input_tokens:calls.reduce((a,c)=>a+c.input_tokens,0),output_tokens:calls.reduce((a,c)=>a+c.output_tokens,0),notifications_accepted:notificationsOk,test_positions:r.rows('SELECT id,status FROM positions'),note:'Isolated real-provider/Azure technical test; no official capital, no forced investment, no invented resolution.'};r.set('smoke:report',report);
 if(passed){const run=e.run(),s=r.state()!,pending=r.one("SELECT id FROM positions WHERE status='PENDING' LIMIT 1");run.status=pending?'CLOSING':'FINISHED';s.status=run.status;s.betting_deadline=now();r.save(s);r.set('reform_run',run);r.run("UPDATE jobs SET status='SUPERSEDED',lease_until=NULL WHERE status='PENDING' AND kind NOT IN ('R4_SETTLE','NOTIFY','NOTIFY_RELAY')");}
}
export async function startOfficial(rt:ReformRuntime,smoke:ReformRuntime,confirm:string){
 const e=rt.engine,run=e.run(),r=rt.repo;if(run.id!=='survival-005-active'||confirm!==run.id)throw Error('EXPLICIT_NEW_EXPERIMENT_ID_REQUIRED');
 if(run.status==='RUNNING')return {duplicate:true,run};if(run.status!=='READY')throw Error('START_IS_NEVER_A_RESET');
 const test=smoke.repo.get<any>('smoke:report');if(!test?.passed||test.source_code!==e.activeCode()||test.official_policy_hash!==run.policy_hash)throw Error('SUCCESSFUL_REAL_AZURE_COUNCIL_TEST_REQUIRED');
 if(run.policy.durationHours!==168||run.policy.fullCapitalEur!=='1000'||r.state()?.initial_eur!=='1000'||r.one('SELECT id FROM ledger LIMIT 1')||r.one('SELECT id FROM positions LIMIT 1'))throw Error('NEW_FUND_INTEGRITY_REQUIRED');
 return {run:await e.start(confirm),duplicate:false};
}
export async function finalReport(rt:ReformRuntime){
 const e=rt.engine,r=rt.repo,run=e.run();if(run.id!=='survival-005-active'||run.status!=='FINISHED'||r.get('report:final'))return;
 const ledger=r.rows('SELECT * FROM ledger ORDER BY id'),positions=r.rows('SELECT * FROM positions ORDER BY id'),fills=r.rows('SELECT * FROM fills ORDER BY id');if(positions.some(p=>p.status!=='SETTLED'))throw Error('FINAL_REPORT_REQUIRES_ACTUAL_RESOLUTIONS');
 r.set('report:final',{generated_at:now(),run,summary:e.summary(),financial_sha256:await hash({ledger,positions,fills}),ledger,positions,fills,limitation:'Fictional betting experiment; no guarantee of future predictive performance.'});
}
