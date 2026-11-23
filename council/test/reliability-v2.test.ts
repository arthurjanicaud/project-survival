import {test} from 'node:test';
import assert from 'node:assert/strict';
import {repository,env,market,proposal} from './helpers';
import {CATEGORIES,panel,type Category} from '../src/domain';
import {ReformRepository} from '../src/reform/store';
import {ReformEngine} from '../src/reform/engine';
import {freshDossier,scopedSource,observationCore} from '../src/reform/dossier';
import {reformContext} from '../src/reform/context';
import {launchReadiness} from '../src/reform/readiness';
import {learningProfile,learnedForecast} from '../src/reform/learning';
import {tally} from '../src/finance';
import {POLICY} from '../src/reform/policy';
import {researchPermit} from '../src/reform/read-budget';

function harness(){
 const base=repository(),r=new ReformRepository(base.sql,base.atomic),m=market(),seen:any[]=[];let side='YES';
 const source={id:'provider-source',url:'https://official.test',title:'Verified fixture',provider:'ESPN',status:'VERIFIED' as const,fetched_at:new Date().toISOString(),text:'{"state":"pre","teams":["A","B"]}'};
 const api={fx:async()=>({usd_per_eur:'1.1',reference_date:'2026-11-23',source:'UNIT FIXTURE',method:'test only'}),inspect:async()=>{const fresh=structuredClone(m);fresh.observed_at=new Date().toISOString();for(const b of Object.values(fresh.books))b.observed_at=fresh.observed_at;return fresh;},catalog:async()=>[],evidence:async()=>[{...source,fetched_at:new Date().toISOString()}],get:async()=>[]};
 const ai={ask:async(id:string,actor:string,phase:string,c:any)=>{seen.push({phase,actor,c:structuredClone(c)});
  if(phase==='independent_forecast')return {probability:.7,lower:.5,upper:.85,method_id:'judgement',data_confidence:'MEDIUM',evidence_ids:[c.sources[0].id],essential_missing:[],rationale:'Les faits du dossier soutiennent une probabilité subjective de 70 pour cent.',falsifier:'Un changement de composition pourrait invalider cette estimation.',search_requests:[]};
  if(['contradictory_discussion','answer_objection'].includes(phase))return {speech:'Je vérifie cette hypothèse avec les faits actuels, sans prétendre disposer de calibration.',estimated_yes_probability:.7,objection:'Incertitude du modèle reconnue.',amendment:null,citations:[],document_requests:[]};
  if(phase==='chair_resolution')return {speech:'Les arguments sont connus ; les cotations actuelles et le risque permettent un vote.',estimated_yes_probability:.7,question:'',question_to:null,amendment:null,document_requests:[]};
  if(phase.includes('vote')||phase==='abstention_reconsideration'){const v=side==='ABSTAIN'?'ABSTAIN':'FOR';return {vote:v,speech:'La proposition exacte et son risque sont examinés avec le dossier actuel.',abstention_reason:v==='ABSTAIN'?'Il manque une observation essentielle vérifiable du match.':'',reconsider_if:'Une observation officielle complète du match permettrait une décision.',proposal_id:c.proposal.id,proposal_version:c.proposal.version};}
  throw Error('UNEXPECTED_PHASE:'+phase);
 }};
 const e=new ReformEngine(r,{...env,REFORM_IMPROVEMENTS:'true',REFORM_ACTIVE_MODE:'true'},api as any,ai as any);
 async function start(){await e.prepare('future-test-fund','FULL');for(const c of CATEGORIES)r.set('r4:preflight:'+c,{at:new Date().toISOString(),pipeline_ready:true});r.set('r4:account_usage',{day:new Date().toISOString().slice(0,10),at:new Date().toISOString(),reads:0,writes:0});await e.start('future-test-fund');}
 return {r,e,m,api,source,seen,start,abstain:()=>{side='ABSTAIN';}};
}

test('three FOR and two reasoned abstentions approve; two FOR and three abstentions never approve',()=>{
 const p=proposal(),actors=panel('football'),votes=actors.map((member_id,i)=>({member_id,vote:(i<3?'FOR':'ABSTAIN') as any,speech:'Argument documenté.',abstention_reason:'Une observation essentielle actuelle manque.',reconsider_if:'Un rapport officiel actuel est publié.',proposal_id:p.id,proposal_version:p.version}));
 assert.equal(tally(actors,votes,p).decision,'APPROVE');votes[2].vote='ABSTAIN';assert.equal(tally(actors,votes,p,true).decision,'POSTPONE');votes.forEach((v,i)=>v.vote=i<3?'AGAINST':'ABSTAIN');assert.equal(tally(actors,votes,p).decision,'REJECT');
});
test('structured weather thresholds and actual temperatures survive prose truncation',()=>{
 const m=market(),metar={rules:{station:'RJTT',day:'2026-11-24',lower:16.5,upper:17.5,unit:'C'},extreme:17.1,rows:[{at:'2026-11-24T01:00:00Z',value:17.1,raw:'ACTUAL METAR T0171'}]};
 const source=scopedSource({id:'raw',url:'https://official.test',title:'Weather',text:'x'.repeat(20000),provider:'NOAA AWC',status:'VERIFIED',fetched_at:new Date().toISOString()},m,metar);
 const context=reformContext({market:m,sources:[source],secretary_results:[source],observations:observationCore(metar)});
 assert.equal(context.sources[0].structured.rules.lower,16.5);assert.equal(context.sources[0].structured.relevant_reports[0].value,17.1);assert.equal(context.secretary_results[0].structured.rules.upper,17.5);assert.equal(context.sources[0].market_id,m.id);
});
test('secretary cannot return another temperature bracket of the same station/day/event',async()=>{
 const s=harness();await s.e.prepare('docs','FULL');
 for(const id of ['a','b'])s.r.run('INSERT INTO r4_evidence VALUES(?,?,?,?)',id,'same-event',new Date().toISOString(),JSON.stringify({market_id:id,station:'RJTT',local_day:'2026-11-24',text:id}));
 assert.deepEqual(s.r.searchDocuments({event:'same-event',market_id:'a',station:'RJTT',day:'2026-11-24'}).map(x=>x.market_id),['a']);
});
test('freshness rejects old books, future timestamps and wrong-market evidence',()=>{
 const m=market(),s={id:'s',url:'https://official.test',title:'Fixture',provider:'ESPN',status:'VERIFIED' as const,fetched_at:new Date().toISOString(),text:'{"state":"pre"}'};
 assert.equal(freshDossier(m,[s],null,POLICY).ready,true);m.books.YES!.observed_at='2000-01-01T00:00:00Z';assert.equal(freshDossier(m,[s],null,POLICY).ready,false);m.books.YES!.observed_at=new Date().toISOString();assert.equal(freshDossier(m,[{...s,market_id:'wrong'}],null,POLICY).ready,false);
});
test('unchanged facts refresh execution context without rebilling or rewriting the blind benchmark',async()=>{
 const s=harness();await s.start();await s.e.preparePacket(s.m.id,'football');const packet=s.r.one('SELECT id FROM r4_packets');await s.e.forecast(packet.id,'FOOTBALL');const before=s.r.packet(packet.id),forecast=JSON.stringify(s.r.forecast(packet.id,'FOOTBALL'));
 s.m.books.YES!.asks[0].price='.52';await s.e.preparePacket(s.m.id,'football');const refreshed=s.r.packet(packet.id);
 assert.equal(s.r.one('SELECT count(*) n FROM r4_packets').n,1);assert.equal(refreshed.payload.market.books.YES.asks[0].price,'.5');assert.equal(refreshed.payload.live.market.books.YES.asks[0].price,'.52');assert.deepEqual(refreshed.payload.baseline,before.payload.baseline);assert.equal(JSON.stringify(s.r.forecast(packet.id,'FOOTBALL')),forecast);
});
test('full improved path refreshes old context before meeting, votes and buys exactly once',async()=>{
 const s=harness();await s.start();await s.e.preparePacket(s.m.id,'football');const packet=s.r.one('SELECT id FROM r4_packets');await s.e.forecast(packet.id,'FOOTBALL');
 const p=s.r.packet(packet.id);p.payload.market.observed_at='2000-01-01T00:00:00Z';for(const b of Object.values<any>(p.payload.market.books))b.observed_at=p.payload.market.observed_at;s.r.run('UPDATE r4_packets SET payload=? WHERE id=?',JSON.stringify(p.payload),p.id);
 const at=new Date().toISOString();await s.e.slot(at);const id='r4:meeting:'+at;
 for(let i=0;i<10&&s.e.meetingRow(id)?.status==='RUNNING';i++)await s.e.meeting(id);
 assert.equal(s.e.meetingRow(id).status,'COMPLETED');assert.equal(s.r.one('SELECT count(*) n FROM positions').n,1);await s.e.meeting(id);assert.equal(s.r.one('SELECT count(*) n FROM positions').n,1);
 const debate=s.seen.find(x=>x.phase==='contradictory_discussion');assert.ok(Date.now()-Date.parse(debate.c.executable_books.YES.observed_at)<10000);assert.ok(s.r.get('r4:learning:FOOTBALL'));
});
test('changing facts before meeting regenerates forecasts, never votes on an obsolete dossier',async()=>{
 const s=harness();await s.start();await s.e.preparePacket(s.m.id,'football');const p=s.r.one('SELECT id FROM r4_packets');await s.e.forecast(p.id,'FOOTBALL');s.source.text='{"state":"pre","teams":["A","B"],"injury":"verified"}';
 await s.e.slot(new Date().toISOString());assert.equal(s.r.one('SELECT count(*) n FROM positions').n,0);assert.equal(s.r.one('SELECT count(*) n FROM votes').n,0);assert.ok(s.r.one("SELECT id FROM jobs WHERE kind='R4_PREPARE' AND json_extract(payload,'$.force')=1"));
});
test('abstention triggers one real data refresh and re-vote; no unbounded meetings',async()=>{
 const s=harness();await s.start();await s.e.preparePacket(s.m.id,'football');await s.e.forecast(s.r.one('SELECT id FROM r4_packets').id,'FOOTBALL');s.abstain();let reads=0;const inspect=s.api.inspect;s.api.inspect=async()=>{reads++;return inspect();};
 const at=new Date().toISOString();await s.e.slot(at);const id='r4:meeting:'+at;for(let i=0;i<12&&s.e.meetingRow(id).status==='RUNNING';i++)await s.e.meeting(id);
 assert.equal(s.e.meetingRow(id).status,'COMPLETED');assert.equal(s.r.one('SELECT count(*) n FROM positions').n,0);assert.equal(s.r.one('SELECT count(*) n FROM votes').n,10);assert.ok(reads>=2);
});
test('START requires fresh complete preflight in all five domains and account monitoring',async()=>{
 const s=harness();await s.e.prepare('not-ready','FULL');await assert.rejects(s.e.start('not-ready'),/FIVE_DOMAINS/);assert.equal(s.r.one('SELECT count(*) n FROM ledger').n,0);
 const checks=Object.fromEntries(CATEGORIES.map(c=>[c,{at:new Date().toISOString(),pipeline_ready:true}]));assert.equal(launchReadiness(checks).ready,true);checks.tennis.pipeline_ready=false;assert.equal(launchReadiness(checks).ready,false);
});
test('account-wide write pressure throttles research despite a nearly empty local counter',async()=>{
 const s=harness();await s.start();s.r.set('r4:account_usage',{day:new Date().toISOString().slice(0,10),at:new Date().toISOString(),reads:200,writes:95000});
 assert.equal(researchPermit(s.r,{kind:'R4_SCAN',payload:{category:'weather'}},POLICY).mode,'RESERVED');assert.equal(researchPermit(s.r,{kind:'R4_SETTLE',payload:{}},POLICY).allowed,true);
});
test('calibration uses only labels available then, distinct events and demonstrated temporal improvement',()=>{
 const at='2026-11-23T00:00:00Z',rows=Array.from({length:60},(_,i)=>({event:'e'+i,market:'m'+i,category:'weather',method:'judgement',probability:.1,baseline:.5,outcome:1 as const,at:new Date(Date.UTC(2026,8,1+i)).toISOString(),resolved_at:new Date(Date.UTC(2026,8,1+i,2)).toISOString()}));
 const profile=learningProfile(rows,'weather','judgement',at);assert.equal(profile.enabled,true);assert.ok(learnedForecast({probability:.1,lower:0,upper:.3},profile).probability>.1);
 const leak=learningProfile(rows.map(r=>({...r,resolved_at:'2027-01-01T00:00:00Z'})),'weather','judgement',at);assert.equal(leak.events,0);assert.equal(leak.enabled,false);
 const clones=learningProfile(rows.map(r=>({...r,event:'same'})),'weather','judgement',at);assert.equal(clones.events,1);assert.equal(clones.enabled,false);
});

test('seven-day synthetic endurance: restart, provider outage, votes, settlement and final margin stay coherent',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:Date.UTC(2026,10,23,10)});
 const s=harness();await s.start();await s.e.preparePacket(s.m.id,'football');await s.e.forecast(s.r.one('SELECT id FROM r4_packets').id,'FOOTBALL');
 const originalInspect=s.api.inspect;s.api.inspect=async()=>{const m=await originalInspect();if(Date.now()>=Date.parse(m.event_end_at)){m.active=false;m.resolved=true;m.payouts={YES:'1',NO:'0'};m.resolution_evidence={resolved_at:new Date().toISOString(),source:'synthetic-test-only'};}return m;};
 let bucket=0,failures=0,steps=0;const catalog=s.api.catalog;s.api.catalog=async()=>{if(bucket>=30&&bucket<36)throw Error('SYNTHETIC_PROVIDER_OUTAGE');return catalog();};
 let engine=s.e;
 for(bucket=0;bucket<=1008;bucket++){
  if(bucket)t.mock.timers.tick(600000);
  if(bucket===150)engine=new ReformEngine(s.r,s.e.env,s.api as any,s.e.azure); // persisted jobs survive reconstruction
  engine.tick();let n=0,job:any;
  while((job=s.r.claim())&&n++<100){try{await engine.process(job);s.r.complete(job);}catch(e){failures++;s.r.run("UPDATE jobs SET status='FAILED',lease_until=NULL,error=? WHERE id=?",String(e),job.id);}steps++;}
  assert.ok(n<100,'No unbounded immediate retry loop');assert.ok(Number(s.r.cash())>=0);
 }
 assert.ok(failures>=5);assert.equal(s.r.one('SELECT count(*) n FROM positions').n,1);assert.equal(s.r.one("SELECT count(*) n FROM positions WHERE status='PENDING'").n,0);assert.equal(engine.run().status,'FINISHED');
 const cov=engine.coverage();assert.equal(cov.expected,972);assert.ok(cov.fraction>.98&&cov.fraction<1);assert.equal(s.r.one("SELECT count(*) n FROM ledger WHERE kind='INITIAL'").n,1);
 console.log(JSON.stringify({mode:'synthetic virtual clock, not a real 168-hour provider SLA',steps,failed_source_jobs:failures,coverage:cov.fraction,real_money_spent:0}));
});
