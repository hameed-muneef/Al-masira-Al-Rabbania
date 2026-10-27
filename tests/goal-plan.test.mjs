import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/goal-plan.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {goalPeriodKey,goalPeriodLabel,goalIsoWeek,goalWeekKey,goalWeeksInYear,goalSteps,stepsForPeriod,daysToGoal}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('daily, Monday-based weekly, and monthly progress keys roll over correctly',()=>{
  const sunday=new Date(2026,9,25,12),monday=new Date(2026,9,26,12);
  assert.equal(goalPeriodKey('daily',sunday),'2026-10-25');
  assert.equal(goalPeriodKey('daily',monday),'2026-10-26');
  assert.equal(goalPeriodKey('weekly',sunday),'2026-10-19');
  assert.equal(goalPeriodKey('weekly',monday),'2026-10-26');
  assert.equal(goalPeriodKey('monthly',monday),'2026-10');
  assert.equal(goalPeriodKey('monthly',new Date(2026,10,1,12)),'2026-11');
  assert.equal(goalPeriodKey('yearly',new Date(2026,11,31,12)),'2026');
  assert.equal(goalPeriodKey('yearly',new Date(2027,0,1,12)),'2027');
});
test('period cards collect only matching steps across goals, including saved legacy goals',()=>{
  const goals=[{id:'a',title:'العلم',benefit:'النفع',steps:[{id:'a1',title:'قراءة',period:'daily',done:{}},{id:'a2',title:'إنهاء كتاب',period:'yearly',done:{'2026':true}}]},{id:'b',title:'الصحة',benefit:'القوة',steps:[{id:'b1',title:'رياضة',period:'daily',done:{}}]},{id:'old',title:'قديم',benefit:'خير',action:'مراجعة',period:'weekly'}];
  assert.deepEqual(stepsForPeriod(goals,'daily').map(item=>[item.goalTitle,item.step.title]),[['العلم','قراءة'],['الصحة','رياضة']]);
  assert.deepEqual(stepsForPeriod(goals,'weekly').map(item=>item.step.title),['مراجعة']);
  assert.equal(stepsForPeriod(goals,'monthly').length,0);
  assert.equal(stepsForPeriod(goals,'yearly')[0].step.done['2026'],true);
});
test('existing goals keep their action as a first plan step',()=>{
  assert.deepEqual(goalSteps({id:'old',title:'تعلم',benefit:'النفع',action:'قراءة يومية',period:'daily'}),[{id:'legacy-old',title:'قراءة يومية',period:'daily',done:{}}]);
});
test('deadline counts calendar days, including same day and overdue',()=>{
  const now=new Date(2026,9,23,23,30);
  assert.equal(daysToGoal('2026-10-23',now),0);
  assert.equal(daysToGoal('2026-10-26',now),3);
  assert.equal(daysToGoal('2026-10-22',now),-1);
});
test('history labels use Arabic month names and ISO week numbers across years',()=>{
  assert.match(goalPeriodLabel('monthly','2026-10'),/أكتوبر/);
  assert.match(goalPeriodLabel('daily','2026-10-22'),/أكتوبر/);
  assert.match(goalPeriodLabel('weekly','2026-10-19'),/٤٣/);
  assert.match(goalPeriodLabel('weekly','2025-12-29'),/١.*٢٠٢٦/);
});
test('week selector uses ISO weeks, including a week that belongs to the next year',()=>{
  assert.deepEqual(goalIsoWeek('2025-12-29'),{year:2026,week:1});
  assert.equal(goalWeekKey(2026,1),'2025-12-29');
  assert.equal(goalWeeksInYear(2025),52);
  assert.equal(goalWeeksInYear(2026),53);
});
