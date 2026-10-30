import {useEffect,useState,type FormEvent} from 'react';
import {authClient} from '../auth';
import '../teacher.css';

type Decision='pending'|'approved'|'rejected';
type Application={user_id:string;display_name:string;biography:string;specialties:string;qualifications:string;endorsement:string;identity_status:Decision;qualification_status:Decision;endorsement_status:Decision;status:string;review_note:string};
const decisions:Record<Decision,string>={pending:'قيد المراجعة',approved:'مقبول',rejected:'مرفوض'};
const statuses:Record<string,string>={submitted:'قيد المراجعة',approved:'معتمد',rejected:'مرفوض',suspended:'معلّق'};

export default function TeacherReviewPanel(){
  const [rows,setRows]=useState<Application[]>([]);
  const [selected,setSelected]=useState<string|null>(null);
  const [identity,setIdentity]=useState<Decision>('pending');
  const [qualification,setQualification]=useState<Decision>('pending');
  const [endorsement,setEndorsement]=useState<Decision>('pending');
  const [note,setNote]=useState('');
  const [suspend,setSuspend]=useState(false);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const load=async()=>{
    if(!authClient)return;
    setLoading(true);setError('');
    try{
      const {data,error:loadError}=await authClient.from('teacher_applications')
        .select('user_id,display_name,biography,specialties,qualifications,endorsement,identity_status,qualification_status,endorsement_status,status,review_note')
        .order('submitted_at',{ascending:false});
      if(loadError)throw loadError;setRows((data??[]) as Application[]);
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر تحميل طلبات المعلمين.')}
    finally{setLoading(false)}
  };
  useEffect(()=>{void load()},[]);
  const choose=(row:Application)=>{setSelected(row.user_id);setIdentity(row.identity_status);setQualification(row.qualification_status);setEndorsement(row.endorsement_status);setNote('');setSuspend(row.status==='suspended');setNotice('');setError('')};
  const submit=async(event:FormEvent)=>{
    event.preventDefault();if(!authClient||!selected||busy)return;
    setBusy(true);setError('');setNotice('');
    try{
      const {error:reviewError}=await authClient.rpc('review_teacher_application',{
        p_user_id:selected,p_identity_status:identity,p_qualification_status:qualification,
        p_endorsement_status:endorsement,p_note:note.trim(),p_suspend:suspend,
      });
      if(reviewError)throw reviewError;
      setNotice('سُجل القرار في سجل المراجعة.');setSelected(null);await load();
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر حفظ قرار المراجعة.')}
    finally{setBusy(false)}
  };
  const active=rows.find(row=>row.user_id===selected);
  return <section className="panel teacher-review-panel" aria-labelledby="teacher-review-title">
    <h2 id="teacher-review-title">طلبات اعتماد المعلمين</h2>
    <p className="muted">راجع الهوية والمؤهلات والتزكية بشكل مستقل. اعتماد الجوانب الثلاثة وحده يفتح صلاحية المعلم.</p>
    {error&&<p role="alert" className="teacher-notice error">{error} <button className="soft-btn" onClick={()=>void load()}>إعادة المحاولة</button></p>}
    {notice&&<p role="status" className="teacher-notice">{notice}</p>}
    {loading?<p role="status">جارٍ تحميل الطلبات…</p>:rows.length===0?<p>لا طلبات تدريس بعد.</p>:<ul className="teacher-review-list">{rows.map(row=><li key={row.user_id}><strong>{row.display_name}</strong><span>{statuses[row.status]??row.status}</span><button className="soft-btn" onClick={()=>choose(row)}>مراجعة الطلب</button></li>)}</ul>}
    {active&&<form className="teacher-review-form" onSubmit={event=>void submit(event)}>
      <h3>مراجعة: {active.display_name}</h3>
      <p><strong>نبذة:</strong> {active.biography||'لم تُذكر'}</p><p><strong>مجالات:</strong> {active.specialties||'لم تُذكر'}</p>
      <p><strong>المؤهلات:</strong> {active.qualifications}</p><p><strong>التزكية:</strong> {active.endorsement}</p>
      <label>الهوية<select value={identity} onChange={event=>setIdentity(event.target.value as Decision)}>{Object.entries(decisions).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label>المؤهلات<select value={qualification} onChange={event=>setQualification(event.target.value as Decision)}>{Object.entries(decisions).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label>التزكية<select value={endorsement} onChange={event=>setEndorsement(event.target.value as Decision)}>{Object.entries(decisions).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label className="teacher-suspend"><input type="checkbox" checked={suspend} onChange={event=>setSuspend(event.target.checked)}/> تعليق اعتماد المعلم</label>
      <label>سبب القرار<textarea required maxLength={2000} rows={3} value={note} onChange={event=>setNote(event.target.value)}/></label>
      <div className="teacher-review-actions"><button className="primary" disabled={busy} type="submit">{busy?'جارٍ الحفظ…':'حفظ القرار'}</button><button className="soft-btn" type="button" onClick={()=>setSelected(null)}>إلغاء</button></div>
    </form>}
  </section>;
}
