import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const compile=path=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const moduleUrl=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const videos=moduleUrl(`export default ${readFileSync(new URL('../src/learning-videos.json',import.meta.url),'utf8')}`);
const curriculum=moduleUrl(compile('../src/curriculum.ts').replace("'./learning-videos.json'",JSON.stringify(videos)));
const {archiveResource,restoreResource,removeResource,reorderResource,assignResource,uploadedBookPath}=await import(moduleUrl(compile('../src/resource-management.ts').replace("'./curriculum'",JSON.stringify(curriculum))));
const resource={id:'r',title:'كتاب',kind:'book',author:'مؤلف',reference:'مرجع',url:'https://example.org/book.pdf',level:'extra'};
const unit=(id)=>({id,title:id,summary:'ملخص',revision:2,status:'published',reviewer:'مراجع',reviewNote:'معتمد',resources:[],stations:Array.from({length:7},()=>({body:'نص',sourceIds:[]}))});
const first={...unit('one'),resources:[resource,{...resource,id:'r2'}],stations:unit('one').stations.map(station=>({...station,sourceIds:['r','r2']}))};
const data={units:[first,unit('two')],progress:{one:3},mediaVersion:14};

test('deletion removes source and all station links without mutating other resources',()=>{
  const next=removeResource(first,'r');
  assert.deepEqual(next.resources.map(r=>r.id),['r2']);
  assert.ok(next.stations.every(station=>!station.sourceIds.includes('r')));
  assert.equal(first.resources.length,2);
  assert.equal(JSON.parse(JSON.stringify(next)).resources.length,1);
});
test('reordering preserves links and handles boundaries',()=>{
  const next=reorderResource(first,'r',1);
  assert.deepEqual(next.resources.map(r=>r.id),['r2','r']);
  assert.equal(next.stations,first.stations);
  assert.equal(reorderResource(first,'r',-1),first);
  assert.equal(reorderResource(first,'missing',1),first);
});
test('moving a source changes both units and preserves the same file and ID',()=>{
  const next=assignResource(data,'one','two',{...resource,title:'عنوان جديد'},[2,5]);
  assert.deepEqual(next.units[0].resources.map(r=>r.id),['r2']);
  assert.ok(next.units[0].stations.every(s=>!s.sourceIds.includes('r')));
  assert.equal(next.units[1].resources[0].url,resource.url);
  assert.deepEqual(next.units[1].stations.flatMap((s,i)=>s.sourceIds.includes('r')?[i]:[]),[2,5]);
  assert.ok(next.units.every(u=>u.status==='draft'&&u.revision===3&&u.reviewer===''));
  assert.equal(data.units[1].resources.length,0);
  assert.throws(()=>assignResource({...data,units:[first,{...unit('two'),resources:[resource]}]},'one','two',resource,[]),/موجود/);
});
test('editing a resource retains its position and replaces station assignments',()=>{
  const next=assignResource(data,'one','one',{...resource,author:'مؤلف آخر'},[0]);
  assert.equal(next.units[0].resources[0].author,'مؤلف آخر');
  assert.equal(next.units[1],data.units[1]);
  assert.deepEqual(next.units[0].stations[1].sourceIds,['r2']);
});
test('archiving and restoring a resource preserves its file, original station links, and learner progress',()=>{
  const archived=archiveResource(data,'one','r');
  assert.deepEqual(archived.units[0].resources.map(item=>item.id),['r2']);
  assert.ok(archived.units[0].stations.every(station=>!station.sourceIds.includes('r')));
  assert.equal(archived.archivedResources[0].resource.url,resource.url);
  assert.deepEqual(archived.archivedResources[0].stationIndexes,[0,1,2,3,4,5,6]);
  assert.equal(archived.progress.one,3);
  assert.equal(archived.units[0].status,'draft');
  const restored=restoreResource(archived,'r');
  assert.deepEqual(restored.units[0].resources.map(item=>item.id),['r2','r']);
  assert.ok(restored.units[0].stations.every(station=>station.sourceIds.includes('r')));
  assert.equal(restored.archivedResources.length,0);
  assert.equal(restored.progress.one,3);
});
test('an archived resource can be restored to its archived unit without publishing the changed unit',()=>{
  const archivedResource=archiveResource(data,'one','r');
  const archivedUnit={...archivedResource.units[0],id:'one'};
  const unitless={...archivedResource,units:[archivedResource.units[1]],archivedUnits:[archivedUnit]};
  const restored=restoreResource(unitless,'r');
  assert.ok(restored.archivedUnits[0].resources.some(item=>item.id==='r'));
  assert.equal(restored.archivedUnits[0].status,'draft');
  assert.equal(restored.archivedResources.length,0);
});
test('managed file identification rejects external/local paths and handles query/hash',()=>{
  const base='https://project.supabase.co/storage/v1/object/public/journey-books/';
  const path='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf';
  assert.equal(uploadedBookPath(base+path+'?download=1#page=4',base),path);
  for(const url of ['/books/example.pdf',base+'../other/'+path,base+'folder/'+path,base.replace('project.','other.')+path,base+'named.pdf'])assert.equal(uploadedBookPath(url,base),null);
});
