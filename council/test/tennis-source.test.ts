import {test} from 'node:test';
import assert from 'node:assert/strict';
import {repository,market} from './helpers';
import {Markets} from '../src/markets';
import {publicResearchUrl} from '../src/public-research';

function harness(){const r=repository(),m={...market(),category:'tennis' as const,outcome_labels:{YES:'Alafia Ayeni',NO:'Alex Bolt'},question:'Alafia Ayeni vs Alex Bolt'};const api=new Markets(r,async()=>{throw Error('No actual network in unit test');});
 const cache=(url:string,data:any,stamp=new Date().toISOString())=>r.putCache('research:'+url,{fetched_at:stamp,data},3600);
 function seed(name:string,id:string){const search=`https://site.web.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(name)}&limit=5&type=player`,profile=`https://sports.core.api.espn.com/v2/sports/tennis/athletes/${id}?lang=en&region=us`,stats=`https://sports.core.api.espn.com/v2/sports/tennis/leagues/atp/seasons/2026/types/2/athletes/${id}/statistics?lang=en&region=us`;
  cache(search,{items:[{id,displayName:name,sport:'tennis',type:'player'}]});cache(profile,{id,displayName:name,active:true,statistics:{$ref:stats}});cache(stats,{splits:{categories:[{stats:[{name:'singlesWon',value:0},{name:'prize',value:44451}]}]}});
 }
 return {r,m,api,cache,seed};}
test('free player context is explicitly scoped when a Challenger fixture is absent from ESPN scoreboard',async()=>{
 const s=harness();s.seed('Alafia Ayeni','3341');s.seed('Alex Bolt','2255');const result=await s.api.evidence(s.m),profiles=result.filter(r=>r.status==='VERIFIED'&&r.provider==='ESPN');assert.equal(profiles.length,2);
 for(const r of profiles){const d=JSON.parse(r.text);assert.equal(d.fixture_verified_by_scoreboard,false);assert.ok(d.statistics_scope.includes('lower-tour'));assert.ok(d.statistics.some((v:any)=>v.name==='singlesWon'&&v.value===0));assert.equal(d.last_updated_at,null);}
});
test('player lookup requires an exact unique identity; no invented matching or history for an unknown name',async()=>{
 const s=harness();s.seed('Alafia Ayeni','3341');const sources=await s.api.evidence(s.m);assert.equal(sources.filter(r=>r.status==='VERIFIED'&&r.provider==='ESPN').length,1);assert.ok(s.r.sourceDemands().some(d=>d.url.includes('Alex%20Bolt')));
});
test('shared feeds older than ten minutes request a refresh instead of masquerading as current facts',async()=>{
 const s=harness(),url='https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard?dates=20261123';s.cache(url,{events:[]},new Date(Date.now()-1200000).toISOString());await assert.rejects(s.api.get(url),/MISSING_OR_STALE/);assert.ok(s.r.sourceDemands().some(d=>d.url===url));
});
test('new public feed routes admit only player search and fixed tennis profiles/statistics, without credentials',()=>{
 const yes=['https://site.web.api.espn.com/apis/common/v3/search?query=Alex%20Bolt&limit=5&type=player','https://sports.core.api.espn.com/v2/sports/tennis/athletes/2255?lang=en&region=us','https://sports.core.api.espn.com/v2/sports/tennis/leagues/atp/seasons/2026/types/2/athletes/2255/statistics?lang=en&region=us'];for(const u of yes)assert.equal(publicResearchUrl(new URL(u)),true);
 for(const u of ['https://sports.core.api.espn.com/other/private','https://user:secret@site.web.api.espn.com/apis/common/v3/search?query=x&limit=5&type=player','https://evil.example/tennis','https://site.web.api.espn.com/apis/common/v3/search?query=x&limit=50000&type=player'])assert.equal(publicResearchUrl(new URL(u)),false);
});
