import {useEffect,useState,type FormEvent} from 'react';
import {authClient} from '../auth';

type Material={material_id:string;material_position:number;material_kind:string;material_title:string;material_body:string;material_url:string};
export default function CourseMaterials({courseId,editable}:{courseId:string;editable:boolean}){
  const [materials,setMaterials]=useState<Material[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [form,setForm]=useState({position:'1',kind:'link',title:'',body:'',url:''});
  const load=async()=>{
    if(!authClient)return;setLoading(true);setError('');
    try{
      const {data,error:loadError}=await authClient.rpc('list_course_materials',{p_course_id:courseId});
      if(loadError)throw loadError;setMaterials((data??[]) as Material[]);
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر تحميل المواد.')}
    finally{setLoading(false)}
  };
  useEffect(()=>{void load()},[courseId]);
  const save=async(event:FormEvent)=>{
    event.preventDefault();if(!authClient||busy)return;
    const pos=Number(form.position);
    if(!Number.isInteger(pos)||pos<1||pos>100||!form.title.trim()){setError('تحقق من الموضع والعنوان.');return}
    if(form.kind==='link'&&!form.url.trim()){setError('رابط المادة مطلوب.');return}
    setBusy(true);setError('');
    try{
      const {error:rpcError}=await authClient.rpc('save_course_material',{p_course_id:courseId,p_material_id:null,p_position:pos,p_kind:form.kind,p_title:form.title.trim(),p_body:form.body.trim(),p_url:form.url.trim()});
      if(rpcError)throw rpcError;
      setForm({position:String(pos+1),kind:'link',title:'',body:'',url:''});await load();
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر حفظ المادة.')}
    finally{setBusy(false)}
  };
  const remove=async(id:string)=>{
    if(!authClient||busy)return;setBusy(true);setError('');
    try{
      const {error:rpcError}=await authClient.rpc('remove_course_material',{p_course_id:courseId,p_material_id:id});
      if(rpcError)throw rpcError;await load();
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر حذف المادة.')}
    finally{setBusy(false)}
  };
  return <div className="course-materials">
    <h3>المواد التعليمية</h3>
    {error&&<p className="teacher-notice error" role="alert">{error}</p>}
    {loading?<p role="status">جارٍ تحميل المواد…</p>:materials.length===0?<p className="muted">لا مواد بعد.</p>:<ul className="course-list">{materials.map(m=><li key={m.material_id}><div><strong>{m.material_title}</strong>{m.material_kind==='link'&&m.material_url&&<p><a href={m.material_url} target="_blank" rel="noreferrer">{m.material_url}</a></p>}{m.material_body&&<p className="muted small">{m.material_body}</p>}</div>{editable&&<button className="soft-btn" disabled={busy} onClick={()=>void remove(m.material_id)}>حذف</button>}</li>)}</ul>}
    {editable&&<form onSubmit={event=>void save(event)}>
      <label>الموضع<input type="number" min={1} max={100} value={form.position} onChange={e=>setForm(c=>({...c,position:e.target.value}))}/></label>
      <label>النوع<select value={form.kind} onChange={e=>setForm(c=>({...c,kind:e.target.value}))}><option value="link">رابط</option><option value="text">نص</option><option value="file">ملف (رابط)</option></select></label>
      <label>العنوان<input required maxLength={200} value={form.title} onChange={e=>setForm(c=>({...c,title:e.target.value}))}/></label>
      <label>النص<textarea rows={2} maxLength={10000} value={form.body} onChange={e=>setForm(c=>({...c,body:e.target.value}))}/></label>
      <label>الرابط<input type="url" maxLength={1000} value={form.url} onChange={e=>setForm(c=>({...c,url:e.target.value}))}/></label>
      <button className="primary" type="submit" disabled={busy}>{busy?'جارٍ…':'إضافة مادة'}</button>
    </form>}
  </div>;
}
