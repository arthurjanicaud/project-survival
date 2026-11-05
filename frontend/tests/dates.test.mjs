import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const compiled=ts.transpileModule(readFileSync(new URL('../src/dates.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {formatDate,formatTime,meetingTime}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
test('cancelled extraordinary meeting uses creation time instead of its technical slot identifier',()=>{
 const m={started_at:null,slot:'urgent:2026-11-05T01:01:37.272Z',created_at:'2026-11-05T01:02:22.345Z'};
 assert.equal(meetingTime(m),m.created_at);assert.match(formatDate(meetingTime(m)),/02:02/);
});
test('invalid and missing dates never throw while rendering the dashboard or events',()=>{
 for(const value of ['urgent:2026-11-05T01:01:37.272Z','not-a-date','2026-99-99',null,undefined,{},'']){assert.doesNotThrow(()=>formatDate(value));assert.doesNotThrow(()=>formatTime(value));}
 assert.equal(formatDate('invalid'),'Date indisponible');assert.equal(formatTime('invalid'),'Heure indisponible');
});
test('started and ordinary scheduled times preserve their Paris display',()=>{
 const m={started_at:'2026-11-05T08:00:01Z',slot:'2026-11-05T08:00:00Z',created_at:'2026-11-04T20:00:00Z'};
 assert.equal(meetingTime(m),m.started_at);assert.match(formatDate(meetingTime(m)),/09:00/);assert.match(formatTime(m.started_at),/09:00:01/);assert.equal(meetingTime({...m,started_at:null}),m.slot);
});
