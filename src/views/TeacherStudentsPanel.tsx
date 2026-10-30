import {useEffect,useState,type FormEvent} from 'react';
import {authClient} from '../auth';

type Course={id:string;title:string;status:string};
type Reg={registration_id:string;registrant_id:string;registration_status:string};

export default function TeacherStudentsPanel({teacherId}:{teacherId:string}){
  const [courses,setCourses]=useState<Course[]>([]);
  const [selectedCourse,setSelectedCourse]=useState<string>('');
  const [regs,setRegs]=useState<Reg[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [announcement,setAnnouncement]=useState({title:'',body:''});
  const loadCourses=async()=>{
    if(!authClient)return;setLoading(true);setError('');
    try{
      const {data,error:loadError}=await authClient.from('courses').select('id,title,status').eq('teacher_id',teacherId).order('created_at',{ascending:false});
      if(loadError)throw loadError;setCourses((data??[]) as Course[]);
      if(data&&data.length&&!selectedCourse)setSelectedCourse((data as Course[])[0].id);
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر تحميل الدورات.')}
    finally{setLoading(false)}
  };
  const loadRegs=async(courseId:string)=>{
    if(!authClient)return;
    try{
      const {data,error:loadError}=await authClient.rpc('list_course_registrations',{p_course_id:courseId});
      if(loadError)throw loadError;setRegs((data??[]) as Reg[]);
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر تحميل الطلاب.')}
  };
  useEffect(()=>{void loadCourses()},[teacherId]);
  useEffect(()=>{if(selectedCourse)void loadRegs(selectedCourse)},[selectedCourse]);
  const sendAnnouncement=async(event:FormEvent)=>{
    event.preventDefault();if(!authClient||busy||!selectedCourse)return;
    if(!announcement.title.trim()){setError('عنوان الإعلان مطلوب.');return}
    setBusy(true);setError('');setNotice('');
    try{
      const registered=regs.filter(r=>r.registration_status==='registered');
      for(const r of registered){
        await authClient.rpc('send_notification',{p_recipient_id:r.registrant_id,p_kind:'announcement',p_title:announcement.title.trim(),p_body:announcement.body.trim(),p_link:`/courses`});
      }
      setNotice(`أُرسل الإعلان إلى ${registered.length} طالب.`);
      setAnnouncement({title:'',body:''});
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر إرسال الإعلان.')}
    finally{setBusy(false)}
  };
  if(loading)return <p role="status">جارٍ تحميل طلابك…</p>;
  return <section className="panel teacher-students" aria-labelledby="students-title">
    <h2 id="students-title">طلابي وإعلاناتي</h2>
    {error&&<p className="teacher-notice error" role="alert">{error}</p>}
    {notice&&<p className="teacher-notice" role="status">{notice}</p>}
    {courses.length===0?<p className="muted">لا توجد دورات بعد.</p>:<>
      <label>الدورة<select value={selectedCourse} onChange={e=>setSelectedCourse(e.target.value)}>{courses.map(c=><option key={c.id} value={c.id}>{c.title} ({c.status})</option>)}</select></label>
      <p className="muted small">المسجلون: {regs.filter(r=>r.registration_status==='registered').length}</p>
      <ul className="course-list">{regs.filter(r=>r.registration_status==='registered').map(r=><li key={r.registration_id}><span>طالب {r.registrant_id.slice(0,8)}</span></li>)}</ul>
      <form onSubmit={event=>void sendAnnouncement(event)}>
        <h3>إرسال إعلان للمسجلين</h3>
        <label>العنوان<input required maxLength={200} value={announcement.title} onChange={e=>setAnnouncement(current=>({...current,title:e.target.value}))}/></label>
        <label>النص<textarea rows={3} maxLength={2000} value={announcement.body} onChange={e=>setAnnouncement(current=>({...current,body:e.target.value}))}/></label>
        <button className="primary" type="submit" disabled={busy||regs.filter(r=>r.registration_status==='registered').length===0}>{busy?'جارٍ…':'إرسال الإعلان'}</button>
      </form>
    </>}
  </section>;
}
