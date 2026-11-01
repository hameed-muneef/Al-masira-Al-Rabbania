import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const source=readFileSync(new URL('../src/archive-pagination.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {getArchivePageAfterResult}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('empty out-of-range archive pages return to the first page',()=>{
  assert.equal(getArchivePageAfterResult(3,0),0);
});

test('valid pages and an empty first page remain unchanged',()=>{
  assert.equal(getArchivePageAfterResult(0,0),0);
  assert.equal(getArchivePageAfterResult(2,12),2);
});
