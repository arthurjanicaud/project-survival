import {test} from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {Engine} from '../src/engine';
import {boundedContext} from '../src/azure';
import {finalResolution,ensembleSummary,sportsFacts} from '../src/markets';
import {factualText,needsReview,sourceFreshness} from '../src/research';
import {execute} from '../src/finance';
import {repository,env,market,book,proposal} from './helpers';

const waiting={speech:'Les informations disponibles ne justifient pas ce prix pour cet événement.',recommendation:'WAIT',estimated_yes_probability:null,confidence:.3,side:null,amount:null,max_price:null,reasoning:'Aucun avantage démontré au prix actuel, sans inventer de statistique.',uncertainty:'Données limitées.',citations:[],urgent:false,urgency_reason:'',lesson:'',document_requests:[]};
function harness(){const r=repository(),m=market();let facts='initial',calls=0;const raw=Array.from({length:8},(_,i)=>({id:'variant'+i,question:'Team A vs Team B',slug:'epl-a-b-'+m.start_at!.slice(0,10)+'-variant'+i,gameStartTime:m.start_at,endDate:m.end_at,outcomes:['Yes','No'],clobTokenIds:['1','2'],active:true,acceptingOrders:true,resolutionSource:'https://official.test',description:'Official match rules',liquidityNum:10000-i,tags:[{slug:'soccer'}]}));const group='epl-a-b-'+m.start_at!.slice(0,10);const service={synthetic:true,fx:async()=>({usd_per_eur:'1.1',reference_date:'2026-11-02',source:'unit fixture',method:'test only'}),catalog:async()=>raw,inspect:async(id:string)=>({...m,id,group,books:{YES:book(),NO:book()}}),evidence:async()=>[{id:'facts-'+facts,url:'https://official.test',title:'Source',text:JSON.stringify({facts}),fetched_at:new Date(Date.now()).toISOString(),status:'VERIFIED',provider:'ESPN'}]};const ai={synthetic:true,ask:async()=>{calls++;return waiting;}};const e=new Engine(r,env,service as any,ai as any);e.prepare('fixture','demo');return {e,r,m,setFacts:(v:string)=>{facts=v;},calls:()=>calls};}

test('wire e6 payouts settle wins, losses and voids; wrong identity/units cannot pay',()=>{
 const raw={conditionId:'known'},row={status:'resolved',condition_id:'known',resolved_at:'2026-11-01T00:00:00Z'};
 assert.equal(finalResolution(raw,[{...row,payouts:[1000000,0]}])?.YES,'1');
 assert.equal(finalResolution(raw,[{...row,payouts:[0,1000000]}])?.NO,'1');
 assert.equal(finalResolution(raw,[{...row,payouts:[500000,500000]}])?.YES,'0.5');
 for(const invalid of [{...row,payouts:[1,0]},{...row,payouts:[1000000,1000000]},{...row,payouts:[0,1000000],condition_id:'other'},{status:'resolved',resolved_at:row.resolved_at,payouts:[0,1000000]},{...row,status:'proposed',payouts:[0,1000000]}])assert.equal(finalResolution(raw,[invalid]),null);
});

test('held money is checked before a 600-market hypothetical backlog and pays once',async()=>{
 const s=harness();await s.e.start();s.r.putMarket(s.m);const p=proposal(),ex=execute(book(),'10','.55',new Date().toISOString());s.r.buy(p,s.m,ex,'Unit fixture');
 for(let i=0;i<600;i++)s.r.run("INSERT INTO counterfactuals VALUES(?,?,'PENDING',?)",'cf'+i,'other'+i,JSON.stringify({execution:{fills:[],quantity:'0',spent:'0'},side:'YES',estimated_yes_probability:null,reason:'fixture'}));
 const seen:string[]=[];s.e.markets.inspect=async(id:string)=>{seen.push(id);return {...s.m,id,resolved:id===s.m.id,payouts:id===s.m.id?{YES:'1',NO:'0'}:null,resolution_evidence:{resolved_at:'2026-11-01T00:00:00Z'}};};
 await s.e.settlements();assert.equal(seen[0],s.m.id);assert.equal(seen.length,11);assert.equal(s.r.cash(),'1110');await s.e.settlements();assert.equal(s.r.cash(),'1110');assert.equal(s.r.one("SELECT count(*) n FROM ledger WHERE kind='SETTLEMENT'").n,1);
});

test('eight child markets and refreshed timestamps need only one unchanged fixture analysis',async()=>{
 const s=harness();await s.e.start();s.r.run("UPDATE jobs SET status='DONE'");
 const prepare=async()=>{const j=s.r.claim();assert.equal(j?.kind,'PREPARE_FIXTURE');await s.e.process(j);s.r.complete(j);};
 await s.e.scan('football');await prepare();const id=s.r.one('SELECT id FROM dossiers').id;await s.e.analyze(id);s.r.run("UPDATE jobs SET status='DONE'");
 const clock=Date.now;try{const start=clock();for(let i=1;i<=12;i++){Date.now=()=>start+i*600000;await s.e.scan('football');await prepare();}assert.equal(s.calls(),1);assert.equal(s.r.one('SELECT count(*) n FROM dossiers').n,1);
 Date.now=()=>start+140*60000;s.setFacts('important new confirmed fact');await s.e.scan('football');await prepare();await s.e.analyze(id);assert.equal(s.calls(),2);}finally{Date.now=clock;}

});

test('cache refresh alone is not evidence, but price movement and verified feedback reopen review',()=>{
 const old={market_id:'m',at:new Date(Date.now()-3*3600000).toISOString(),facts:'same',price:'.4',status:'WAIT',lesson_seq:2};
 assert.equal(needsReview(old,'same','.4'),false);assert.equal(needsReview(old,'new','.4'),true);assert.equal(needsReview(old,'same','.46'),true);assert.equal(needsReview(old,'same','.4',Date.now(),3),true);
 assert.equal(factualText('{"updated":"a","score":2}'),factualText('{"updated":"b","score":2}'));
});

test('one fixture analysis can choose a quoted alternative without applying its stake to the wrong market',async()=>{
 const s=harness();await s.e.start();s.r.run("UPDATE jobs SET status='DONE'");await s.e.scan('football');const job=s.r.claim();await s.e.process(job);s.r.complete(job);const first=s.r.one('SELECT id FROM dossiers').id;
 s.e.azure.ask=(async()=>({...waiting,market_id:'variant1',recommendation:'PROPOSE',side:'YES',amount:'20',max_price:'.55',estimated_yes_probability:.6})) as any;
 await s.e.analyze(first);assert.equal(s.r.dossier('variant1').status,'PROPOSED');assert.equal(s.r.dossier(first).status,'RESEARCH_REFERENCE');assert.equal(s.r.dossier('variant1').payload.reference_price,'.5');assert.equal(s.r.one('SELECT count(*) n FROM positions').n,0);
});

test('a model cannot select a market outside the observed alternatives',async()=>{
 const s=harness();await s.e.start();s.r.run("UPDATE jobs SET status='DONE'");await s.e.scan('football');const job=s.r.claim();await s.e.process(job);s.r.complete(job);const first=s.r.one('SELECT id FROM dossiers').id;
 s.e.azure.ask=(async()=>({...waiting,market_id:'not-observed'})) as any;await assert.rejects(s.e.analyze(first),/UNKNOWN_SELECTED_MARKET/);assert.equal(s.r.one('SELECT count(*) n FROM positions').n,0);
});

test('urgent=false cannot make a near-deadline proposal wait overnight; requests coalesce',async()=>{
 const s=harness();await s.e.start();s.r.run("UPDATE jobs SET status='DONE'");s.r.putMarket({...s.m,start_at:new Date(Date.now()+30000).toISOString()});
 const d={id:s.m.id,market_id:s.m.id,category:'football',priority:0,hash:'x',status:'PROPOSED',payload:{analysis:{...waiting,recommendation:'PROPOSE',urgent:false}}};s.r.putDossier(d);
 s.e.emergency(d,'Calendar deadline');s.e.emergency(d,'Another dossier');const jobs=s.r.rows("SELECT payload FROM jobs WHERE kind='EMERGENCY' AND status='PENDING'");assert.equal(jobs.length,1);assert.equal(JSON.parse(jobs[0].payload).id,undefined);
});

test('own opinions returned by the secretary do not trigger a second reasoning call',async()=>{
 const s=harness();s.r.event('past','SPEECH','Les Celtics avaient un avantage de coût annoncé.','QUANT','older');let calls=0;s.e.azure.ask=(async()=>{calls++;return {...waiting,document_requests:['archives Celtics avantage coût']};}) as any;
 await s.e.ask('one','FOOTBALL','analysis',{sources:[],memory:[]},z.any());assert.equal(calls,1);
});

test('a genuinely new official outcome remains retrievable and can inform one followup',async()=>{
 const s=harness();s.r.event('past','LESSON','Les Celtics ont perdu ; résultat officiel conservé.','SECRETARY','older',{result:{YES:'0',NO:'1'},category:'basketball'});let calls=0;s.e.azure.ask=(async()=>{calls++;return {...waiting,document_requests:calls===1?['historique Celtics perdu résultat']:[]};}) as any;
 await s.e.ask('one','FOOTBALL','analysis',{sources:[],memory:[]},z.any());assert.equal(calls,2);
});

test('a bad citation gets one explicit repair rather than an executable unverified answer',async()=>{
 const s=harness();let calls=0;s.e.azure.ask=(async()=>{calls++;return {...waiting,citations:calls===1?[{source_id:'x',quote:'A quote that was never supplied'}]:[]};}) as any;
 const v=await s.e.ask('one','FOOTBALL','analysis',{sources:[]},z.any());assert.equal(calls,2);assert.deepEqual(v.citations,[]);
});

test('fresh pre-match data is not falsely accepted as a live score',()=>{
 const m={...market(),start_at:new Date(Date.now()-60000).toISOString()},base={id:'s',url:'https://test',title:'feed',fetched_at:new Date().toISOString(),status:'VERIFIED' as const,provider:'ESPN'};
 assert.equal(sourceFreshness(m,[{...base,text:'{"status":{"state":"pre"}}'}]).fresh,false);
 assert.equal(sourceFreshness(m,[{...base,text:'{"status":{"state":"in"}},"score":1'}]).fresh,true);
 assert.equal(sourceFreshness(m,[{...base,fetched_at:new Date(Date.now()-3600000).toISOString(),text:'{"status":{"state":"in"}}'}]).fresh,false);
});

test('ensemble summaries retain observed member spread without inventing calibrated probabilities',()=>{
 const s=ensembleSummary({timezone:'Asia/Shanghai',daily_units:{temperature_2m_max:'°C'},daily:{time:['2026-11-03'],temperature_2m_max:[18],temperature_2m_max_member01:[20],temperature_2m_max_member02:[null]}},'2026-11-03');assert.equal(s!.maximum!.members,2);assert.equal(s!.maximum!.min,18);assert.equal(s!.maximum!.max,20);assert.match(s!.limitation,/uncalibrated/);assert.equal(ensembleSummary({daily:{time:[]}},'2026-11-03'),null);
});

test('sports packets preserve both opponents, typed records, actual scores and clock',()=>{
 const x=sportsFacts({name:'A vs B',status:{type:{state:'in'},period:2,displayClock:'12:30'},competitions:[{competitors:[{team:{displayName:'A'},score:'1',records:[{type:'total',summary:'ambiguous',stats:[{name:'wins',value:2}]}]},{team:{displayName:'B'},score:'0'}]}]});assert.equal(x.competitors.length,2);assert.equal(x.competitors[0].records[0].statistics[0].name,'wins');assert.equal(x.competitors[1].score,'0');assert.equal(x.status.display_clock,'12:30');
});

test('context packing keeps complete category exposure and names the correlated positions',()=>{
 const positions=Array.from({length:80},(_,i)=>({market_id:'m'+i,status:'PENDING',cost:'10',quantity:'20',outcome:'YES',payload:{question:'A factual market '+i,category:'football',event_group:i===79?'target':'other'}}));
 const packed=boundedContext({market:{group:'target',description:'rules'},positions});assert.equal(packed.exposure_by_category.football.count,80);assert.equal(packed.exposure_by_category.football.cost,'800');assert.equal(packed.positions[0].question,'A factual market 79');
});
