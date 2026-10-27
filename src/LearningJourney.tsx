import {lazy,Suspense,createContext,useContext,useCallback,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowDown, ArrowUp, BookOpen, Check, ExternalLink, FileText, Film, Lock, Plus, Settings2, X} from 'lucide-react';
import {availableUnits, initialCurriculum, kindLabels, learningVideos, reviseUnit, safeUrl, stationTitles, statusLabels, transitionUnit, unitErrors, videoResourceId, type Curriculum, type Resource, type Unit} from './curriculum';
import {savedBookPage,saveBookPage} from './reading-progress';
import {uid} from './id';
import {isUploadedBookUrl} from './book-upload';
import './learning-redesign.css';
import './book-reader.css';
import './learning-reader.css';
import './book-upload.css';
import ResourceManager from './ResourceManager';
const BookReader=lazy(()=>import('./BookReader'));

// عدد صفحات ملفات PDF المعروفة، ويُستبدل بعدد الصفحات الفعلي من public/books/manifest.json عند توافره (مفتاحه اسم الملف).
const defaultPdfPageCounts:Record<string,number>={'wa-ma-qadaru-allah.pdf':351,'husn-al-zann-billah.pdf':202,'journey-of-life.pdf':154,'wa-ma-baddalu-tabdila.pdf':180,'ma-azamaka.pdf':192,'law-kana-baynana.pdf':206,'qawaid-al-suluk.pdf':308,'al-rihla-al-akhira.pdf':141,'rihlat-al-arwah.pdf':363,'mada-baad-al-mawt.pdf':185,'inda-liqaa-al-malik.pdf':318,'ish-ma-al-quran.pdf':291,'asbab-tasad-an-qabul-al-haqq.pdf':367,'arkud-bi-qalbak-madarij-al-salikin.pdf':707,'al-iksir-khulasa-aamal-al-qulub.pdf':288,'allah-jal-jalalah-anis-al-muhibbin.pdf':513};
defaultPdfPageCounts['general-islam.pdf']=192;
const PdfPageCountsContext=createContext<Record<string,number>>(defaultPdfPageCounts);
function usePdfPageCounts(){
  const [counts,setCounts]=useState(defaultPdfPageCounts);
  useEffect(()=>{
    let active=true;
    fetch('/books/manifest.json').then(async response=>{
      if(!response.ok)return;
      const data=await response.json() as Record<string,unknown>;
      if(!active||!data||typeof data!=='object')return;
      const manifest:Record<string,number>={};
      for(const [file,value] of Object.entries(data))if(typeof value==='number'&&Number.isInteger(value)&&value>0)manifest[file]=value;
      if(Object.keys(manifest).length>0)setCounts({...defaultPdfPageCounts,...manifest});
    }).catch(()=>{});
    return ()=>{active=false};
  },[]);
  return counts;
}
function PdfBookReader({resource,href,onClose}:{resource:Resource;href:string;onClose:()=>void}){
  const allPdfPageCounts=useContext(PdfPageCountsContext);
  const remote=isUploadedBookUrl(resource.url);
  const pageCount=remote?Number.MAX_SAFE_INTEGER:allPdfPageCounts[resource.url.slice('/books/'.length)]??1;
  const [savedPage,setSavedPage]=useState(()=>savedBookPage(resource.id,pageCount));
  const [page,setPage]=useState(()=>savedBookPage(resource.id,pageCount)??1);
  const [pageInput,setPageInput]=useState(String(page));
  const [saveStatus,setSaveStatus]=useState('');
  const closeRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    const previousOverflow=document.body.style.overflow;
    const previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
    document.body.style.overflow='hidden';
    closeRef.current?.focus();
    const onKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose()};
    document.addEventListener('keydown',onKeyDown);
    return ()=>{document.body.style.overflow=previousOverflow;document.removeEventListener('keydown',onKeyDown);previousFocus?.focus()};
  },[onClose]);
  const goToPage=(next:number)=>{
    if(!Number.isInteger(next)||next<1||next>pageCount)return;
    setPage(next);setPageInput(String(next));setSaveStatus('');
  };
  const commitPageInput=()=>{const next=Number(pageInput);if(Number.isInteger(next)&&next>=1&&next<=pageCount)goToPage(next);else setPageInput(String(page))};
  const saveCurrent=()=>{const next=Number(pageInput);if(!Number.isInteger(next)||next<1||next>pageCount){setSaveStatus('أدخل رقم صفحة صحيحًا أولًا.');return}setPage(next);setPageInput(String(next));if(saveBookPage(resource.id,next,pageCount)){setSavedPage(next);setSaveStatus('حُفظ رقم الصفحة على هذا الجهاز.')}else setSaveStatus('تعذّر حفظ رقم الصفحة في هذا المتصفح.')};
  return createPortal(<div className="fullscreen-book-reader" role="dialog" aria-modal="true" aria-label={`قراءة ${resource.title}`} dir="rtl">
    <header className="fullscreen-book-header"><div className="fullscreen-book-heading"><BookOpen size={22}/><strong>{resource.title}</strong></div><button ref={closeRef} type="button" className="fullscreen-book-close" onClick={onClose} aria-label="إغلاق القارئ"><X size={20}/><span>إغلاق</span></button></header>
    <iframe className="fullscreen-pdf-frame" src={`${href}#page=${page}&toolbar=0`} title={`قراءة ${resource.title}`}/>
    <div className="pdf-reading-footer"><div className="pdf-reading-navigation"><button type="button" className="soft-btn" disabled={page<=1} onClick={()=>goToPage(page-1)}>السابقة</button><button type="button" className="soft-btn" disabled={!remote&&page>=pageCount} onClick={()=>goToPage(page+1)}>التالية</button></div><div className="pdf-reading-page-entry"><div className="pdf-reading-tools"><label>رقم الصفحة<input type="number" min="1" max={remote?undefined:pageCount} value={pageInput} onChange={event=>setPageInput(event.target.value)} onBlur={commitPageInput} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur()}}/></label>{!remote&&<span>من {pageCount.toLocaleString('ar-EG')}</span>}</div><span className="pdf-reading-hint">اكتب هنا رقم الصفحة التي وصلت إليها، ثم احفظها للعودة إليها لاحقًا.</span></div><button type="button" className="primary pdf-save-page" onClick={saveCurrent}>حفظ رقم الصفحة</button>{savedPage?(savedPage===page?<span className="reading-last-page">الصفحة المحفوظة: {savedPage.toLocaleString('ar-EG')}</span>:<button type="button" className="reading-resume" onClick={()=>goToPage(savedPage)}>العودة إلى الصفحة المحفوظة: {savedPage.toLocaleString('ar-EG')}</button>):null}<a className="pdf-open-link" href={`${href}#page=${page}`} target="_blank" rel="noopener noreferrer">فتح PDF في نافذة مستقلة <ExternalLink size={13}/></a></div>
    {saveStatus&&<p className="reading-save-status" role="status">{saveStatus}</p>}
  </div>,document.body);
}

function ResourceLink({resource}:{resource:Resource}) {
  const allPdfPageCounts=useContext(PdfPageCountsContext);
  const [readerOpen,setReaderOpen]=useState(false);
  const closeReader=useCallback(()=>setReaderOpen(false),[]);
  const href=safeUrl(resource.url);
  const temporarilyUnavailable=resource.url==='/books/qawaid-al-suluk.pdf';
  const bookMatch=resource.kind==='book'?/^https:\/\/shamela\.ws\/book\/37562\/(\d+)/.exec(resource.url):null;
  const bookPage=bookMatch?Number(bookMatch[1]):null;
  const remotePdf=isUploadedBookUrl(resource.url);
  const pdfHere=!temporarilyUnavailable&&resource.kind==='book'&&!!href&&(/^\/books\/[a-z0-9_-]+\.pdf$/i.test(href)||remotePdf);
  const lastReadPage=pdfHere?savedBookPage(resource.id,remotePdf?Number.MAX_SAFE_INTEGER:allPdfPageCounts[resource.url.slice('/books/'.length)]??1):null;
  const readHere=!!bookPage||pdfHere;
  return <div className="learning-resource"><span className="resource-symbol">{resource.kind==='video'?<Film size={19}/>:resource.kind==='book'?<BookOpen size={19}/>:<FileText size={19}/>}</span><div><span className="resource-kind">{kindLabels[resource.kind]} · {resource.level==='extra'?'استزادة اختيارية':'مصدر أساسي'}</span>{temporarilyUnavailable?<strong>{resource.title} — غير متاح حاليًا</strong>:readHere?<button type="button" className="resource-read" aria-expanded={readerOpen} aria-controls={bookPage?`reader-${resource.id}`:undefined} onClick={()=>setReaderOpen(!readerOpen)}>{resource.title}<BookOpen size={14}/></button>:href?<a href={href} target="_blank" rel="noopener noreferrer">{resource.title}<ExternalLink size={13}/></a>:<strong>{resource.title} — رابط غير صالح</strong>}<small>{resource.author} · {resource.reference}</small>{lastReadPage&&<small className="resource-progress">آخر صفحة وصلت إليها: {lastReadPage.toLocaleString('ar-EG')} · افتح الكتاب للمتابعة منها أو للانتقال إلى صفحة أخرى.</small>}{bookPage&&readerOpen&&<div id={`reader-${resource.id}`} className="learning-inline-reader"><Suspense fallback={<p className="muted">جارٍ تحميل الكتاب…</p>}><BookReader startPage={bookPage}/></Suspense></div>}{pdfHere&&href&&readerOpen&&<PdfBookReader resource={resource} href={href} onClose={closeReader}/>}</div></div>;
}

function StationVideos({unit,station}:{unit:Unit;station:number}) {
  const linked=new Set(unit.stations[station]?.sourceIds??[]);
  const videos=unit.resources.filter(resource=>resource.kind==='video'&&linked.has(resource.id));
  if(!videos.length)return null;
  const grouped=new Map<string,Resource[]>();
  for(const resource of videos){
    const group=learningVideos.find(video=>videoResourceId(video.videoId)===resource.id)?.group??'فيديوهات هذه الخطوة';
    grouped.set(group,[...(grouped.get(group)??[]),resource]);
  }
  return <section className="station-video-groups" aria-label="فيديوهات مرتبطة بموضوع الخطوة"><h3>شاهد وتعلّم في هذا الموضوع</h3><p className="muted small">الحلقات مرتبة تحت عناوينها المشتركة. المشاهدة للتوسع، ويمكنك إتمام الخطوة دون إكمالها كلها.</p>{[...grouped].map(([title,resources])=><details className="station-video-group" key={title}><summary>{title} <span>({resources.length})</span></summary>{resources.map(resource=><ResourceLink key={resource.id} resource={resource}/>)}</details>)}</section>;
}

function JourneyResourceLibrary({units}:{units:Unit[]}) {
  return <section id="journey-resource-library" className="journey-resource-library" aria-label="مكتبة كتب وفيديوهات المحطات">
    <div className="journey-library-heading"><h2>مكتبة المحطات</h2><p>تصفح كتب كل رحلة وفيديوهاتها في أي وقت. إتمام خطوات المسار يبقى بالترتيب.</p></div>
    <div className="journey-library-grid">{units.map(unit=>{
      const books=unit.resources.filter(resource=>resource.kind==='book');
      const videos=unit.resources.filter(resource=>resource.kind==='video');
      const playlists=new Map<string,Resource[]>();
      for(const resource of videos){
        const title=learningVideos.find(video=>videoResourceId(video.videoId)===resource.id)?.playlistTitle??'فيديوهات أخرى';
        playlists.set(title,[...(playlists.get(title)??[]),resource]);
      }
      return <section className="journey-library-card" key={unit.id}><h3>{unit.title}</h3><div className="journey-library-books"><h4>الكتب · {books.length.toLocaleString('ar-EG')}</h4>{books.map(resource=><ResourceLink key={resource.id} resource={resource}/>)}</div>{videos.length>0&&<div className="journey-library-videos"><h4>الفيديوهات · {videos.length.toLocaleString('ar-EG')}</h4>{[...playlists].map(([title,items])=><details className="station-video-group" key={title}><summary>{title} <span>({items.length.toLocaleString('ar-EG')} حلقة)</span></summary>{items.map(resource=><ResourceLink key={resource.id} resource={resource}/>)}</details>)}</div>}</section>;
    })}</div>
  </section>;
}

export default function LearningJourney({value,onChange,admin=false}:{value?:Curriculum;onChange:(value:Curriculum)=>void;admin?:boolean}) {
  const pdfPageCounts=usePdfPageCounts();
  const data=value??initialCurriculum();
  const [mode,setMode]=useState<'preview'|'published'|'editor'>(admin?'editor':'preview');
  const [selected,setSelected]=useState(data.units[0]?.id??'');
  const [station,setStation]=useState(0);
  const [ack,setAck]=useState(false);
  const [message,setMessage]=useState('');
  const published:Unit[]=[];
  for(const unit of data.units){if(unit.status!=='published')break;published.push(unit);}
  const pathUnits=mode==='published'?published:data.units;
  const available=availableUnits(pathUnits,data.progress);
  const openIds=new Set(available.map(u=>u.id));
  const current=available.find(u=>u.id===selected)??available[available.length-1];
  const completed=current?Math.min(7,data.progress[current.id]??0):0;
  const currentStation=Math.min(station,Math.min(completed,6));
  const changeMode=(next:typeof mode)=>{setMode(next);setStation(0);setAck(false);setMessage('');};
  const saveUnit=(unit:Unit)=>{const exists=data.units.some(u=>u.id===unit.id);onChange({...data,units:exists?data.units.map(u=>u.id===unit.id?unit:u):[...data.units,unit],progress:exists?data.progress:{...data.progress,[unit.id]:0}});setMessage('جارٍ حفظ المسودة. يلزم مراجعتها قبل النشر.');};
  return <PdfPageCountsContext.Provider value={pdfPageCounts}><div className="learning-journey" dir="rtl">
    <header className="learning-overview"><div className="page-intro learning-intro"><span className="eyebrow">مسيرة الربانيين · العقيدة وبناء المعنى</span><h1>{admin?'إدارة موارد المنهج':'السير إلى الله'}</h1><p>{admin?'أضف المصادر والكتب والفيديوهات، وعدّلها واربطها بخطوات التعلم.':'محطات متدرجة على الطريق إلى الله؛ لا تُفتح المحطة التالية إلا بعد إتمام ما قبلها. يجمع المسار بين التعلم والتأمل والعمل.'}</p>{admin&&<a className="journey-library-jump" href="#journey-resource-library"><BookOpen size={16}/> استعراض مكتبة المحطات</a>}</div>{admin&&<div className="learning-overview-actions"><div className="learning-toolbar" role="group" aria-label="طريقة عرض المنهج">
      <button className={mode==='preview'?'primary':'soft-btn'} onClick={()=>changeMode('preview')}><BookOpen size={17}/> معاينة المنهج</button>
      <button className={mode==='published'?'primary':'soft-btn'} onClick={()=>changeMode('published')}>المحتوى المنشور</button>
      <button className={mode==='editor'?'primary':'soft-btn'} onClick={()=>changeMode('editor')}><Settings2 size={17}/> إدارة المحتوى التجريبية</button>
    </div><p className="learning-context-note">{mode==='preview'?'معاينة ما سيظهر للقارئ.':mode==='published'?'المحطات المنشورة في المنهج.':'تحرير المحتوى ومراجعته قبل نشره.'}</p></div>}</header>
    {message&&<p className="hint" role="status">{message}</p>}
    {admin&&mode==='editor'?<><CurriculumEditor data={data} onSave={saveUnit} onChange={onChange}/><JourneyResourceLibrary units={data.units}/></>:<>
      {!current?<section className="panel"><h2>المنهج في مرحلة الإعداد</h2><p className="muted">لم تُنشر المحطة الأولى بعد. يمكنك تجربة المسودات من «معاينة المنهج» أو مراجعتها في إدارة المحتوى.</p></section>:<>
        <div className="journey-vertical-layout"><aside className="journey-navigation">{pathUnits.length>0&&<nav className="path-roadmap" aria-label="محطات الطريق إلى الله"><div className="path-roadmap-head"><h2>محطات الطريق إلى الله</h2><small>مسار متدرج: لا تُفتح المحطة التالية إلا بعد إتمام خطوات ما قبلها كلها.</small></div><ol className="path-roadmap-list">{pathUnits.map((u,i)=>{
          const stationProgress=data.progress[u.id]??0;
          const stationDone=stationProgress>=7;
          const stationLocked=!openIds.has(u.id);
          return <li key={u.id}><button type="button" className={`path-station${stationLocked?' locked':stationDone?' done':' open'}${u.id===current.id?' selected':''}`} disabled={stationLocked} aria-current={u.id===current.id?'page':undefined} onClick={()=>{setSelected(u.id);setStation(0);setAck(false)}}><span className="path-station-icon" aria-hidden="true">{stationLocked?<Lock size={17}/>:stationDone?<Check size={19}/>:String(i+1).padStart(2,'0')}</span><span className="path-station-name">{u.title}{u.focus&&<span className="path-station-focus">{u.focus}</span>}<span className="path-station-summary">{u.summary}</span><small>{stationLocked?'مغلقة · أتمم خطوات محطتك الحالية لتُفتح':stationDone?'مكتملة · يمكنك الرجوع إليها':stationProgress>0?`جارية · أنجزت ${stationProgress} من ٧ خطوات`:'جاهزة · ابدأ خطواتها الآن'}</small></span></button></li>;})}</ol></nav>}
        <nav className="learning-stations" aria-label="خطوات المحطة"><h3>خطوات هذه المحطة</h3>{stationTitles.map((title,i)=><button key={title} disabled={i>completed} aria-current={i===currentStation?'step':undefined} className={`${i===currentStation?'selected ':''}${i<completed?'finished':''}`} onClick={()=>{setStation(i);setAck(false)}}><span>{i<completed?<Check size={15}/>:i+1}</span><span>{title}</span></button>)}</nav></aside><div className="journey-main-column"><section className="learning-hero"><span className="eyebrow">المحطة {pathUnits.findIndex(u=>u.id===current.id)+1} · {admin?(mode==='preview'?'معاينة المسودة':statusLabels[current.status]):'مسار التعلم'}</span><h2>{current.title}</h2>{current.focus&&<p className="learning-hero-focus">{current.focus}</p>}<p>{current.summary}</p><div className="learning-meter"><span>تقدمك في هذه المحطة: {completed} من ٧ خطوات</span><progress max="7" value={completed} aria-label="خطوات المحطة المكتملة"/></div></section>
          <article className="panel learning-article" aria-label={stationTitles[currentStation]}>{current.stations[currentStation]?.body&&<p className="lesson-prose">{current.stations[currentStation].body}</p>}
            {current.resources.some(r=>r.kind!=='video'&&current.stations[currentStation].sourceIds.includes(r.id))&&<div className="station-sources"><h3>مصادر هذه المحطة</h3><ol className="station-source-list">{current.resources.filter(r=>r.kind!=='video'&&current.stations[currentStation].sourceIds.includes(r.id)).map(resource=><li key={resource.id}><ResourceLink resource={resource}/></li>)}</ol></div>}
            <StationVideos unit={current} station={currentStation}/><div className="lesson-action">{completed<7 && currentStation===completed?<><label className="learning-ack"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/> اطلعت على المادة وفهمت فكرتها الأساسية، أو حددت ما أحتاج إلى السؤال عنه.</label><button className="primary" disabled={!ack} onClick={()=>{onChange({...data,progress:{...data.progress,[current.id]:completed+1}});setStation(Math.min(6,completed+1));setAck(false)}}>إتمام الخطوة والمتابعة <Check size={16}/></button></>:<p className="success-text"><Check size={17}/> هذه الخطوة مكتملة، ويمكنك الرجوع إليها.</p>}</div>
            <div className="station-pager" aria-label="التنقل بين الخطوات"><button type="button" className="soft-btn" disabled={currentStation===0} onClick={()=>{setStation(currentStation-1);setAck(false)}}>الخطوة السابقة</button><span>{currentStation+1} / ٧</span><button type="button" className="soft-btn" disabled={currentStation>=Math.min(completed,6)} onClick={()=>{setStation(currentStation+1);setAck(false)}}>الخطوة التالية</button></div>
            {completed===7&&<div className="unit-finished"><p>أتممت خطوات هذه المحطة. يمكنك الرجوع إليها في أي وقت.</p>{available.findIndex(u=>u.id===current.id)<available.length-1?<button className="primary" onClick={()=>{const next=available[available.findIndex(u=>u.id===current.id)+1];setSelected(next.id);setStation(0);setAck(false)}}>انتقل إلى المحطة التالية</button>:<p className="muted">أتممت المحطات المتاحة حاليًا. تُفتح ما بعدها بتوافر محتوى جديد.</p>}</div>}
          </article>
        </div></div>
        
        {admin&&<JourneyResourceLibrary units={pathUnits}/>}
        <p className="muted small">الترتيب لتنظيم التعلم، ولا يقيس الإيمان أو الإخلاص. المعارف الضرورية للفرائض لا ينبغي حجبها خلف المنهج.</p>
      </>}
    </>}
  </div></PdfPageCountsContext.Provider>;
}

function CurriculumEditor({data,onSave,onChange}:{data:Curriculum;onSave:(unit:Unit)=>void;onChange:(data:Curriculum)=>void}) {
  const [selected,setSelected]=useState(data.units[0]?.id??'');
  const [newUnit,setNewUnit]=useState<Unit|null>(null);
  const [dirty,setDirty]=useState(false);
  const [notice,setNotice]=useState('');
  const selectedUnit=newUnit??data.units.find(u=>u.id===selected);
  const choose=(id:string)=>{if(dirty){setNotice('احفظ تعديلاتك أو ألغها قبل الانتقال إلى محطة أخرى.');return;}setNewUnit(null);setSelected(id);setNotice('');};
  const reorder=(id:string,direction:number)=>{if(dirty){setNotice('احفظ التعديلات أو ألغها قبل إعادة الترتيب.');return;}const units=[...data.units];const index=units.findIndex(u=>u.id===id);const other=index+direction;if(other<0||other>=units.length)return;[units[index],units[other]]=[units[other],units[index]];onChange({...data,units});};
  return <>
    <div className="hint">تُحفظ تعديلات المصادر في المنهج المشترك، وتحتاج المحطات المعدّلة إلى مراجعة جديدة قبل النشر. احفظ تعديل نص المحطة قبل إدارة مصادرها.</div>
    {notice&&<p role="status" className="hint">{notice}</p>}
    <div className="editor-layout"><aside className="panel editor-units"><h3>محطات المنهج</h3>{data.units.map((u,i)=><div className="editor-unit" key={u.id}><button className={selectedUnit?.id===u.id?'selected':''} onClick={()=>choose(u.id)}>{i+1}. {u.title}{u.focus&&<span className="path-station-focus">{u.focus}</span>}<span className="path-station-summary">{u.summary}</span><small>{statusLabels[u.status]}</small></button><div className="reorder-buttons"><button type="button" className="icon-btn" disabled={i===0||dirty} aria-label={`تقديم ${u.title}`} onClick={()=>reorder(u.id,-1)}><ArrowUp size={14}/></button><button type="button" className="icon-btn" disabled={i===data.units.length-1||dirty} aria-label={`تأخير ${u.title}`} onClick={()=>reorder(u.id,1)}><ArrowDown size={14}/></button></div></div>)}<button className="soft-btn" onClick={()=>{if(dirty){setNotice('احفظ التعديلات أو ألغها أولًا.');return;}setNewUnit({id:uid(),title:'',summary:'',stations:stationTitles.map(()=>({body:'',sourceIds:[]})),resources:[],status:'draft',revision:0,reviewer:'',reviewNote:''});setNotice('');}}><Plus size={16}/> محطة جديدة</button></aside>
    {selectedUnit&&<div>{!newUnit&&<ResourceManager data={data} unit={selectedUnit} disabled={dirty} onChange={onChange}/>}<UnitEditor key={`${selectedUnit.id}-${selectedUnit.revision}-${selectedUnit.status}`} unit={selectedUnit} onDirty={setDirty} onSave={unit=>{onSave(unit);setSelected(unit.id);setNewUnit(null);setDirty(false);setNotice('تم حفظ المسودة.');}} onStatus={unit=>{onChange({...data,units:data.units.map(u=>u.id===unit.id?unit:u)});setNotice('جارٍ حفظ حالة المحطة.');}}/></div>}</div>
  </>;
}

function UnitEditor({unit,onSave,onStatus,onDirty}:{unit:Unit;onSave:(unit:Unit)=>void;onStatus:(unit:Unit)=>void;onDirty:(dirty:boolean)=>void}) {
  const [draft,setDraft]=useState<Unit>(()=>structuredClone(unit));
  const [dirty,setDirty]=useState(false);
  const [error,setError]=useState('');
  const [reviewer,setReviewer]=useState('');
  const [reviewNote,setReviewNote]=useState('');
  const change=(next:Unit)=>{setDraft(next);setDirty(true);onDirty(true);setError('');};
  const transition=(status:Unit['status'])=>{try{if(dirty)throw new Error('احفظ التعديلات أولًا.');onStatus(transitionUnit(unit,status,reviewer,reviewNote));setError('');}catch(e){setError(e instanceof Error?e.message:'تعذر تحديث الحالة.');}};
  return <section className="panel unit-editor"><div className="editor-title"><h2>تحرير المحطة</h2><span className="subtle-tag">{dirty?'تعديلات غير محفوظة':statusLabels[unit.status]} · النسخة {unit.revision}</span></div>
    <form onSubmit={e=>{e.preventDefault();if(!draft.title.trim()){setError('أدخل عنوان المحطة.');return;}if(draft.resources.some(r=>r.url&&!safeUrl(r.url))){setError('روابط المواد يجب أن تبدأ بـ https:// أو http:// دون بيانات دخول.');return;}onSave(reviseUnit(draft));setDirty(false);onDirty(false);}}>
      <label>عنوان المحطة<input required maxLength={180} value={draft.title} onChange={e=>change({...draft,title:e.target.value})}/></label>
      <label>محاور المحطة<input maxLength={250} value={draft.focus??''} onChange={e=>change({...draft,focus:e.target.value})}/></label>
      <label>هدف المحطة وملخصها<textarea rows={3} maxLength={2000} value={draft.summary} onChange={e=>change({...draft,summary:e.target.value})}/></label>
      <h3 className="editor-section-heading">الخطوات السبع · كتابة مباشرة</h3>
      {draft.stations.map((s,i)=><details className="station-editor" key={i} open={i===0}><summary>{i+1}. {stationTitles[i]}</summary><label>نص الخطوة {i+1}<textarea rows={6} maxLength={12000} value={s.body} onChange={e=>change({...draft,stations:draft.stations.map((x,j)=>i===j?{...x,body:e.target.value}:x)})}/></label><fieldset><legend>مصادر هذه الخطوة</legend>{draft.resources.length===0?<p className="muted small">أضف المصادر في الأسفل ثم اربطها بالخطوة.</p>:draft.resources.map(r=><label className="source-check" key={r.id}><input type="checkbox" checked={s.sourceIds.includes(r.id)} onChange={e=>change({...draft,stations:draft.stations.map((x,j)=>i===j?{...x,sourceIds:e.target.checked?[...x.sourceIds,r.id]:x.sourceIds.filter(id=>id!==r.id)}:x)})}/>{r.title||'مادة دون عنوان'} · {r.level==='basic'?'أساسي':'استزادة'}</label>)}</fieldset></details>)}
      <div className="editor-save"><button className="primary" type="submit">حفظ كمسودة</button><button className="soft-btn" type="button" disabled={!dirty} onClick={()=>{setDraft(structuredClone(unit));setDirty(false);onDirty(false);setError('');}}>إلغاء التعديلات</button><small>كل تعديل محفوظ يحتاج مراجعة جديدة.</small></div>
    </form>
    {error&&<p className="schedule-warning" role="alert">{error}</p>}
    <section className="review-workflow"><h3>المراجعة والنشر المحلي</h3><p className="muted small">مسودة ← مراجعة ← اعتماد ← نشر. هذه أدوات لتجربة دورة المحتوى وليست إثباتًا لمراجعة شرعية مستقلة.</p>
      {unit.reviewer&&<p className="review-record">المراجع المسجل: {unit.reviewer}<br/>{unit.reviewNote}</p>}
      {unit.status==='draft'&&<><button className="soft-btn" disabled={dirty||unit.revision===0} onClick={()=>transition('review')}>إرسال للمراجعة</button>{unitErrors(unit).length>0&&<p className="muted small">قبل الإرسال: {unitErrors(unit).join(' ')}</p>}</>}
      {unit.status==='review'&&<><label>اسم المراجع<input value={reviewer} onChange={e=>setReviewer(e.target.value)}/></label><label>ملاحظة المراجعة ومصادر التحقق<textarea rows={3} value={reviewNote} onChange={e=>setReviewNote(e.target.value)}/></label><button className="primary" disabled={dirty} onClick={()=>transition('approved')}>تسجيل اعتماد محلي</button></>}
      {unit.status==='approved'&&<button className="primary" disabled={dirty} onClick={()=>transition('published')}>نشر داخل التجربة المحلية</button>}
      {unit.status!=='draft'&&<button className="soft-btn" disabled={dirty} onClick={()=>transition('draft')}>إعادة إلى مسودة / سحب النشر</button>}
    </section>
  </section>;
}

