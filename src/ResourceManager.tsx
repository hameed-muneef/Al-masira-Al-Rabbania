import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowDown,ArrowUp,Plus,Trash2,X} from 'lucide-react';
import {kindLabels,reviseUnit,safeUrl,stationTitles,type Curriculum,type Resource,type Unit} from './curriculum';
import {assignResource,removeResource,reorderResource} from './resource-management';
import {uploadBookPdf} from './book-upload';
import {uid} from './id';
import './resource-manager.css';

type Props={data:Curriculum;unit:Unit;disabled:boolean;onChange:(data:Curriculum)=>void};
export default function ResourceManager({data,unit,disabled,onChange}:Props){
  const [editing,setEditing]=useState<Resource|null>(null);
  const saveUnit=(next:Unit)=>onChange({...data,units:data.units.map(item=>item.id===next.id?reviseUnit(next):item)});
  return <section className="panel resource-manager" aria-label="إدارة المصادر">
    <div className="editor-title"><div><h2>المكتبة والمصادر</h2><p>{unit.resources.length.toLocaleString('ar-EG')} مصدر · {unit.title}</p></div><button type="button" className="primary" disabled={disabled} onClick={()=>setEditing({id:uid(),kind:'book',title:'',author:'',reference:'',url:'',level:'extra'})}><Plus size={18}/> إضافة مصدر</button></div>
    <p className="muted small">تُحفظ تغييرات المصادر مباشرة. افتح المصدر لتعديل بياناته أو نقله إلى محطة أخرى وتحديد خطوات ظهوره.</p>
    {disabled&&<p role="status">احفظ تعديلات نص المحطة أو ألغها أولًا.</p>}
    {unit.resources.length===0&&<p className="muted">لا توجد مصادر بعد. أضف مصدرًا من الزر أعلاه.</p>}
    <ol className="managed-resources">{unit.resources.map((resource,index)=><li key={resource.id}>
      <button type="button" className="managed-resource-title" disabled={disabled} onClick={()=>setEditing(resource)}><strong>{resource.title||'مصدر دون عنوان'}</strong><small>{kindLabels[resource.kind]} · {resource.level==='basic'?'أساسي':'استزادة'} · {unit.stations.filter(station=>station.sourceIds.includes(resource.id)).length} خطوة</small></button>
      <div className="managed-resource-actions"><button type="button" className="icon-btn" disabled={disabled||index===0} aria-label={`تقديم ${resource.title}`} onClick={()=>saveUnit(reorderResource(unit,resource.id,-1))}><ArrowUp size={17}/></button><button type="button" className="icon-btn" disabled={disabled||index===unit.resources.length-1} aria-label={`تأخير ${resource.title}`} onClick={()=>saveUnit(reorderResource(unit,resource.id,1))}><ArrowDown size={17}/></button><button type="button" className="icon-btn danger" disabled={disabled} aria-label={`حذف ${resource.title}`} onClick={()=>{if(window.confirm(`حذف «${resource.title}» وروابطه من هذه المحطة؟ سيُحذف الملف المرفوع من التخزين بعد الحفظ إذا لم يعد مستخدمًا في المنهج أو الأرشيف. الروابط الخارجية والملفات المرفقة بالتطبيق لا تُحذف من خادمها.`))saveUnit(removeResource(unit,resource.id))}}><Trash2 size={17}/></button></div>
    </li>)}</ol>
    {editing&&<ResourceDialog resource={editing} unit={unit} units={data.units} onClose={()=>setEditing(null)} onSave={(resource,target,stations)=>{const next=assignResource(data,unit.id,target,resource,stations);onChange(next);setEditing(null)}}/>}
  </section>;
}

function ResourceDialog({resource,unit,units,onClose,onSave}:{resource:Resource;unit:Unit;units:Unit[];onClose:()=>void;onSave:(resource:Resource,target:string,stations:number[])=>void}){
  const [draft,setDraft]=useState({...resource});
  const [target,setTarget]=useState(unit.id);
  const [stations,setStations]=useState(()=>unit.stations.flatMap((station,index)=>station.sourceIds.includes(resource.id)?[index]:[]));
  const [file,setFile]=useState<File|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.showModal();return()=>previous?.focus()},[]);
  const patch=(value:Partial<Resource>)=>setDraft(current=>({...current,...value}));
  const save=async()=>{
    if(busy)return;
    setError('');
    if(!draft.title.trim()||!draft.author.trim()||!draft.reference.trim()){setError('أكمل العنوان والمؤلف والمرجع التفصيلي.');return}
    if(!file&&!safeUrl(draft.url)){setError('أدخل رابطًا صالحًا أو اختر ملف PDF.');return}
    if(target!==unit.id&&units.find(item=>item.id===target)?.resources.some(item=>item.id===draft.id)){setError('المصدر موجود بالفعل في المحطة المختارة.');return}
    setBusy(true);
    try{
      const next={...draft,title:draft.title.trim(),author:draft.author.trim(),reference:draft.reference.trim(),url:file?await uploadBookPdf(file):draft.url.trim()};
      setDraft(next);setFile(null);
      onSave(next,target,stations);
    }catch(cause){setError(cause instanceof Error?cause.message:'تعذر حفظ المصدر. حاول مرة أخرى.')}
    finally{setBusy(false)}
  };
  return createPortal(<dialog ref={dialog} className="resource-dialog" dir="rtl" aria-labelledby="resource-dialog-title" onCancel={event=>{event.preventDefault();if(!busy)onClose()}}>
    <header><h2 id="resource-dialog-title">{unit.resources.some(item=>item.id===resource.id)?'تعديل المصدر':'إضافة مصدر جديد'}</h2><button type="button" className="icon-btn" disabled={busy} aria-label="إغلاق نافذة المصدر" onClick={onClose}><X size={22}/></button></header>
    <form onSubmit={event=>{event.preventDefault();void save()}}><fieldset disabled={busy} className="resource-dialog-fields">
      <div className="form-grid"><label>نوع المصدر<select value={draft.kind} onChange={event=>{patch({kind:event.target.value as Resource['kind']});setFile(null)}}><option value="source">مصدر</option><option value="book">كتاب</option><option value="video">فيديو</option></select></label><label>المستوى<select value={draft.level} onChange={event=>patch({level:event.target.value as Resource['level']})}><option value="basic">أساسي</option><option value="extra">استزادة اختيارية</option></select></label>
      <label>العنوان<input autoFocus required maxLength={250} value={draft.title} onChange={event=>patch({title:event.target.value})}/></label><label>المؤلف / المتحدث / الجهة<input required maxLength={250} value={draft.author} onChange={event=>patch({author:event.target.value})}/></label><label className="full-width">المرجع التفصيلي<input required maxLength={500} value={draft.reference} onChange={event=>patch({reference:event.target.value})}/></label><label className="full-width">رابط المصدر<input dir="ltr" maxLength={2000} disabled={!!file} value={draft.url} placeholder="https://…" onChange={event=>patch({url:event.target.value})}/></label>
      {draft.kind==='book'&&<label className="full-width">أو رفع كتاب PDF (حتى ٥٠ ميغابايت)<input type="file" accept=".pdf,application/pdf" onChange={event=>setFile(event.target.files?.[0]??null)}/><small>يبدأ الرفع عند الضغط على حفظ. {file?.name}</small></label>}
      <label className="full-width">المحطة / الجزء<select value={target} onChange={event=>{setTarget(event.target.value);setStations([])}}>{units.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select><small>اختيار محطة أخرى ينقل المصدر إليها دون نسخ الملف.</small></label></div>
      <fieldset className="resource-stations"><legend>خطوات ظهور المصدر</legend>{(units.find(item=>item.id===target)?.stations??[]).map((_,index)=><label key={index}><input type="checkbox" checked={stations.includes(index)} onChange={event=>setStations(current=>event.target.checked?[...current,index]:current.filter(value=>value!==index))}/>{stationTitles[index]}</label>)}</fieldset>
      {error&&<p className="schedule-warning" role="alert">{error}</p>}<footer><button className="primary" type="submit">{busy?'جارٍ الرفع والحفظ…':'حفظ المصدر'}</button><button className="soft-btn" type="button" onClick={onClose}>إلغاء</button></footer>
    </fieldset></form>
  </dialog>,document.body);
}
