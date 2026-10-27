import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const source=readFileSync(new URL('../src/usePrayerTimes.ts',import.meta.url),'utf8').replace("from 'react'",`from '${import.meta.resolve('react')}'`);
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {prayerDate,parsePrayerTimes}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const timings={Fajr:'04:45',Sunrise:'06:10',Dhuhr:'12:00',Asr:'15:25',Maghrib:'17:50',Isha:'19:10'};

test('request date uses the device calendar, including year rollover',()=>{
  assert.equal(prayerDate(new Date(2026,0,1,0,5)),'01-01-2026');
  assert.equal(prayerDate(new Date(2026,11,31,23,55)),'31-12-2026');
});
test('all six returned times map to the planner including sunrise',()=>{
  assert.deepEqual(parsePrayerTimes(timings),{'الفجر':'04:45','الشروق':'06:10','الظهر':'12:00','العصر':'15:25','المغرب':'17:50','العشاء':'19:10'});
});
test('incomplete and invalid service data never become displayed prayer times',()=>{
  for(const invalid of [undefined,null,{}, {...timings,Fajr:'24:00'},{...timings,Isha:'19:60'},{...timings,Sunrise:null}]) assert.throws(()=>parsePrayerTimes(invalid));
});
