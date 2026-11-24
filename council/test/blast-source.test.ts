import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {blastTimeline,blastFacts} from '../src/blast';
import {Markets} from '../src/markets';
import {market,repository} from './helpers';
import {quality} from '../src/reform/evidence';
import {ACTIVE_POLICY} from '../src/reform/policy';
const html=readFileSync(new URL('./fixtures/blast-dota.html',import.meta.url),'utf8'),at=Date.parse('2026-11-24T12:00:00Z');
const fixture=()=>({...market(),category:'esport' as const,question:'Dota 2: Team Yandex vs 1win (BO3) - BLAST Slam Seeding Matches',start_at:'2026-11-24T14:00:00Z'});
test('Public organizer data identifies both teams, kickoff, format and genuinely completed historical series',()=>{
 const data=blastTimeline(html),facts=blastFacts(data,fixture(),at);assert.ok(facts);assert.equal(facts.fixture.id,'10cc193b-ddf9-4bba-95db-84e8283c78ba');assert.equal(facts.fixture.format,'BO3');assert.equal(facts.fixture.scheduled_at,'2026-11-24T14:00:00.000Z');assert.deepEqual(facts.teams.map(t=>t.name),['Team Yandex','1win']);assert.ok(facts.teams.every(t=>t.recent_series.length>0));assert.ok(facts.teams.every(t=>t.recent_series.every((s:any)=>Date.parse(s.at)<=at)));assert.equal(facts.state,'pre');assert.match(facts.limitation,/No OpenDota rating/);
});
test('Wrong team, wrong kickoff, wrong game and map markets never borrow a different series',()=>{
 const d=blastTimeline(html),m=fixture();for(const patch of [{question:m.question.replace('1win','Team Liquid')},{start_at:'2026-11-25T14:00:00Z'},{question:m.question.replace('Dota 2','Counter-Strike')},{question:m.question+' - Game 1 Winner'}])assert.equal(blastFacts(d,{...m,...patch},at),null);
});
test('Missing histories, ambiguous fixtures and a started match fail explicitly',()=>{
 const m=fixture();let d=blastTimeline(html);d.tournaments[0].matches=d.tournaments[0].matches.filter((x:any)=>x.finished!==true);assert.equal(blastFacts(d,m,at),null);
 d=blastTimeline(html);const target=d.tournaments[0].matches.find((x:any)=>x.id.startsWith('10cc193b'))!;d.tournaments[0].matches.push({...target,id:'ambiguous'});assert.equal(blastFacts(d,m,at),null);
 d=blastTimeline(html);assert.equal(blastFacts(d,m,Date.parse('2026-11-24T14:01:00Z')),null);
});
test('Malformed markup is not executed or silently marked verified',()=>{
 assert.throws(()=>blastTimeline('<script>throw Error("do not execute")</script>'),/UNAVAILABLE/);assert.throws(()=>blastTimeline('streamController.enqueue("not a timeline")'),/UNAVAILABLE/);
});
test('Backend fetches the real HTML format once and does not depend on failing OpenDota for covered fixtures',async t=>{
 t.mock.timers.enable({apis:['Date'],now:at});let calls=0;const r=repository(),api=new Markets(r,async(url)=>{assert.equal(url,'https://blast.tv/dota');calls++;return new Response(html,{headers:{'content-type':'text/html'}});});
 const sources=await api.evidence(fixture());assert.equal(calls,1);const official=sources.find(s=>s.provider==='BLAST');assert.equal(official?.status,'VERIFIED');assert.equal(official!.fetched_at,new Date(at).toISOString());assert.ok(quality(fixture(),sources,null,at,ACTIVE_POLICY).ready);
 await api.evidence(fixture());assert.equal(calls,1);assert.ok(!sources.some(s=>s.provider==='OpenDota'));
 t.mock.timers.tick(301000);await api.evidence(fixture());assert.equal(calls,2);await assert.rejects(()=>api.get('https://blast.tv/account'),/NOT_ALLOWED/);
});
test('Recent history cannot contain future, incomplete or invalid scores',()=>{
 const d=blastTimeline(html),m=fixture();for(const s of d.tournaments[0].matches)if(s.finished===true){s.score_a=1;s.score_b=1;}
 assert.equal(blastFacts(d,m,at),null);
});
