import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {seal,open,snapshot} from '../src/node/persistence';
import {storage} from '../src/node/storage';
import {ReformRepository} from '../src/reform/store';
import {ReformEngine} from '../src/reform/engine';
import {researchPermit} from '../src/reform/read-budget';
import {env} from './helpers';
test('Encrypted SQLite snapshot authenticates key, scope and bytes',()=>{
 const key=Buffer.alloc(32,7),data=Buffer.from('actual account backup'),b=seal(data,'full',key);
 assert.deepEqual(open(b,'full',key),data);assert.throws(()=>open(b,'pilot',key));assert.throws(()=>open(b,'full',Buffer.alloc(32,8)));b[b.length-1]^=1;assert.throws(()=>open(b,'full',key));
});
test('Disk restart retains append-only ledger, unique fill and expired job lease',()=>{
 const dir=mkdtempSync(join(tmpdir(),'survival-node-'));try{
  const path=join(dir,'fund.sqlite');let s=storage(path),r=new ReformRepository(s.sql,s.atomic);r.migrateReform();r.run('INSERT INTO ledger VALUES(?,?,?,?,?)','initial','2026-01-01','INITIAL','1000','fund');
  r.enqueue('job','R4_SETTLE',{});const job=r.claim();assert.ok(job);r.run("UPDATE jobs SET lease_until='2000-01-01' WHERE id='job'");
  const b=snapshot(s.db,path);s.db.close();writeFileSync(join(dir,'restored.sqlite'),b);s=storage(join(dir,'restored.sqlite'));r=new ReformRepository(s.sql,s.atomic);assert.equal(r.cash().toString(),'1000');assert.equal(r.claim()?.id,'job');
  assert.throws(()=>r.run("UPDATE ledger SET amount='0'"),/APPEND_ONLY/);assert.throws(()=>r.run('INSERT INTO ledger VALUES(?,?,?,?,?)','initial','2026-01-01','INITIAL','1000','fund'));s.db.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('Node backend readiness needs five actual dossiers but never Cloudflare account metrics',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'survival-ready-'));try{const s=storage(join(dir,'fund.sqlite')),r=new ReformRepository(s.sql,s.atomic);r.migrateReform();r.set('runtime:backend','github-sqlite');const e=new ReformEngine(r,{...env,STORAGE_BACKEND:'github-sqlite',REFORM_IMPROVEMENTS:'true'});await e.prepare('survival-node-test','PILOT');assert.equal(e.readiness().ready,false);
 for(const c of ['weather','football','basketball','tennis','esport'])r.set('r4:preflight:'+c,{at:new Date().toISOString(),pipeline_ready:true,usable:1});assert.equal(e.readiness().ready,true);
 r.run('INSERT INTO r4_usage VALUES(?,?,?,?)',new Date().toISOString().slice(0,10),999999999,999999999,1);assert.equal(researchPermit(r,{kind:'R4_SCAN',payload:{}},e.run().policy).allowed,true);assert.equal(r.cash().toString(),'0');assert.equal(e.run().started_at,null);s.db.close();}finally{rmSync(dir,{recursive:true,force:true});}
});

test('Local host denies admin access and START; a restart never credits a fund',async()=>{
 const {host}=await import('../src/node/host');const dir=mkdtempSync(join(tmpdir(),'survival-host-'));process.env.COUNCIL_ADMIN_TOKEN='test-local-admin';process.env.COUNCIL_NO_LLM='true';const port=18970+Math.floor(Math.random()*100);
 try{for(let run=0;run<2;run++){const task=host({dataDir:dir,seconds:2,port,publish:false});let ready=false;for(let n=0;n<100;n++){try{const r=await fetch('http://127.0.0.1:'+port+'/api/health');if(r.ok){const b:any=await r.json();assert.equal(b.state.started_at,null);ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,20));}assert.ok(ready);
  const denied=await fetch('http://127.0.0.1:'+port+'/admin/start',{method:'POST'});assert.equal(denied.status,401);const blocked=await fetch('http://127.0.0.1:'+port+'/admin/start',{method:'POST',headers:{Authorization:'Bearer test-local-admin'}});assert.equal(blocked.status,403);await task;
 }const s=storage(join(dir,'full.sqlite'));assert.equal(s.db.prepare('SELECT count(*) n FROM ledger').get()!.n,0);s.db.close();}finally{rmSync(dir,{recursive:true,force:true});}
});

test('Node fetches a missing sports feed directly and shares its real timestamp; Worker still defers to collector',async()=>{
 const {Markets}=await import('../src/markets'),dir=mkdtempSync(join(tmpdir(),'survival-source-'));try{const s=storage(join(dir,'fund.sqlite')),r=new ReformRepository(s.sql,s.atomic);r.migrateReform();let calls=0;const url='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261124';const m=new Markets(r,async()=>{calls++;return Response.json({events:[{id:'observed'}]});});
 await assert.rejects(()=>m.get(url),/SHARED_RESEARCH_FEED/);assert.equal(calls,0);r.set('runtime:backend','github-sqlite');const first=await m.get(url);const at=r.cache<any>('research:'+url)!.fetched_at;assert.equal(first.events[0].id,'observed');await m.get(url);assert.equal(calls,1);assert.equal(r.cache<any>('research:'+url)!.fetched_at,at);assert.equal(r.sourceDemands().length,0);r.putCache('research:'+url,{fetched_at:new Date(Date.now()-360000).toISOString(),data:{events:[{id:'old'}]}},900);await m.get(url,900,300);assert.equal(calls,2);s.db.close();}finally{rmSync(dir,{recursive:true,force:true});}
});
