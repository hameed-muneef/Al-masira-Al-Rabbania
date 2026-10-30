import {useEffect,useState,type FormEvent} from 'react';
import {authClient} from '../auth';
import CourseManager from './CourseManager';
import TeacherStudentsPanel from './TeacherStudentsPanel';
import type {View} from '../app-state';
import '../teacher.css';

type Application={display_name:string;biography:string;specialties:string;qualifications:string;endorsement:string;identity_status:string;qualification_status:string;endorsement_status:string;status:string;review_note:string};
const labels:Record<string,string>={submitted:'قيد المراجعة',approved:'معتمد',rejected:'يحتاج تعديلًا',suspended:'معلّق',pending:'بانتظار المراجعة'};
const empty={display_name:'',biography:'',specialties:'',qualifications:'',endorsement:''};

export default function TeacherView({user,navigate}:{user:{id:string}|null;navigate:(view:View)=>void}){
  const [application,setApplication]=useState<Application|null>(null);
  const [draft,setDraft]=useState(empty);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const load=async()=>{
    if(!authClient||!user){setLoading(false);return}
    setLoading(true);setError('');
    try{
      const {data,error:loadError}=await authClient.from('teacher_applications').select('display_name,biography,specialties,qualifications,endorsement,identity_status,qualification_status,endorsement_status,status,review_note').eq('user_id',user.id).maybeSingle();
      if(loadError)throw loadError;
      setApplication(data as Application|null);
      if(data)setDraft({display_name:data.display_name,biography:data.biography,specialties:data.specialties,qualifications:data.qualifications,endorsement:data.endorsement});
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر تحميل طلب التدريس.')}
    finally{setLoading(false)}
  };
  useEffect(()=>{void load()},[user?.id]);
  const set=(key:keyof typeof empty,value:string)=>setDraft(current=>({...current,[key]:value}));
  const submit=async(event:FormEvent)=>{
    event.preventDefault();if(!authClient||busy)return;
    setBusy(true);setError('');setNotice('');
    try{
      const {error:saveError}=await authClient.rpc('submit_teacher_application',{
        p_display_name:draft.display_name.trim(),p_biography:draft.biography.trim(),p_specialties:draft.specialties.trim(),
        p_qualifications:draft.qualifications.trim(),p_endorsement:draft.endorsement.trim(),
      });
      if(saveError)throw saveError;
      setNotice('وصل طلبك للمراجعة. تقديمه لا يمنح صلاحية نشر الدورات.');await load();
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر إرسال الطلب.')}
    finally{setBusy(false)}
  };
  const locked=application?.status==='approved'||application?.status==='suspended';
  return <div className="teacher-view">
    <div className="page-intro"><span className="eyebrow">مجالس العلم</span><h1>بوابة الشيخ والمعلم</h1><p>تظل أدواتك الشخصية والتواصي متاحة؛ تُضاف إدارة الدورات والدروس بعد مراجعة الاعتماد.</p></div>
    <section className="panel teacher-overview"><h2>مسيرتك ومجموعاتك</h2><p className="muted">يمكنك إنشاء مجموعة تواصٍ وإدارتها بالقواعد نفسها المطبقة على جميع المستخدمين.</p><button className="soft-btn" onClick={()=>navigate('circles')}>الانتقال إلى التواصي</button></section>
    {!user||!authClient?<section className="panel"><h2>تسجيل الدخول مطلوب</h2><p>سجّل الدخول لتقديم طلب التدريس.</p></section>:loading?<p role="status">جارٍ تحميل طلب التدريس…</p>:<section className="panel teacher-application">
      <h2>طلب اعتماد التدريس</h2>
      {error&&<p className="teacher-notice error" role="alert">{error} <button className="soft-btn" onClick={()=>void load()}>إعادة المحاولة</button></p>}
      {notice&&<p className="teacher-notice" role="status">{notice}</p>}
      {application&&<div className="teacher-status"><strong>الحالة: {labels[application.status]??application.status}</strong><span>الهوية: {labels[application.identity_status]??application.identity_status}</span><span>المؤهلات: {labels[application.qualification_status]??application.qualification_status}</span><span>التزكية: {labels[application.endorsement_status]??application.endorsement_status}</span>{application.review_note&&<p>ملاحظة المراجعة: {application.review_note}</p>}</div>}
      {locked?<p className="muted">{application?.status==='approved'?'اعتمادك مسجل؛ يمكنك إدارة دروسك ودوراتك أدناه.':'الطلب معلّق؛ تواصل مع إدارة المنصة للاستفسار.'}</p>:<form onSubmit={event=>void submit(event)}>
        <label>الاسم الظاهر<input required minLength={2} maxLength={120} value={draft.display_name} onChange={event=>set('display_name',event.target.value)}/></label>
        <label>نبذة تعريفية<textarea maxLength={2000} rows={3} value={draft.biography} onChange={event=>set('biography',event.target.value)}/></label>
        <label>مجالات التدريس<input maxLength={1000} value={draft.specialties} onChange={event=>set('specialties',event.target.value)}/></label>
        <label>المؤهلات والخبرة<textarea required maxLength={3000} rows={3} value={draft.qualifications} onChange={event=>set('qualifications',event.target.value)}/></label>
        <label>بيانات التزكية<textarea required maxLength={3000} rows={3} value={draft.endorsement} onChange={event=>set('endorsement',event.target.value)}/></label>
        <p className="muted small">تُراجع الهوية والمؤهلات والتزكية كلٌ على حدة. لا تُمنح شارة أو صلاحية نشر تلقائيًا.</p>
        <button className="primary" type="submit" disabled={busy}>{busy?'جارٍ الإرسال…':application?'تحديث الطلب وإعادة إرساله':'إرسال طلب التدريس'}</button>
      </form>}
    </section>}
    {application?.status==='approved'&&user&&<CourseManager teacherId={user.id}/>}
    {application?.status==='approved'&&user&&<TeacherStudentsPanel teacherId={user.id}/>}
  </div>;
}
