import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {repository,env,market,book,proposal} from './helpers';
import {ReformRepository} from '../src/reform/store';
import {ReformEngine} from '../src/reform/engine';
import {POLICY} from '../src/reform/policy';
import {execute} from '../src/finance';
import {researchPermit,quotaResponse,nextUtcReset,storageQuotaError,knownStoragePause} from '../src/reform/read-budget';
function repo(){const base=repository(),r=new ReformRepository(base.sql,base.atomic);r.migrateReform();return r;}

test('event history is batched and cached; dashboard and scheduler use their limiting indexes',()=>{
 const r=repo();for(let i=0;i<300;i++)r.run('INSERT INTO r4_packets VALUES(?,?,?,?,?,?,?)','p'+i,'m'+i,'weather','event'+(i%30),String(i).padStart(6,'0'),'PREPARED','{}');
 const original=r.sql.exec.bind(r.sql);let batches=0;r.sql.exec=(q:string,...args:any[])=>{if(q==='SELECT event_id,max(at) at FROM r4_packets GROUP BY event_id')batches++;return original(q,...args);};
 const reviews=r.eventReviews();assert.equal(reviews.size,30);assert.equal(reviews.get('event1'),'000271');r.eventReviews();assert.equal(batches,1);
 const plan=(q:string,...args:any[])=>r.rows('EXPLAIN QUERY PLAN '+q,...args).map(x=>x.detail).join(' ');
 assert.match(plan('SELECT max(at) FROM r4_packets WHERE event_id=?','event1'),/r4_packets_event/);assert.match(plan('SELECT * FROM r4_packets ORDER BY at DESC LIMIT 60'),/r4_packets_at/);
 assert.match(plan("SELECT due_at FROM jobs WHERE status='PENDING' ORDER BY due_at LIMIT 1"),/jobs_due/);
 r.enqueue('future','R4_SLOT',{},'2030-01-01T00:00:00Z');r.enqueue('now','R4_SCAN',{},'2026-01-01T00:00:00Z');assert.equal(r.nextJobAt(),'2026-01-01T00:00:00Z');
});

test('real SQLite VM work falls sharply for batched research, indexed dashboard and indexed scheduling',()=>{
 const r=repo(),schema=r.rows("SELECT name,type,sql FROM sqlite_master WHERE tbl_name IN ('r4_packets','jobs') AND sql IS NOT NULL ORDER BY type DESC");
 const code=`import json,sqlite3,sys
s=json.load(sys.stdin);c=sqlite3.connect(':memory:')
for x in s:
 if x['type']=='table':c.execute(x['sql'])
existing=['r4_packets_market','r4_packets_status','jobs_due','jobs_lease']
for x in s:
 if x['name'] in existing:c.execute(x['sql'])
c.executemany('INSERT INTO r4_packets VALUES(?,?,?,?,?,?,?)',[(str(i),str(i),'weather','e'+str(i%1000),str(i).zfill(8),'PREPARED','{}') for i in range(5000)])
c.executemany('INSERT INTO jobs(id,kind,due_at,status,payload) VALUES(?,?,?,?,?)',[(str(i),'R4_SLOT',str(i).zfill(8),'PENDING','{}') for i in range(5000)])
def work(queries):
 n=[0]
 def step():n[0]+=1;return 0
 c.set_progress_handler(step,100)
 for sql,args in queries:c.execute(sql,args).fetchall()
 c.set_progress_handler(None,0);return n[0]*100+100
old=work([('SELECT max(at) FROM r4_packets WHERE event_id=?',('e'+str(i),)) for i in range(1000)])
old_ui=work([('SELECT * FROM r4_packets ORDER BY at DESC LIMIT 60',())])
old_arm=work([("SELECT min(CASE WHEN status='RUNNING' THEN lease_until ELSE due_at END) FROM jobs WHERE status IN ('PENDING','RUNNING')",())])
for x in s:
 if x['type']=='index' and x['name'] not in existing:c.execute(x['sql'])
new=work([('SELECT event_id,max(at) FROM r4_packets GROUP BY event_id',())])
new_ui=work([('SELECT * FROM r4_packets ORDER BY at DESC LIMIT 60',())])
new_arm=work([("SELECT due_at FROM jobs WHERE status='PENDING' ORDER BY due_at LIMIT 1",()),("SELECT lease_until FROM jobs WHERE status='RUNNING' AND lease_until IS NOT NULL ORDER BY lease_until LIMIT 1",())])
print(json.dumps({'research':[old,new],'dashboard':[old_ui,new_ui],'scheduler':[old_arm,new_arm]}))`;
 const python=process.platform==='win32'?resolve('..','.venv','Scripts','python.exe'):'python3';
 const costs=JSON.parse(execFileSync(python,['-c',code],{input:JSON.stringify(schema),encoding:'utf8'}));
 for(const [name,[before,after]] of Object.entries(costs) as [string,[number,number]][])assert.ok(before>after*20,name+': '+before+' -> '+after);
 console.log('SQLite VM work (synthetic 5000-row dataset; not Cloudflare billing): '+JSON.stringify(costs));
});

test('read pressure keeps a fair research stream, preserves finance, and never resets usage',()=>{
 const r=repo(),at=Date.parse('2026-11-12T09:00:00Z'),day='2026-11-12';r.run('INSERT INTO r4_usage VALUES(?,?,?,?)',day,4100000,0,1);
 for(const category of ['weather','football','basketball','tennis','esport'])assert.equal(researchPermit(r,{kind:'R4_SCAN',payload:{category}},POLICY,at).allowed,true);
 assert.equal(researchPermit(r,{kind:'R4_SCAN',payload:{category:'weather'}},POLICY,at).allowed,false);
 assert.equal(researchPermit(r,{kind:'R4_FORECAST',payload:{actor:'WEATHER'}},POLICY,at).allowed,true);
 r.run('UPDATE r4_usage SET reads=4600000');assert.equal(researchPermit(r,{kind:'R4_SCAN',payload:{category:'weather'}},POLICY,at).allowed,false);assert.equal(researchPermit(r,{kind:'R4_SETTLE',payload:{}},POLICY,at).allowed,true);
 assert.equal(researchPermit(r,{kind:'R4_SCAN',payload:{category:'weather'}},POLICY,at+86400000).allowed,true);assert.equal(r.one('SELECT reads FROM r4_usage WHERE day=?',day).reads,4600000);
});

test('technical repair adopts exactly the authorized old build without changing the fund or deadline',async()=>{
 const r=repo(),oldEnv={...env,REFORM_ACTIVE_MODE:'true',CF_VERSION_METADATA:{id:'5e038186-a995-46d3-8bd6-28b9e43df491'}};
 const api={fx:async()=>({usd_per_eur:'1.1',reference_date:'2026-11-11',source:'TEST',method:'TEST'})};const old=new ReformEngine(r,oldEnv,api as any);await old.prepare('survival-004-active','FULL');await old.start('survival-004-active');
 assert.equal(old.run().policy_hash,'bf727ff20cdb97d8893b413bbfdc0df3a94d3900dcf207869f8f46b6d9cb3cff');
 const p={...proposal(),amount:'10'},m=market();r.buy(p,m,execute(book(),'10','.5',new Date().toISOString()),'Test');r.run("INSERT INTO r4_usage VALUES('2026-11-12',4270000,23000,1000)");
 const financial=JSON.stringify([r.rows('SELECT * FROM ledger'),r.rows('SELECT * FROM positions'),r.rows('SELECT * FROM fills')]),before=structuredClone(old.run());
 const fixed=new ReformEngine(r,{...oldEnv,CF_VERSION_METADATA:{id:'read-fixed-build'},REFORM_TECHNICAL_FIX:'read-opt-20261112'},api as any);await fixed.prepare('survival-004-active','FULL');
 assert.equal(fixed.protocolCurrent(),true);assert.equal(fixed.run().started_at,before.started_at);assert.equal(fixed.run().end_at,before.end_at);assert.equal(fixed.run().policy_hash,before.policy_hash);assert.equal(JSON.stringify([r.rows('SELECT * FROM ledger'),r.rows('SELECT * FROM positions'),r.rows('SELECT * FROM fills')]),financial);assert.equal(r.one("SELECT reads FROM r4_usage WHERE day='2026-11-12'").reads,4270000);
 const future=new ReformEngine(r,{...oldEnv,CF_VERSION_METADATA:{id:'unapproved-future-build'},REFORM_TECHNICAL_FIX:'read-opt-20261112'},api as any);await future.prepare('survival-004-active','FULL');assert.equal(future.protocolCurrent(),false);
});

test('incident journal latches until actual recovery and does not duplicate the external watchdog alerts',async()=>{
 const r=repo(),e=new ReformEngine(r,env);await e.prepare('survival-watch-test','SHADOW');const run=e.run();run.status='RUNNING';run.started_at='2026-01-01T00:00:00Z';run.last_scan=run.started_at;r.set('reform_run',run);const state=r.state()!;state.betting_deadline='2030-01-01T00:00:00Z';r.save(state);
 e.watch();e.watch();e.watch();assert.equal(r.one("SELECT count(*) n FROM events WHERE kind='INCIDENT'").n,1);assert.equal(r.one('SELECT count(*) n FROM notifications').n,0);
 run.last_scan=new Date().toISOString();r.set('reform_run',run);e.watch();e.watch();assert.equal(r.one("SELECT count(*) n FROM events WHERE kind='RECOVERY'").n,1);assert.equal(r.one('SELECT count(*) n FROM notifications').n,0);
});

test('quota response exposes a provider reset, not a fictitious healthy balance or an SQL stack',async()=>{
 const at=Date.parse('2026-11-12T08:00:00Z'),r=quotaResponse(at),b=await r.json() as any;assert.equal(r.status,503);assert.equal(r.headers.get('Retry-After'),'300');assert.equal(b.quota_reset_at,'2026-11-13T00:00:00.000Z');assert.equal(b.state,undefined);assert.equal(storageQuotaError(Error('Exceeded allowed rows read in Durable Objects free tier.')),true);assert.equal(nextUtcReset(at),Date.parse(b.quota_reset_at));
});


test('score cache reuses resolved evaluations and invalidates when a late forecast can change them',async()=>{
 const r=repo(),e=new ReformEngine(r,env);await e.prepare('survival-score-cache','SHADOW');
 for(let i=0;i<2;i++){r.run('INSERT INTO r4_packets VALUES(?,?,?,?,?,?,?)','p'+i,'m'+i,'football','e'+i,'2026-01-01T00:00:00Z','SETTLED',JSON.stringify({baseline:{probability:.5},market:{}}));r.run('INSERT INTO r4_outcomes VALUES(?,?,?,?,?)','m'+i,'e'+i,'2026-01-02T00:00:00Z','2026-01-02T00:00:00Z',JSON.stringify({resolved_at:'2026-01-02T00:00:00Z',payouts:{YES:'1',NO:'0'}}));}
 const original=r.sql.exec.bind(r.sql);let queries=0;r.sql.exec=(q:string,...args:any[])=>{if(q.includes('FROM r4_forecasts f JOIN r4_packets'))queries++;return original(q,...args);};
 r.saveForecast('p0','FOOTBALL','BEFORE',{probability:.7,method_id:'judgement'},'2026-01-01T00:00:00Z');assert.equal(e.scored().length,1);assert.equal(e.scored().length,1);assert.equal(queries,1);
 r.saveForecast('p1','FOOTBALL','BEFORE',{probability:.8,method_id:'judgement'},'2026-01-01T00:00:00Z');assert.equal(e.scored().length,2);assert.equal(queries,2);
});


test('known provider quota pause expires automatically at the reset, without changing stored counters',()=>{
 const reset='2026-11-13T00:00:00Z';assert.equal(knownStoragePause(reset,Date.parse('2026-11-12T23:59:59Z')),true);assert.equal(knownStoragePause(reset,Date.parse(reset)),false);assert.equal(knownStoragePause(reset,Date.parse('2026-11-13T00:05:00Z')),false);assert.equal(knownStoragePause(undefined),false);
});
