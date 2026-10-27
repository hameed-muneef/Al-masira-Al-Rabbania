import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import ts from 'typescript';

const catalog=JSON.parse(readFileSync(new URL('../src/learning-videos.json',import.meta.url),'utf8'));
const source=readFileSync(new URL('../src/curriculum.ts',import.meta.url),'utf8').replace("import catalog from './learning-videos.json';",`const catalog=${JSON.stringify(catalog)};`);
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {addGoodOpinionBook,initialCurriculum,legacyInitialCurriculum,mergeKnowledgeCurriculum,organizeJourneyCurriculum,refreshCurriculumResources,journeyStageForLegacyUnit,updateBeginningBooks,unitErrors,safeUrl,availableUnits,transitionUnit,reviseUnit}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const topicsSource=readFileSync(new URL('../src/book-topics.ts',import.meta.url),'utf8');
const topicsCode=ts.transpileModule(topicsSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {bookTopics,readingsFor}=await import(`data:text/javascript;base64,${Buffer.from(topicsCode).toString('base64')}`);
const book=JSON.parse(readFileSync(new URL('../public/books/book-text.json',import.meta.url),'utf8'));

test('all seed units have seven sourced stations and remain unapproved drafts',()=>{
  const {units}=initialCurriculum();
  assert.deepEqual(units.map(unit=>unit.title),['رحلة الاستيقاظ والتأسيس','رحلة العلم والتزكية','رحلة ترسيخ التقوى','رحلة المراقبة والإحسان']);
  assert.equal(units.length,4);
  for(const unit of units){assert.equal(unit.status,'draft');assert.equal(unit.stations.length,7);assert.deepEqual(unitErrors(unit),[]);}
});
test('resource links reject script, file, data and credential URLs',()=>{
  for(const link of ['javascript:alert(1)','data:text/html,hi','file:///secret','//example.com','https://user:pass@example.com','bad']) assert.equal(safeUrl(link),null);
  assert.equal(safeUrl('https://example.com/book.pdf'),'https://example.com/book.pdf');
  assert.equal(safeUrl('/books/why-created.pdf'),'/books/why-created.pdf');
  assert.equal(safeUrl('//example.com/book.pdf'),null);
});
test('later titles stay unavailable until all seven previous stations are completed',()=>{
  const {units}=initialCurriculum();
  assert.deepEqual(availableUnits(units,{}).map(u=>u.id),['awakening']);
  assert.equal(availableUnits(units,{awakening:6}).length,1);
  assert.deepEqual(availableUnits(units,{awakening:7}).map(u=>u.id),['awakening','knowledge-purification']);
  assert.equal(availableUnits(units,{'knowledge-purification':7}).length,1);
});
test('publishing requires review and reviewer record; edits revoke approval',()=>{
  const unit=initialCurriculum().units[0];
  assert.throws(()=>transitionUnit(unit,'published'));
  const review=transitionUnit(unit,'review');
  assert.throws(()=>transitionUnit(review,'approved'));
  const approved=transitionUnit(review,'approved','مراجع تجريبي','تمت مراجعة المصادر في تجربة الاختبار');
  const published=transitionUnit(approved,'published');
  assert.equal(published.status,'published');
  const revised=reviseUnit(published);
  assert.equal(revised.status,'draft');assert.equal(revised.reviewer,'');assert.equal(revised.revision,2);
  assert.throws(()=>transitionUnit(revised,'published'));
});
test('incomplete, unsourced or unsafe material cannot enter review',()=>{
  const unit=initialCurriculum().units[0];
  unit.stations[0].body='';
  assert.throws(()=>transitionUnit(unit,'review'));
  unit.stations[0].body='نص';unit.stations[0].sourceIds=['deleted'];
  assert.throws(()=>transitionUnit(unit,'review'));
  unit.stations[0].sourceIds=['purpose'];unit.resources[0].url='javascript:alert(1)';
  assert.throws(()=>transitionUnit(unit,'review'));
});
test('every book page is assigned to a valid unit and station without footnotes',()=>{
  const unitIds=new Set(initialCurriculum().units.map(unit=>unit.id));
  assert.equal(book.pages.length,180);
  for(const page of book.pages){
    const mapped=bookTopics.filter(topic=>topic.start<=page.id&&page.id<=topic.end);
    assert.ok(mapped.length>0,`unmapped page ${page.id}`);
    assert.ok(page.paragraphs.length>0,`empty page ${page.id}`);
    assert.ok(page.paragraphs.every(p=>!/^\([0-9٠-٩]+\) /.test(p)),`footnote on page ${page.id}`);
  }
  for(const topic of bookTopics){
    assert.ok(unitIds.has(topic.unitId));
    assert.ok(topic.station>=0&&topic.station<7);
    assert.ok(topic.start>=1&&topic.end<=180&&topic.start<=topic.end);
    assert.ok(readingsFor(topic.unitId,topic.station).includes(topic));
  }
});

test('opening station shows the current books in the requested order',()=>{
  const beginning=legacyInitialCurriculum().units.find(unit=>unit.id==='beginning');
  const linked=beginning.resources.filter(resource=>resource.kind!=='video'&&beginning.stations[0].sourceIds.includes(resource.id));
  assert.deepEqual(linked.map(resource=>resource.title),['تعريف عام بدين الإسلام','رحلة حياة... خطوات في طريق الحياة الطيبة','وما قدروا الله حق قدره','حسن الظن بالله']);
  assert.equal(linked[1].url,'/books/journey-of-life.pdf');
  assert.ok(statSync(new URL('../public/books/journey-of-life.pdf',import.meta.url)).size>0);
  const migrated=updateBeginningBooks({...beginning,resources:beginning.resources.slice(2),stations:beginning.stations.map((station,index)=>index===0?{...station,sourceIds:['purpose','return']}:station)});
  assert.deepEqual(migrated.stations[0].sourceIds.slice(0,3),['general-islam-book','life-journey-book','knowing-allah-book']);
});
test('the new PDF book appears in the opening station and is available',()=>{
  const beginning=legacyInitialCurriculum().units.find(unit=>unit.id==='beginning');
  const resource=beginning.resources.find(item=>item.id==='knowing-allah-book');
  assert.equal(resource?.url,'/books/wa-ma-qadaru-allah.pdf');
  assert.ok(beginning.stations[0].sourceIds.includes(resource.id));
  assert.ok(statSync(new URL('../public/books/wa-ma-qadaru-allah.pdf',import.meta.url)).size>0);
  assert.equal(updateBeginningBooks(beginning).resources.filter(item=>item.id===resource.id).length,1);
});
test('the added PDF is available and migration keeps existing station content',()=>{
  const beginning=legacyInitialCurriculum().units[0];
  const book=beginning.resources.find(resource=>resource.id==='good-opinion-book');
  assert.equal(book?.url,'/books/husn-al-zann-billah.pdf');
  assert.ok(statSync(new URL('../public/books/husn-al-zann-billah.pdf',import.meta.url)).size>0);
  const previous={...beginning,resources:beginning.resources.filter(resource=>resource.id!==book.id),stations:beginning.stations.map((station,index)=>index===0?{...station,body:'نص مخصص',sourceIds:station.sourceIds.filter(id=>id!==book.id)}:station)};
  const migrated=addGoodOpinionBook(previous);
  assert.equal(migrated.stations[0].body,'نص مخصص');
  assert.ok(migrated.stations[0].sourceIds.includes(book.id));
  assert.equal(addGoodOpinionBook(migrated).resources.filter(resource=>resource.id===book.id).length,1);
});
test('four thematic books are filed under the requested sections and have PDFs',()=>{
  const units=initialCurriculum().units;
  const expected=[
    ['rooted-taqwa','steadfast-book','wa-ma-baddalu-tabdila.pdf'],
    ['awakening','greatness-book','ma-azamaka.pdf'],
    ['knowledge-purification','beloved-book','law-kana-baynana.pdf'],
    ['knowledge-purification','conduct-book','qawaid-al-suluk.pdf']
  ];
  for(const [id,resourceId,filename] of expected){
    const unit=units.find(item=>item.id===id);
    assert.ok(unit);
    const resource=unit.resources.find(item=>item.id===resourceId);
    assert.equal(resource?.url,`/books/${filename}`);
    assert.ok(unit.stations[0].sourceIds.includes(resourceId));
    assert.ok(statSync(new URL(`../public/books/${filename}`,import.meta.url)).size>0);
  }
});
test('the four journeys keep every existing book and link books in their matching stage',()=>{
  const old=legacyInitialCurriculum();
  const current=initialCurriculum();
  const oldBooks=[...new Set(old.units.flatMap(unit=>unit.resources).filter(resource=>resource.kind==='book').map(resource=>resource.id))].sort();
  const newBooks=current.units.flatMap(unit=>unit.resources).filter(resource=>resource.kind==='book').map(resource=>resource.id);
  assert.deepEqual([...newBooks].sort(),oldBooks.filter(id=>!id.startsWith('book-')));
  assert.equal(new Set(newBooks).size,newBooks.length);
  for(const unit of current.units)for(const book of unit.resources.filter(resource=>resource.kind==='book')){
    assert.ok(unit.stations.slice(0,4).some(step=>step.sourceIds.includes(book.id)),`${book.id} missing from ${unit.id}`);
  }
  assert.ok(current.units.find(unit=>unit.id==='watchfulness-ihsan').resources.some(resource=>resource.id==='allah-anis-book'));
  assert.ok(current.units.find(unit=>unit.id==='rooted-taqwa').resources.some(resource=>resource.id==='good-opinion-book'));
});
test('requested sources are removed and the general Islam book opens as one PDF after migration',()=>{
  const previous=organizeJourneyCurriculum(legacyInitialCurriculum());
  const current=refreshCurriculumResources(previous);
  const removed=new Set(['purpose','jibril','death','names','creed','dua']);
  const resources=current.units.flatMap(unit=>unit.resources);
  assert.equal(current.mediaVersion,14);
  assert.ok(resources.every(resource=>!removed.has(resource.id)));
  assert.ok(resources.every(resource=>!resource.url.startsWith('https://shamela.ws/book/37562/')));
  assert.equal(resources.filter(resource=>resource.id==='general-islam-book').length,1);
  assert.equal(resources.find(resource=>resource.id==='general-islam-book').url,'/books/general-islam.pdf');
  assert.ok(statSync(new URL('../public/books/general-islam.pdf',import.meta.url)).size>0);
  for(const unit of current.units){
    assert.deepEqual(unitErrors(unit),[]);
    const ids=new Set(unit.resources.map(resource=>resource.id));
    assert.ok(unit.stations.every(station=>station.sourceIds.every(id=>ids.has(id))));
  }
  assert.deepEqual(refreshCurriculumResources(current),current);
});
test('all other books and every catalog video remain available in the journey library',()=>{
  const units=initialCurriculum().units;
  assert.ok(units.find(unit=>unit.id==='rooted-taqwa').resources.some(resource=>resource.id==='good-opinion-book'));
  const videos=units.flatMap(unit=>unit.resources.filter(resource=>resource.kind==='video'));
  assert.equal(videos.length,catalog.videos.length);
  assert.equal(new Set(videos.map(resource=>resource.id)).size,catalog.videos.length);
  const certainty=catalog.videos.filter(video=>video.playlistTitle==='رحلة اليقين');
  assert.ok(certainty.length>0);
  assert.ok(certainty.every(video=>videos.some(resource=>resource.id===`journey-video-${video.videoId}`)));
});
test('legacy progress and unit data remain available after regrouping',()=>{
  const legacy=legacyInitialCurriculum();
  const migrated=organizeJourneyCurriculum({...legacy,progress:{beginning:3,'self-purification':2,steadfastness:1}});
  assert.deepEqual(migrated.units.map(unit=>unit.id),['awakening','knowledge-purification','rooted-taqwa','watchfulness-ihsan']);
  assert.equal(migrated.progress.awakening,3);
  assert.equal(migrated.progress['knowledge-purification'],2);
  assert.equal(migrated.progress['rooted-taqwa'],1);
  assert.equal(migrated.archivedUnits.length,legacy.units.length);
});
test('knowledge, names and attributes share one station without losing saved sources or progress',()=>{
  const combined=legacyInitialCurriculum().units.find(unit=>unit.id==='knowing');
  assert.ok(combined);
  assert.ok(['greatness-book','allah-anis-book','names','attributes'].every(id=>combined.resources.some(resource=>resource.id===id)));
  assert.ok(!legacyInitialCurriculum().units.some(unit=>['beautiful-names','attributes','knowing-attributes'].includes(unit.id)));
  const oldUnits=[
    {...combined,title:'معرفة الله',resources:combined.resources.filter(resource=>resource.id!=='greatness-book')},
    {...combined,id:'knowing-attributes',resources:combined.resources.filter(resource=>resource.id==='greatness-book'),stations:combined.stations.map(station=>({...station,body:'محتوى محفوظ',sourceIds:['greatness-book']}))}
  ];
  const migrated=mergeKnowledgeCurriculum({units:oldUnits,progress:{knowing:2,'knowing-attributes':4}});
  assert.equal(migrated.units.length,1);
  assert.equal(migrated.progress.knowing,4);
  assert.ok(migrated.units[0].resources.some(resource=>resource.id==='greatness-book'));
  assert.match(migrated.units[0].stations[0].body,/محتوى محفوظ/);
});
test('every playlist video is linked to its thematic station with a valid URL',()=>{
  assert.deepEqual(catalog.playlists.map(p=>catalog.videos.filter(v=>v.playlistId===p.id).length),[69,4,13]);
  assert.equal(catalog.videos.length,86);
  assert.equal(new Set(catalog.videos.map(v=>v.videoId)).size,86);
  const units=initialCurriculum().units;
  for(const video of catalog.videos){
    assert.match(video.videoId,/^[A-Za-z0-9_-]{11}$/);
    assert.ok(video.group);
    const unit=units.find(u=>u.id===journeyStageForLegacyUnit(video.unitId));
    const resource=unit?.resources.find(r=>r.id===`journey-video-${video.videoId}`);
    assert.ok(resource);
    assert.ok(unit.stations[video.station].sourceIds.includes(resource.id));
    assert.equal(new URL(resource.url).searchParams.get('list'),video.playlistId);
  }
});

