import {useEffect,useState,type FormEvent} from 'react';
import {authClient} from '../auth';

type Lesson={id:string;position:number;title:string;description:string;starts_at:string|null;youtube_url:string};
const empty={title:'',description:'',youtubeUrl:''};
export default function CourseLessons({courseId,editable}:{courseId:string;editable:boolean}){
  const [rows,setRows]=useState<Lesson[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [draft,setDraft]=useState(empty);
  const [editingId,setEditingId]=useState<string|null>(null);
  const load=async()=>{
    if(!authClient)return;setLoading(true);setError('');
    try{
      const {data,error:loadError}=await authClient.from('course_lessons').select('id,position,title,description,starts_at,youtube_url').eq('course_id',courseId).order('position');
      if(loadError)throw loadError;setRows((data??[]) as Lesson[]);
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر تحميل الدروس.')}
    finally{setLoading(false)}
  };
  useEffect(()=>{void load()},[courseId]);
  const save=async(event:FormEvent)=>{
    event.preventDefault();if(!authClient||busy)return;
    setBusy(true);setError('');
    try{
      const position=editingId?rows.find(row=>row.id===editingId)?.position:Math.max(0,...rows.map(row=>row.position))+1;
      const {error:saveError}=await authClient.rpc('save_course_lesson',{p_course_id:courseId,p_lesson_id:editingId,p_position:position,p_title:draft.title.trim(),p_description:draft.description.trim(),p_starts_at:null,p_youtube_url:draft.youtubeUrl.trim()});
      if(saveError)throw saveError;setDraft(empty);setEditingId(null);await load();
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر حفظ الدرس.')}
    finally{setBusy(false)}
  };
  const remove=async(id:string)=>{
    if(!authClient||busy)return;setBusy(true);setError('');
    try{
      const {error:removeError}=await authClient.rpc('remove_course_lesson',{p_course_id:courseId,p_lesson_id:id});
      if(removeError)throw removeError;await load();
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر إزالة الدرس.')}
    finally{setBusy(false)}
  };
  return <div className="course-lessons"><h4>دروس المجلس</h4>
    {error&&<p className="teacher-notice error" role="alert">{error} <button className="soft-btn" onClick={()=>void load()}>إعادة المحاولة</button></p>}
    {loading?<p role="status">جارٍ تحميل الدروس…</p>:rows.length===0?<p className="muted">لا دروس في هذا المجلس بعد.</p>:<ol>{rows.map(row=><li key={row.id}><div><strong>{row.title}</strong>{row.description&&<p>{row.description}</p>}{row.youtube_url&&<a href={row.youtube_url} target="_blank" rel="noopener noreferrer">رابط YouTube</a>}</div>{editable&&<span className="course-actions"><button className="soft-btn" onClick={()=>{setEditingId(row.id);setDraft({title:row.title,description:row.description,youtubeUrl:row.youtube_url})}}>تعديل</button><button className="soft-btn" disabled={busy} onClick={()=>void remove(row.id)}>إزالة</button></span>}</li>)}</ol>}
    {editable&&<form onSubmit={event=>void save(event)}>
      <h5>{editingId?'تعديل الدرس':'إضافة درس'}</h5>
      <label>العنوان<input required minLength={3} maxLength={160} value={draft.title} onChange={event=>setDraft(current=>({...current,title:event.target.value}))}/></label>
      <label>الوصف<textarea rows={2} maxLength={3000} value={draft.description} onChange={event=>setDraft(current=>({...current,description:event.target.value}))}/></label>
      <label>رابط YouTube اختياري<input type="url" maxLength={500} value={draft.youtubeUrl} onChange={event=>setDraft(current=>({...current,youtubeUrl:event.target.value}))}/></label>
      <div className="course-actions"><button className="primary" type="submit" disabled={busy||rows.length>=100}>{busy?'جارٍ الحفظ…':editingId?'حفظ التعديل':'إضافة الدرس'}</button>{editingId&&<button className="soft-btn" type="button" onClick={()=>{setEditingId(null);setDraft(empty)}}>إلغاء التعديل</button>}</div>
    </form>}
  </div>;
}
