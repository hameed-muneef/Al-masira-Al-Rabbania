import {useEffect,useState} from 'react';
import {authClient} from '../auth';
import type {User} from '@supabase/supabase-js';

type Application={user_id:string;display_name:string;biography:string;mentor_type:string;qualifications:string;specialties:string[];languages:string[];directory_visible:boolean;status:string;review_note:string;submitted_at:string};
const names:Record<string,string>={scholar:'عالم أو طالب علم مؤهل',educator:'مربٍ',mentor:'مرشد تربوي',counselor:'مقدم توجيه عام'};
const statuses:Record<string,string>={submitted:'قيد المراجعة',approved:'معتمد',rejected:'مرفوض',suspended:'معلّق'};

export default function TawasiMentorReviewPanel({user}:{user:User}){
  const[rows,setRows]=useState<Application[]>([]);const[selected,setSelected]=useState<string|null>(null);const[status,setStatus]=useState('approved');const[note,setNote]=useState('');const[loading,setLoading]=useState(true);const[busy,setBusy]=useState(false);const[error,setError]=useState('');const[notice,setNotice]=useState('');
  const load=async()=>{if(!authClient)return;setLoading(true);setError('');try{const{data,error:rpcError}=await authClient.rpc('list_tawasi_mentor_applications');if(rpcError)throw rpcError;setRows((data??[]) as Application[])}catch(caught){setError(caught instanceof Error?caught.message:'تعذر تحميل ملفات المرشدين.')}finally{setLoading(false)}};
  useEffect(()=>{void load()},[user.id]);
  const active=rows.find(row=>row.user_id===selected);
  const submit=async()=>{if(!authClient||!active||busy||!note.trim())return;setBusy(true);setError('');setNotice('');try{const{error:rpcError}=await authClient.rpc('review_tawasi_mentor',{p_mentor_id:active.user_id,p_status:status,p_note:note.trim()});if(rpcError)throw rpcError;setNotice('حُفظ قرار اعتماد المرشد وسُجل للمراجعة.');setSelected(null);setNote('');await load()}catch(caught){setError(caught instanceof Error?caught.message:'تعذر حفظ قرار المراجعة.')}finally{setBusy(false)}};
  return <section className="panel tawasi-admin-review" aria-labelledby="tawasi-admin-review-title"><h2 id="tawasi-admin-review-title">اعتماد مرشدي التواصي</h2><p className="muted">اعتماد المرشد مستقل عن اعتماد المعلم. لا يُعرض الملف إلا بعد الموافقة الصريحة على الظهور في الدليل.</p>
    {error&&<p className="circles-notice error" role="alert">{error} <button className="soft-btn" onClick={()=>void load()}>إعادة المحاولة</button></p>}{notice&&<p className="circles-notice" role="status">{notice}</p>}
    {loading?<p role="status">جارٍ تحميل الطلبات…</p>:rows.length===0?<p>لا توجد ملفات مرشدين بعد.</p>:<ul className="tawasi-admin-list">{rows.map(row=><li key={row.user_id}><strong>{row.display_name}</strong><span>{names[row.mentor_type]??row.mentor_type} · {statuses[row.status]??row.status}</span><button className="soft-btn" onClick={()=>{setSelected(row.user_id);setStatus(row.status==='suspended'?'suspended':'approved');setNote('')}}>مراجعة الملف</button></li>)}</ul>}
    {active&&<div className="tawasi-admin-detail"><h3>{active.display_name}</h3><p><strong>الصفة:</strong> {names[active.mentor_type]??active.mentor_type}</p><p><strong>المؤهلات:</strong> {active.qualifications}</p><p><strong>التخصصات:</strong> {active.specialties.join('، ')||'لم تذكر'}</p><p><strong>النبذة:</strong> {active.biography||'لم تذكر'}</p><p>موافقة الدليل: {active.directory_visible?'نعم':'لا'}</p><label>القرار<select value={status} onChange={event=>setStatus(event.target.value)}><option value="approved">اعتماد</option><option value="rejected">رفض الطلب</option><option value="suspended">تعليق المرشد</option></select></label><label>سبب القرار<textarea required maxLength={2000} rows={3} value={note} onChange={event=>setNote(event.target.value)}/></label><div><button className="primary" disabled={busy||!note.trim()} onClick={()=>void submit()}>{busy?'جارٍ الحفظ…':'حفظ القرار'}</button><button className="soft-btn" onClick={()=>setSelected(null)}>إلغاء</button></div></div>}
  </section>;
}
