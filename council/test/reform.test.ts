import {test} from 'node:test';
import assert from 'node:assert/strict';
import {repository,env,market,book} from './helpers';
import {ReformRepository} from '../src/reform/store';
import {ReformEngine} from '../src/reform/engine';
import {POLICY,ACTIVE_POLICY,PolicySchema} from '../src/reform/policy';
import {ForecastSchema,validateForecast,score,chronologicalSplit,calibrate,benchmark,type ScoredForecast} from '../src/reform/forecast';
import {weatherRules,observations,quality,family,anomaly,routineTemperature} from '../src/reform/evidence';
import {allowance} from '../src/reform/allocation';
import {coverage} from '../src/reform/telemetry';
import {readiness,fairMissedOpportunities} from '../src/reform/evaluation';

const f={probability:.7,lower:.6,upper:.8,method_id:'judgement',data_confidence:'MEDIUM',evidence_ids:['source'],essential_missing:[],rationale:'Une prévision fondée sur les faits fournis, avec une incertitude explicitement décrite.',falsifier:'Un état sportif contraire changerait cette estimation.',search_requests:[]};
function repo(){const r=repository();return new ReformRepository(r.sql,r.atomic);}
function harness(){
  const r=repo(),m=market(),seen:any[]=[];const sources=[{id:'source',url:'https://official.test',title:'Current fixture',provider:'ESPN',status:'VERIFIED',fetched_at:new Date().toISOString(),text:'{"state":"pre","teams":["Team A","Team B"]}'}];
  const api={fx:async()=>({usd_per_eur:'1.1',reference_date:'2026-11-11',source:'UNIT FIXTURE',method:'isolated test'}),inspect:async()=>m,evidence:async()=>sources,catalog:async()=>[],get:async()=>[]};
  const ai={ask:async(id:string,actor:string,phase:string,c:any)=>{seen.push({id,actor,phase,c:structuredClone(c)});
    if(phase==='independent_forecast')return {...f};
    if(phase==='contradictory_discussion'||phase==='answer_objection')return {speech:'Je vérifie les faits et conserve une probabilité argumentée.',estimated_yes_probability:.7,objection:'Risque de biais commun explicitement discuté.',amendment:null,citations:[],document_requests:[]};
    if(phase==='chair_resolution')return {speech:'Les objections sont examinées avant de soumettre une proposition précise.',estimated_yes_probability:.7,question:'',question_to:null,amendment:null,document_requests:[]};
    if(phase==='independent_vote')return {vote:'FOR',speech:'Le dossier et la proposition exacte justifient mon vote personnel.',abstention_reason:'',reconsider_if:'',proposal_id:c.proposal.id,proposal_version:c.proposal.version};
    throw Error('Unexpected phase '+phase);
  }};
  const e=new ReformEngine(r,env,api as any,ai as any);return {e,r,m,api,seen};
}
test('reform policy rejects invalid risk values rather than silently changing a frozen protocol',()=>{
  assert.throws(()=>PolicySchema.parse({...POLICY,betFraction:2}));assert.throws(()=>PolicySchema.parse({...POLICY,unknown:true}));
});
test('probability interval and factual source identity are enforced',()=>{
  const value=ForecastSchema.parse(f);assert.equal(validateForecast(value,['source']).probability,.7);
  assert.throws(()=>validateForecast({...value,lower:.8},['source']),/INTERVAL/);assert.throws(()=>validateForecast(value,[]),/SOURCE/);
  assert.throws(()=>validateForecast({...value,probability:null},['source']),/UNKNOWN/);
});
test('weather veto uses actual routine station observations and respects local dates and units',()=>{
  const m={...market(),category:'weather' as const,question:'Will the highest temperature in Wellington be 20°C on November 11?',description:'Routine METAR observations at NZWN, rounded to the nearest degree.',start_at:'2026-11-10T11:00:00Z',event_end_at:'2026-11-11T11:00:00Z'};
  const at=Date.parse('2026-11-11T09:00:00Z');
  const rows=[{icaoId:'NZWN',obsTime:Date.parse('2026-11-11T08:30:00Z')/1000,temp:21,rawOb:'NZWN 110830Z 22010KT 9999 FEW020 21/15 Q1010',metarType:'METAR'},{icaoId:'NZWN',obsTime:Date.parse('2026-11-10T08:30:00Z')/1000,temp:35,metarType:'METAR'},{icaoId:'OTHER',obsTime:at/1000,temp:40,metarType:'METAR'}];
  const got=observations(m,rows,at);assert.equal(got.rows.length,1);assert.equal(got.extreme,21);assert.equal(got.yes_impossible,true);
  assert.equal(observations({...m,description:'A different final source NZWN'},rows,at).yes_impossible,false);
  assert.equal(observations(m,[{...rows[0],metarType:'SPECI'}],at).rows.length,0);
  assert.equal(observations({...m,question:'Will the lowest temperature in Wellington be 20°C on November 11?'},[{...rows[0],temp:19,rawOb:'NZWN 110830Z 22010KT 9999 FEW020 19/15 Q1010'}],at).yes_impossible,true);
  assert.equal(weatherRules({...m,question:'Will the highest temperature in Wellington be 20°C or below on November 11?'})?.lower,null);
});
test('retrieval freshness cannot substitute for missing current station observations',()=>{
  const m={...market(),category:'weather' as const,question:'Will the highest temperature in Wellington be 20°C on November 11?',description:'Routine METAR NZWN.',start_at:'2026-11-10T11:00:00Z'};
  const sources=[{id:'x',provider:'Open-Meteo',status:'VERIFIED' as const,fetched_at:new Date().toISOString(),text:'forecast',url:'https://official.test',title:'Forecast'}];
  assert.equal(quality(m,sources,{rules:weatherRules(m),latest:null}).ready,false);assert.equal(family('Open-Meteo'),family('Open-Meteo Ensemble'));
  assert.equal(anomaly(.35,.001,{lower:.2,upper:.5}).large_gap,true);
});
test('temporal split excludes future labels and variants of the same event',()=>{
  const row:ScoredForecast={event:'fixture',market:'m',at:'2026-11-01T00:00:00Z',resolved_at:'2026-11-02T00:00:00Z',probability:.7,baseline:.5,outcome:1,method:'judgement',category:'football'};
  const cut='2026-11-03T00:00:00Z',parts=chronologicalSplit([row,{...row,market:'future-label',resolved_at:'2026-11-04T00:00:00Z'},{...row,market:'variant',at:'2026-11-03T01:00:00Z'},{...row,event:'new',market:'new',at:'2026-11-03T02:00:00Z'}],cut);
  assert.equal(parts.train.length,1);assert.deepEqual(parts.test.map(x=>x.market),['new']);assert.ok(calibrate(.7,parts.train).probability>.7);
});
test('many variants do not count as independent events for qualification',()=>{
  const rows=Array.from({length:200},(_,i)=>({event:'one-event',market:String(i),at:'2026-11-01T00:00:00Z',resolved_at:'2026-11-02T00:00:00Z',probability:.9,baseline:.5,outcome:1 as const,method:'judgement',category:'football'}));
  assert.equal(score(rows).events,1);assert.equal(readiness(rows,'2026-11-01T00:00:00Z',1,POLICY,Date.parse('2026-11-10T00:00:00Z')).eligible,false);
});
test('allocation respects reserve, method qualification and correlated exposure with Decimal',()=>{
  const x={initial:'1000',cash:'250',spent:'0',clusterCost:'0',elapsedFraction:1,probability:.8,lower:.7,price:'.5',feePerShare:'.01',methodQualified:true};
  assert.ok(Number(allowance(x,POLICY).maximum)<=50);assert.equal(allowance({...x,methodQualified:false},POLICY).maximum,'0');assert.equal(allowance({...x,clusterCost:'200'},POLICY).maximum,'0');assert.equal(allowance({...x,cash:'100'},POLICY).maximum,'0');
});
test('coverage counts missing time buckets and missed categories, not just completed jobs',()=>{
  const at='2026-11-11T00:00:00Z',b=Math.floor(Date.parse(at)/600000),got=coverage(at,'2026-11-11T00:30:00Z',[{bucket:b,category:'weather',status:'DONE'},{bucket:b,category:'football',status:'DONE'},{bucket:b+1,category:'weather',status:'DONE'}],['weather','football']);assert.equal(got.expected,3);assert.equal(got.complete,1);assert.equal(got.missing.length,2);
});
test('hypothetical opportunities cannot spend a 10-EUR reference repeatedly on one market or exceed funds',()=>{
  const rows=[{market:'a',event:'x',at:'1',cost:10,payout:20,reason:'initial refusal'},{market:'a',event:'x',at:'2',cost:10,payout:20,reason:'same market again'},{market:'b',event:'y',at:'3',cost:10,payout:0,reason:'other'}];
  const result=fairMissedOpportunities(rows,10);assert.equal(result.selected.length,1);assert.equal(result.committed,10);assert.equal(result.profit,10);
});
test('blind forecasts, council votes, shadow execution and outcome scores are connected without touching a portfolio',async()=>{
  const s=harness();await s.e.prepare('survival-test-shadow','SHADOW');assert.equal(s.e.run().status,'READY');assert.equal(s.r.rows('SELECT * FROM ledger').length,0);
  await s.e.start('survival-test-shadow');await assert.rejects(s.e.start('survival-test-shadow'),/NEVER_A_RESET/);
  await s.e.preparePacket(s.m.id,'football');const p=s.r.one('SELECT id FROM r4_packets');await s.e.forecast(p.id,'FOOTBALL');
  await s.e.slot(new Date().toISOString());const row=s.r.one('SELECT id FROM r4_agendas');
  for(let i=0;i<8&&s.e.meetingRow(row.id).status==='RUNNING';i++)await s.e.meeting(row.id);
  assert.equal(s.e.meetingRow(row.id).status,'COMPLETED');assert.equal(s.r.one('SELECT count(*) n FROM votes').n,5);
  assert.equal(s.r.one('SELECT count(*) n FROM r4_assessments').n,1);assert.equal(s.r.rows('SELECT * FROM ledger').length,0);assert.equal(s.r.rows('SELECT * FROM positions').length,0);
  for(const call of s.seen.filter(x=>x.phase==='independent_forecast')){assert.equal(call.c.executable_books,undefined);assert.equal(call.c.baseline,undefined);assert.equal(call.c.independent_forecasts,undefined);assert.equal(call.c.market.books,undefined);}
  assert.equal(s.r.one("SELECT count(*) n FROM r4_forecasts WHERE phase='BEFORE'").n,5);assert.equal(s.r.one("SELECT count(*) n FROM r4_forecasts WHERE phase='AFTER'").n,5);
  const packet=s.r.packet(p.id);packet.payload.market.event_end_at='2026-01-01T00:00:00Z';s.r.run('UPDATE r4_packets SET payload=? WHERE id=?',JSON.stringify(packet.payload),p.id);
  s.api.inspect=async()=>({...s.m,resolved:true,payouts:{YES:'1',NO:'0'},resolution_evidence:{resolved_at:new Date().toISOString()}} as any);
  await s.e.settle();assert.equal(s.e.scored().length,1);assert.equal(s.e.summary().score.n,1);assert.equal(s.r.cash(),'0');
});
test('paper pilot cannot start because a short or unqualified shadow merely produced activity',async()=>{
  const s=harness();await s.e.prepare('survival-test-pilot','PILOT');await assert.rejects(s.e.start('survival-test-pilot',{eligible:false}),/QUALIFIED/);await assert.rejects(s.e.start('survival-test-pilot',{eligible:true,policy_hash:s.e.run().policy_hash,code_version:'old-unvalidated-code'}),/QUALIFIED/);assert.equal(s.r.cash(),'0');assert.equal(s.e.run().status,'READY');
});


test('routine T remark takes precedence over whole-degree JSON/body temperatures at settlement thresholds',()=>{
 assert.equal(routineTemperature('METAR RJTT 111200Z 00000KT 9999 19/10 Q1010 RMK T01960100')?.celsius,19.6);
 assert.equal(routineTemperature('RJTT 111200Z 00000KT 9999 M02/M03 Q1010 RMK T10171022')?.celsius,-1.7);
 assert.equal(routineTemperature('RJTT 111200Z 00000KT 9999 M11/M17 Q1010')?.celsius,-11);
 assert.equal(routineTemperature('SPECI RJTT 111200Z 00000KT 9999 20/10 Q1010'),null);
 assert.equal(routineTemperature('RJTT 111200Z 00000KT 9999 Q1010'),null);
});
import {reformContext} from '../src/reform/context';
import {BACKUP_TABLES,beginRecovery,restoreChunk,finishRecovery} from '../src/reform/recovery';
import {fitResiduals,residualProbability} from '../src/reform/models';
import {reformTarget} from '../src/reform/routing';

test('qualified pilot buys and settles once after reconstruction, including exact euro P&L',async()=>{
 const s=harness();await s.e.prepare('survival-test-pilot','PILOT');const q={eligible:true,policy_hash:s.e.run().policy_hash,code_version:s.e.activeCode(),methods:[{category:'football',method:'judgement',eligible:true}]};await s.e.start('survival-test-pilot',q);
 await s.e.preparePacket(s.m.id,'football');const p=s.r.one('SELECT id FROM r4_packets');await s.e.forecast(p.id,'FOOTBALL');await s.e.slot(new Date().toISOString());const id=s.r.one('SELECT id FROM r4_agendas').id;
 for(let i=0;i<8&&s.e.meetingRow(id).status==='RUNNING';i++)await s.e.meeting(id);
 assert.equal(s.r.rows('SELECT * FROM positions').length,1);const cash=s.r.cash();assert.equal(cash,'104.5');assert.equal(s.r.rows("SELECT * FROM ledger WHERE kind='BUY'").length,1);
 // Simulate the execution-stage replay after a lost response and object reconstruction.
 const row=s.e.meetingRow(id);row.status='RUNNING';row.payload.index=0;row.payload.stage='EXECUTE';row.payload.proposal=JSON.parse(s.r.one('SELECT payload FROM proposals ORDER BY version DESC LIMIT 1').payload);s.e.saveMeeting(row);
 const resumed=new ReformEngine(s.r,env,s.api as any,s.e.azure);await resumed.meeting(id);assert.equal(s.r.cash(),cash);assert.equal(s.r.rows('SELECT * FROM positions').length,1);
 s.api.inspect=async()=>({...s.m,resolved:true,payouts:{YES:'1',NO:'0'},resolution_evidence:{resolved_at:new Date().toISOString()}} as any);
 await resumed.settle();await resumed.settle();assert.equal(s.r.cash(),'115.5');assert.equal(resumed.summary().profit_eur,'5');assert.equal(s.r.rows("SELECT * FROM ledger WHERE kind='SETTLEMENT'").length,1);
});

test('changed facts require new blind forecasts and cannot consume an old approved dossier',async()=>{
 const s=harness();await s.e.prepare('survival-test-shadow','SHADOW');await s.e.start('survival-test-shadow');await s.e.preparePacket(s.m.id,'football');const p=s.r.one('SELECT id FROM r4_packets');await s.e.forecast(p.id,'FOOTBALL');await s.e.slot(new Date().toISOString());const id=s.r.one('SELECT id FROM r4_agendas').id;
 for(let i=0;i<7&&s.e.meetingRow(id).payload.stage!=='EXECUTE';i++)await s.e.meeting(id);
 assert.equal(s.e.meetingRow(id).payload.stage,'EXECUTE');s.api.evidence=async()=>[{id:'changed',url:'https://official.test',title:'New facts',provider:'ESPN',status:'VERIFIED',fetched_at:new Date().toISOString(),text:'{"state":"pre","teams":["Team A","Team B"],"injury":"new"}'}];await s.e.meeting(id);
 assert.equal(s.r.rows('SELECT * FROM positions').length,0);assert.equal(s.r.one('SELECT status FROM proposals').status,'FACTS_CHANGED');assert.ok(s.r.one("SELECT id FROM jobs WHERE id LIKE 'r4:fresh-reforecast:%'"));
});

test('frozen active code blocks decisions but preserves official settlement processing',async()=>{
 const s=harness();await s.e.prepare('survival-test-shadow','SHADOW');await s.e.start('survival-test-shadow');const updated=new ReformEngine(s.r,{...env,CF_VERSION_METADATA:{id:'changed-code'}},s.api as any,s.e.azure);
 await assert.rejects(updated.process({kind:'R4_SCAN',payload:{category:'football',bucket:0}}),/FROZEN_CODE/);await updated.process({kind:'R4_SETTLE',payload:{}});assert.equal(updated.protocolCurrent(),false);
 await assert.rejects(new ReformEngine(repo(),{...env,ALLOW_FIXTURES:'true'}).prepare('real','SHADOW'),/REJECTS_FIXTURE/);
 assert.throws(()=>reformTarget('arbitrary-object',env),/INVALID/);
});

test('protected context survives hundreds of positions and long prose without changing rules, quotes or totals',()=>{
 const m=market(),description='Règle complète importante. '.repeat(400),positions=Array.from({length:400},(_,i)=>({market_id:String(i),status:'PENDING',cost:'2.5',payload:{question:'x'.repeat(500),event_group:'event'+i,category:'football'}}));
 const original={protocol:'reform-v4',market:{...m,description},proposal:{market_id:m.id,side:'YES',amount:'5.5',max_price:'.5'},executable_books:m.books,observations:{extreme:20.6},positions,history:Array.from({length:50},()=>({text:'x'.repeat(1500)})),sources:Array.from({length:8},(_,i)=>({id:'source'+i,text:'x'.repeat(14000)})),independent_forecasts:Array.from({length:5},()=>({...f,rationale:'x'.repeat(1200)})),discussion:Array.from({length:3},()=>({actor:'QUANT',value:{speech:'x'.repeat(1800),objection:'x'.repeat(700)}}))};
 const packed=reformContext(original);assert.ok(JSON.stringify(packed).length<=POLICY.maximumContextChars);assert.equal(packed.market.description,description);assert.deepEqual(packed.proposal,original.proposal);assert.deepEqual(packed.executable_books.YES.asks,m.books.YES!.asks);assert.equal(packed.executable_books.YES.within_voted_limit_quantity,'1000');assert.equal(packed.total_open_cost,'1000');assert.equal(packed.exposure_by_category.football.cost,'1000');assert.equal(packed.observations.extreme,20.6);
});

test('backup and read-only isolated restoration preserve proposals, financial and immutable forecast rows',async()=>{
 const s=harness();await s.e.prepare('survival-test-shadow','SHADOW');s.r.saveForecast('p','QUANT','BEFORE',f);s.r.putProposal({id:'proposal',version:1,market_id:'m',meeting_id:'meeting',side:'YES',amount:'10',max_price:'.5',status:'REFUSED',reason:'reason',created_at:new Date().toISOString()});
 const data=Object.fromEntries(BACKUP_TABLES.map(t=>[t,s.r.rows('SELECT * FROM '+t)])),manifest={state:{run:s.e.run()},tables:Object.fromEntries(BACKUP_TABLES.map(t=>[t,{rows:data[t].length}]))};const target=repo();target.migrateReform();beginRecovery(target,manifest,s.e.run().id);
 for(const t of BACKUP_TABLES){if(data[t].length){await restoreChunk(target,t,0,data[t]);assert.equal((await restoreChunk(target,t,0,data[t])).duplicate,true);}}
 assert.equal(finishRecovery(target).read_only,true);assert.deepEqual(target.rows('SELECT * FROM proposals'),s.r.rows('SELECT * FROM proposals'));assert.throws(()=>target.run("UPDATE r4_forecasts SET at='changed'"),/IMMUTABLE/);await assert.rejects(restoreChunk(target,'ledger',0,[]),/NOT_ACCEPTING/);
});

test('weather corrections replace a report at the same observation time and accept terminal equals',()=>{
 const m={...market(),category:'weather' as const,question:'Will the highest temperature in Wellington be 20°C on November 11?',description:'Routine METAR NZWN.',start_at:'2026-11-10T11:00:00Z'},at=Date.parse('2026-11-11T09:00:00Z');
 const row={icaoId:'NZWN',obsTime:Date.parse('2026-11-11T08:30:00Z')/1000,rawOb:'NZWN 110830Z 22010KT 9999 FEW020 21/15 Q1010=',receiptTime:'2026-11-11T08:31:00Z'};
 const corrected={...row,receiptTime:'2026-11-11T08:35:00Z',rawOb:'NZWN 110830Z COR 22010KT 9999 FEW020 20/15 Q1010='};const result=observations(m,[corrected,row],at);assert.equal(result.rows.length,1);assert.equal(result.extreme,20);assert.equal(result.yes_impossible,false);
 assert.equal(routineTemperature('RJTT 111200Z 00000KT 19/10 Q1010 RMK T01960100=')?.celsius,19.6);
});

test('residual fitting cannot count future labels or many variants as independent station days',()=>{
 const base={station:'NZWN',model:'model-v1',forecast_issued_at:'2026-10-01T00:00:00Z',valid_day:'2026-10-02',lead_hours:24,forecast_c:20,observed_c:21,observed_at:'2026-10-03T00:00:00Z',forecast_source:'https://official.test/forecast',observation_source:'https://official.test/observation',observation_kind:'station-observation' as const};
 const result=fitResiduals([...Array.from({length:200},()=>base),{...base,observed_at:'2027-01-01T00:00:00Z'}],'NZWN',24,'2026-11-01T00:00:00Z');assert.equal(result.n,1);assert.equal(residualProbability(result,20,19.5,20.5).probability,null);
});


test('women Champions League and Brazilian second division use their own verified scoreboard leagues',async()=>{
 const {Markets}=await import('../src/markets');const r=repo();const m={...market(),question:'Juventus FC vs. OL Lyonnes: Both Teams to Score',event_title:'Juventus FC vs. OL Lyonnes',url:'https://polymarket.com/event/uwcl-juv-oly-2026-11-11',start_at:'2026-11-11T20:00:00Z'};
 for(const date of ['20261110','20261111','20261112'])r.putCache('research:https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.wchampions/scoreboard?dates='+date,{fetched_at:new Date().toISOString(),data:{events:[{name:'OL Lyonnes at Juventus',date:'2026-11-11T20:00:00Z',status:{type:{state:'pre'}},competitions:[{competitors:[{team:{displayName:'Juventus'}},{team:{displayName:'OL Lyonnes'}}]}]}]}},900);
 const sources=await new Markets(r).evidence(m);assert.ok(sources.some(s=>s.provider==='ESPN'&&s.status==='VERIFIED'&&s.url.includes('uefa.wchampions')));assert.equal(r.sourceDemands().length,0);
});


test('reform meetings and held funds outrank a backlog while category scans outrank speculative research',()=>{
 const r=repo();r.enqueue('scan','R4_SCAN',{},'2026-01-01T00:00:00Z');r.enqueue('forecast','R4_FORECAST',{},'2026-01-01T00:00:00Z');r.enqueue('meeting','R4_MEETING',{},'2026-01-02T00:00:00Z');r.enqueue('funds','R4_SETTLE',{},'2026-01-03T00:00:00Z');
 assert.equal(r.claim().id,'funds');r.run("UPDATE jobs SET status='DONE' WHERE id='funds'");assert.equal(r.claim().id,'meeting');r.run("UPDATE jobs SET status='DONE' WHERE id='meeting'");assert.equal(r.claim().id,'scan');
});

test('persistent independent absences cancel the reform meeting after one recovery attempt',async()=>{
 const s=harness(),original=s.e.azure.ask.bind(s.e.azure);s.e.azure.ask=(async(...args:any[])=>{if(['QUANT','RISK'].includes(args[1]))throw Error('FIXTURE_PROVIDER_DOWN');return (original as any)(...args);}) as any;
 await s.e.prepare('survival-test-shadow','SHADOW');await s.e.start('survival-test-shadow');await s.e.preparePacket(s.m.id,'football');const p=s.r.one('SELECT id FROM r4_packets');await s.e.forecast(p.id,'FOOTBALL');await s.e.slot(new Date().toISOString());const id=s.r.one('SELECT id FROM r4_agendas').id;
 await s.e.meeting(id);assert.equal(s.e.meetingRow(id).payload.stage,'INDEPENDENT_RETRY');await s.e.meeting(id);assert.equal(s.e.meetingRow(id).status,'CANCELLED');assert.equal(s.r.rows('SELECT * FROM ledger').length,0);assert.equal(s.r.rows('SELECT * FROM votes').length,0);
});

test('a full synthetic week exposes missing hours instead of reporting only successful cycles',()=>{
 const start='2026-11-01T00:00:00Z',end='2026-11-08T00:00:00Z',first=Math.floor(Date.parse(start)/600000),categories=['weather','football','basketball','tennis','esport'];const rows=[];
 for(let i=0;i<1008;i++)for(const category of categories)if(i<300||i>=360)rows.push({bucket:first+i,category,status:'DONE'});
 const result=coverage(start,end,rows,categories);assert.equal(result.expected,1008);assert.equal(result.missing.length,60);assert.ok(result.fraction<.95);
});

test('new routine weather reports do not rebill reasoning for unchanged extremes within the same observation window',async()=>{
 const s=harness(),sources=[{id:'one',url:'https://aviationweather.gov/api/data/metar',title:'Routine',provider:'NOAA AWC',status:'VERIFIED' as const,fetched_at:'2026-11-11T13:00:00Z',text:'raw report 1'}],metar={rules:{station:'NZWN'},extreme:20,yes_impossible:false,latest:'2026-11-11T13:00:00Z'};
 const first=await s.e.factSignature(sources,metar);assert.equal(await s.e.factSignature([{...sources[0],id:'two',text:'raw report 2',fetched_at:'2026-11-11T13:30:00Z'}],{...metar,latest:'2026-11-11T13:30:00Z'}),first);assert.notEqual(await s.e.factSignature(sources,{...metar,extreme:21}),first);assert.notEqual(await s.e.factSignature(sources,{...metar,latest:'2026-11-11T15:00:00Z'}),first);
});


test('active week starts with 1000 euros and can vote and buy without prior qualification',async()=>{
 const s=harness();s.e.env={...env,REFORM_ACTIVE_MODE:'true'};await s.e.prepare('survival-active-test','FULL');assert.equal(s.e.run().policy.requireQualification,false);assert.equal(s.e.qualification().eligible,false);await s.e.start('survival-active-test');assert.equal(s.r.cash(),'1100');assert.ok(s.r.one("SELECT id FROM jobs WHERE json_extract(payload,'$.kickoff')=1"));
 await s.e.preparePacket(s.m.id,'football');const packet=s.r.one('SELECT id FROM r4_packets');await s.e.forecast(packet.id,'FOOTBALL');assert.equal(s.r.packet(packet.id).status,'CANDIDATE');assert.equal(s.e.budget(s.r.packet(packet.id),'YES').maximum,'27.5');
 await s.e.slot(new Date().toISOString(),false,true);const id=s.r.one('SELECT id FROM r4_agendas').id;for(let i=0;i<8&&s.e.meetingRow(id).status==='RUNNING';i++)await s.e.meeting(id);
 assert.equal(s.e.meetingRow(id).status,'COMPLETED');assert.equal(s.r.rows('SELECT * FROM positions').length,1);assert.equal(s.r.cash(),'1072.5');assert.equal(s.e.summary().positions[0].cost_eur,'25');assert.equal(s.e.summary().positions[0].payload.initial_estimated_yes_probability,.7);assert.equal(s.e.summary().meeting_metrics.completed,0,'kickoff is separate from scheduled ordinary meetings');
 const p=s.r.one('SELECT * FROM positions');s.r.settle(p,{...s.m,resolved:true,payouts:{YES:'1',NO:'0'}});assert.equal(s.r.cash(),'1127.5');
});

test('active allocation uses a fixed bounded stake instead of Kelly on an uncalibrated interval',()=>{
 const input={initial:'1000',cash:'1000',spent:'0',clusterCost:'0',elapsedFraction:0,probability:.7,lower:.1,price:'.5',feePerShare:'0',methodQualified:false};
 assert.equal(allowance(input,ACTIVE_POLICY).maximum,'25');assert.equal(allowance({...input,cash:'200'},ACTIVE_POLICY).maximum,'0');assert.equal(allowance({...input,clusterCost:'200'},ACTIVE_POLICY).maximum,'0');assert.equal(allowance({...input,probability:.501},ACTIVE_POLICY).maximum,'0');assert.equal(allowance(input,POLICY).maximum,'0');
});

test('active week does not create a bet or meeting candidate when the estimates offer no executable edge',async()=>{
 const s=harness(),original=s.e.azure.ask.bind(s.e.azure);s.e.env={...env,REFORM_ACTIVE_MODE:'true'};s.e.azure.ask=(async(...args:any[])=>args[2]==='independent_forecast'?{...f,probability:.5,lower:.4,upper:.6}:(original as any)(...args)) as any;
 await s.e.prepare('survival-active-no-edge','FULL');await s.e.start('survival-active-no-edge');await s.e.preparePacket(s.m.id,'football');const packet=s.r.one('SELECT id FROM r4_packets');await s.e.forecast(packet.id,'FOOTBALL');assert.equal(s.r.packet(packet.id).status,'OBSERVING');await s.e.slot(new Date().toISOString());assert.equal(s.r.one('SELECT status FROM r4_agendas').status,'NO_AGENDA');assert.equal(s.r.cash(),'1100');assert.equal(s.r.rows('SELECT * FROM positions').length,0);
});

test('archiving observation retains history and prevents further reasoning jobs without touching the funded run',async()=>{
 const shadow=harness();await shadow.e.prepare('survival-shadow-archive','SHADOW');await shadow.e.start('survival-shadow-archive');await shadow.e.preparePacket(shadow.m.id,'football');const p=shadow.r.one('SELECT id FROM r4_packets');await shadow.e.forecast(p.id,'FOOTBALL');const before=shadow.r.rows('SELECT * FROM r4_forecasts');
 assert.throws(()=>shadow.e.archiveObservation('wrong'),/EXPLICIT/);assert.equal(shadow.e.archiveObservation('survival-shadow-archive').archived,true);shadow.e.tick();assert.equal(shadow.e.run().status,'FINISHED');assert.ok(shadow.e.run().stopped_at);assert.deepEqual(shadow.r.rows('SELECT * FROM r4_forecasts'),before);assert.equal(shadow.r.cash(),'0');assert.equal(shadow.r.rows("SELECT * FROM jobs WHERE status='PENDING' AND kind!='NOTIFY'").length,0);assert.equal(shadow.e.archiveObservation('survival-shadow-archive').duplicate,true);
 const active=harness();active.e.env={...env,REFORM_ACTIVE_MODE:'true'};await active.e.prepare('survival-active-archive-check','FULL');await active.e.start('survival-active-archive-check');assert.throws(()=>active.e.archiveObservation('survival-active-archive-check'),/EXPLICIT/);assert.equal(active.r.cash(),'1100');
});


test('active council can approve the opposite outcome despite specialist opposition after revising its probability',async()=>{
 const s=harness(),original=s.e.azure.ask.bind(s.e.azure);s.e.env={...env,REFORM_ACTIVE_MODE:'true'};
 s.e.azure.ask=(async(...args:any[])=>{const [id,actor,phase,c]=args;
   if(phase==='chair_resolution')return {speech:'Le débat justifie de réviser la probabilité et de soumettre le résultat opposé au vote.',estimated_yes_probability:.3,question:'',question_to:null,amendment:{market_id:c.proposal.market_id,side:'NO',amount:c.proposal.amount,max_price:'.5',reason:'Révision explicite après les objections contradictoires.'},document_requests:[]};
   const v=await (original as any)(...args);return phase==='independent_vote'&&actor==='FOOTBALL'?{...v,vote:'AGAINST'}:v;
 }) as any;
 await s.e.prepare('survival-active-revision','FULL');await s.e.start('survival-active-revision');await s.e.preparePacket(s.m.id,'football');const p=s.r.one('SELECT id FROM r4_packets');await s.e.forecast(p.id,'FOOTBALL');await s.e.slot(new Date().toISOString());const id=s.r.one('SELECT id FROM r4_agendas').id;
 for(let i=0;i<9&&s.e.meetingRow(id).status==='RUNNING';i++)await s.e.meeting(id);
 assert.equal(s.r.rows('SELECT * FROM positions').length,1);assert.equal(s.r.one('SELECT outcome FROM positions').outcome,'NO');assert.equal(s.r.one('SELECT status FROM proposals ORDER BY version DESC LIMIT 1').status,'APPROVED');assert.equal(s.e.summary().positions[0].payload.council_estimated_yes_probability,.3);
});


test('active voted limit tolerates a small real book move but still spends only observed liquidity',async()=>{
 const s=harness();s.e.env={...env,REFORM_ACTIVE_MODE:'true'};await s.e.prepare('survival-active-price-move','FULL');await s.e.start('survival-active-price-move');await s.e.preparePacket(s.m.id,'football');const p=s.r.one('SELECT id FROM r4_packets');await s.e.forecast(p.id,'FOOTBALL');await s.e.slot(new Date().toISOString());const id=s.r.one('SELECT id FROM r4_agendas').id;
 for(let i=0;i<8&&s.e.meetingRow(id).payload.stage!=='EXECUTE';i++)await s.e.meeting(id);assert.equal(s.e.meetingRow(id).payload.proposal.max_price,'0.52');s.m.books.YES!.asks=[{price:'.51',size:'1000'}];await s.e.meeting(id);
 assert.equal(s.r.rows('SELECT * FROM positions').length,1);assert.equal(s.r.one('SELECT price FROM fills').price,'0.51');assert.ok(Number(s.r.one('SELECT cost FROM positions').cost)<=27.5);assert.ok(Number(s.r.cash())>=0);
});
