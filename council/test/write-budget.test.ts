import {test} from 'node:test';
import assert from 'node:assert/strict';
import {repository,env,market,book,proposal} from './helpers';
import {ReformRepository} from '../src/reform/store';
import {ReformEngine} from '../src/reform/engine';
import {recordJobIncident,deliverNotificationJob} from '../src/reform/incidents';
import {execute} from '../src/finance';
function repo(){const base=repository(),r=new ReformRepository(base.sql,base.atomic);r.migrateReform();return r;}

test('repeated event IDs do not write or advance the AUTOINCREMENT sequence',()=>{
 const r=repo();r.event('same','INCIDENT','Incident observé.');const writes=r.writes;
 for(let i=0;i<1000;i++)r.event('same','INCIDENT','Incident observé.');
 assert.equal(r.writes,writes);assert.equal(r.one("SELECT seq FROM sqlite_sequence WHERE name='events'").seq,1);
 assert.equal(r.one('SELECT count(*) n FROM events').n,1);
});

test('notification delivery errors cannot grow another notification/job tree',async()=>{
 const r=repo();let sends=0;
 const first={id:'market-analysis',kind:'R4_FORECAST',attempt:1,payload:{}};
 recordJobIncident(r,first,'PROVIDER_DOWN','https://example.com');
 assert.equal(r.one('SELECT count(*) n FROM notifications').n,1);
 const n=r.one('SELECT id FROM notifications');
 for(let attempt=1;attempt<=3;attempt++)recordJobIncident(r,{id:'notify:'+n.id,kind:'NOTIFY',attempt,payload:{id:n.id}},'NOTIFICATION_RELAY_HTTP_404','https://example.com');
 assert.equal(r.one('SELECT count(*) n FROM notifications').n,1);
 assert.equal(r.one('SELECT count(*) n FROM jobs').n,1);
 await deliverNotificationJob('github-relay',{payload:{id:n.id}},async()=>{sends++;throw Error('Should not dispatch');});assert.equal(sends,0);
 await deliverNotificationJob('direct',{payload:{id:n.id}},async(id)=>{assert.equal(id,n.id);sends++;});assert.equal(sends,1);
});

test('recursive legacy notices cannot wake alarms or starve valid jobs',()=>{
 const r=repo();for(let i=0;i<1000;i++)r.enqueue('notify:r4:incident:notify:'+i,'NOTIFY',{},'2020-01-01T00:00:00Z');
 r.enqueue('valid-settlement','R4_SETTLE',{},'2021-01-01T00:00:00Z');assert.equal(r.nextJobAt(),'2021-01-01T00:00:00Z');
 const job=r.claim();assert.equal(job.id,'valid-settlement');r.complete(job);
 assert.equal(r.claim(),null);assert.equal(r.nextJobAt(),null);
 assert.equal(r.one("SELECT count(*) n FROM jobs WHERE status='PENDING'").n,1000); // preserved audit, no bulk deletion
});

test('expired cache cleanup is bounded and does not run on every heartbeat',()=>{
 const r=repo();for(let i=0;i<1000;i++)r.run('INSERT INTO transient_cache VALUES(?,?,?)','expired'+i,'2000-01-01T00:00:00Z','{}');
 r.prune();assert.equal(r.one('SELECT count(*) n FROM transient_cache').n,900);const writes=r.writes;
 for(let i=0;i<1000;i++)r.prune();assert.equal(r.writes,writes);
});

test('write repair adopts only the authorized previous version and preserves financial state',async()=>{
 const r=repo(),oldEnv={...env,REFORM_ACTIVE_MODE:'true',CF_VERSION_METADATA:{id:'c85214f3-946f-441b-bbd3-316f16ea4b0f'}};
 const api={fx:async()=>({usd_per_eur:'1.1127',reference_date:'2026-11-11',source:'TEST',method:'TEST'})};const old=new ReformEngine(r,oldEnv,api as any);await old.prepare('survival-004-active','FULL');await old.start('survival-004-active');
 r.buy({...proposal(),amount:'10'},market(),execute(book(),'10','.5',new Date().toISOString()),'Test');
 const before=structuredClone(old.run()),financial=JSON.stringify([r.rows('SELECT * FROM ledger'),r.rows('SELECT * FROM positions'),r.rows('SELECT * FROM fills')]);
 const fixedEnv={...oldEnv,REFORM_TECHNICAL_FIX:'write-opt-20261113',CF_VERSION_METADATA:{id:'write-fixed'}};
 const fixed=new ReformEngine(r,fixedEnv,api as any);await fixed.prepare('survival-004-active','FULL');
 assert.equal(fixed.protocolCurrent(),true);assert.equal(fixed.run().started_at,before.started_at);assert.equal(fixed.run().end_at,before.end_at);assert.equal(fixed.run().policy_hash,before.policy_hash);
 assert.equal(JSON.stringify([r.rows('SELECT * FROM ledger'),r.rows('SELECT * FROM positions'),r.rows('SELECT * FROM fills')]),financial);
 const future=new ReformEngine(r,{...fixedEnv,CF_VERSION_METADATA:{id:'unapproved-future'}},api as any);await future.prepare('survival-004-active','FULL');assert.equal(future.protocolCurrent(),false);
});
