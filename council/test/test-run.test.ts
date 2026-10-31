import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Engine} from '../src/engine';
import {boardTarget} from '../src/routing';
import {env,repository} from './helpers';
const config={...env,EXPERIMENT_ID:'survival-003',TEST_EXPERIMENT_ID:'test-20261031-24h'};

test('public selector can only reach the configured test, never arbitrary objects',()=>{
  assert.deepEqual(boardTarget(new URL('https://unit/api/state'),false,config),{id:'survival-003',mode:'live'});
  assert.deepEqual(boardTarget(new URL('https://unit/api/ws?experiment=test'),false,config),{id:'test-20261031-24h',mode:'test'});
  assert.deepEqual(boardTarget(new URL('https://unit/api/state?instance=validation-secret'),false,config),{id:'survival-003',mode:'live'});
  assert.throws(()=>boardTarget(new URL('https://unit/admin/start?instance=test-invented'),true,config),/INVALID_INSTANCE/);
  assert.throws(()=>boardTarget(new URL('https://unit/api/state?experiment=validation-secret'),false,config),/INVALID_EXPERIMENT_SELECTOR/);
  assert.throws(()=>boardTarget(new URL('https://unit/api/state?experiment=test'),false,env),/TEST_NOT_CONFIGURED/);
});

test('24-hour test starts once, schedules itself, and leaves official capital untouched',async()=>{
  const official=repository(),testRepo=repository();
  const sources={fx:async()=>({usd_per_eur:'1.1',reference_date:'2026-10-31',source:'unit-test',method:'fixture used only by unit test'})};
  const real=new Engine(official,config,sources as any,{} as any),trial=new Engine(testRepo,config,sources as any,{} as any);
  real.prepare();trial.prepare(config.TEST_EXPERIMENT_ID,'test');
  testRepo.set('preflight',{at:new Date().toISOString(),azure_ok:true,all_categories_ready:true});
  const state=await trial.start();
  assert.equal(Date.parse(state.end_at!)-Date.parse(state.started_at!),86400000);
  assert.equal(Date.parse(state.end_at!)-Date.parse(state.betting_deadline!),6*3600000);
  assert.equal(testRepo.cash(),'1100');assert.equal(official.cash(),'0');
  assert.equal(official.state()!.status,'READY');assert.equal(official.state()!.started_at,null);
  assert.equal(official.one('SELECT count(*) n FROM calls').n,0);
  assert.ok(testRepo.one("SELECT id FROM jobs WHERE kind='SCAN' AND status='PENDING'"));
  assert.ok(testRepo.one("SELECT id FROM jobs WHERE kind='SLOT' AND json_extract(payload,'$.kind')='TEST'"));
  assert.equal(trial.summary().config.durationHours,24);
  await assert.rejects(trial.start(),/START_IS_NEVER_A_RESET/);
  const notice=JSON.parse(testRepo.one('SELECT payload FROM notifications').payload);
  assert.match(notice.title,/^\[TEST 24H\]/);assert.equal(new URL(notice.url).searchParams.get('experiment'),'test');
});

test('test notifications and archived memory links stay inside the test dashboard',()=>{
  const r=repository(),e=new Engine(r,config);e.prepare(config.TEST_EXPERIMENT_ID,'test');
  r.notify('incident','Incident','No real order.','https://project-survival.pages.dev/?phase=3&meeting=one',4);
  const n=JSON.parse(r.one('SELECT payload FROM notifications').payload);
  assert.equal(new URL(n.url).searchParams.get('meeting'),'one');assert.equal(new URL(n.url).searchParams.get('experiment'),'test');
  r.event('memory-test','LESSON','Information météo confirmée et conservée pour le prochain conseil.','WEATHER','one');
  const found=r.retrieve('météo');assert.ok(found.length);assert.ok(found.every(d=>new URL(d.url).searchParams.get('experiment')==='test'));
});
