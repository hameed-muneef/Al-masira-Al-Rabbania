import {useEffect,useState,type FormEvent} from 'react';
import {authClient} from '../auth';
import CourseLessons from './CourseLessons';
import CourseMaterials from './CourseMaterials';
import CourseAssignments from './CourseAssignments';
import '../teacher.css';

type Kind='lesson'|'series'|'course';
type Status='draft'|'published'|'closed'|'cancelled';
type Course={id:string;kind:Kind;title:string;summary:string;objectives:string;prerequisites:string;level:string;category:string;schedule_description:string;starts_at:string|null;time_zone:string;capacity:number;access:'public'|'private';registration:'open'|'approval'|'invite';youtube_url:string;status:Status};
type Session={id:string;title:string;starts_at:string;ends_at:string;meeting_url:string;status:string;notes:string};
type Draft={kind:Kind;title:string;summary:string;objectives:string;prerequisites:string;level:string;category:string;schedule_description:string;startsAt:string;capacity:string;access:'public'|'private';registration:'open'|'approval'|'invite';youtubeUrl:string};
const kindLabels:Record<Kind,string>={lesson:'درس منفرد',series:'سلسلة دروس',course:'دورة'};
const statusLabels:Record<Status,string>={draft:'مسودة',published:'منشور',closed:'مغلق',cancelled:'ملغى'};
const sessionStatusLabels:Record<string,string>={scheduled:'مجدولة',cancelled:'ملغاة',completed:'مكتملة'};
const zone=Intl.DateTimeFormat().resolvedOptions().timeZone||'Africa/Cairo';
const blank=():Draft=>({kind:'lesson',title:'',summary:'',objectives:'',prerequisites:'',level:'all',category:'',schedule_description:'',startsAt:'',capacity:'30',access:'public',registration:'open',youtubeUrl:''});
const fromCourse=(course:Course):Draft=>{const start=course.starts_at?new Date(course.starts_at):null;return {kind:course.kind,title:course.title,summary:course.summary,objectives:course.objectives,prerequisites:course.prerequisites,level:course.level,category:course.category,schedule_description:course.schedule_description,startsAt:start?new Date(start.getTime()-start.getTimezoneOffset()*60000).toISOString().slice(0,16):'',capacity:String(course.capacity),access:course.access,registration:course.registration,youtubeUrl:course.youtube_url}};
const errorText=(value:unknown)=>value instanceof Error?value.message:'تعذر تنفيذ العملية.';
const fmt=(v:string)=>new Intl.DateTimeFormat('ar-EG',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(v));

export default function CourseManager({teacherId}:{teacherId:string}){
  const [courses,setCourses]=useState<Course[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [open,setOpen]=useState(false);
  const [editingId,setEditingId]=useState<string|null>(null);
  const [lessonCourseId,setLessonCourseId]=useState<string|null>(null);
  const [sessionCourseId,setSessionCourseId]=useState<string|null>(null);
  const [materialCourseId,setMaterialCourseId]=useState<string|null>(null);
  const [sessions,setSessions]=useState<Session[]>([]);
  const [sessionsLoading,setSessionsLoading]=useState(false);
  const [sessionForm,setSessionForm]=useState({title:'',startsAt:'',endsAt:'',meetingUrl:'',notes:''});
  const [attendanceSessionId,setAttendanceSessionId]=useState<string|null>(null);
  const [registrants,setRegistrants]=useState<{registrant_id:string}[]>([]);
  const [attendance,setAttendance]=useState<Record<string,string>>({});
  const [attendanceLoading,setAttendanceLoading]=useState(false);
  const [draft,setDraft]=useState<Draft>(blank);
  const set=(patch:Partial<Draft>)=>setDraft(current=>({...current,...patch}));
  const load=async()=>{
    if(!authClient)return;setLoading(true);setError('');
    try{
      const {data,error:loadError}=await authClient.from('courses').select('id,kind,title,summary,objectives,prerequisites,level,category,schedule_description,starts_at,time_zone,capacity,access,registration,youtube_url,status').eq('teacher_id',teacherId).order('created_at',{ascending:false});
      if(loadError)throw loadError;setCourses((data??[]) as Course[]);
    }catch(caught){setError(errorText(caught))}finally{setLoading(false)}
  };
  useEffect(()=>{void load()},[teacherId]);
  const loadSessions=async(courseId:string)=>{
    if(!authClient)return;setSessionsLoading(true);
    try{
      const {data,error:loadError}=await authClient.rpc('list_course_sessions',{p_course_id:courseId});
      if(loadError)throw loadError;setSessions((data??[]) as Session[]);
    }catch(caught){setError(errorText(caught))}finally{setSessionsLoading(false)}
  };
  const toggleSessions=async(courseId:string)=>{
    if(sessionCourseId===courseId){setSessionCourseId(null);setSessions([]);return}
    setSessionCourseId(courseId);setSessionForm({title:'',startsAt:'',endsAt:'',meetingUrl:'',notes:''});await loadSessions(courseId);
  };
  const createSession=async(event:FormEvent)=>{
    event.preventDefault();if(!authClient||busy||!sessionCourseId)return;
    const s=sessionForm;if(!s.startsAt||!s.endsAt){setError('حدد موعد البداية والنهاية.');return}
    setBusy(true);setError('');setNotice('');
    try{
      const {error:rpcError}=await authClient.rpc('create_course_session',{p_course_id:sessionCourseId,p_title:s.title.trim()||'جلسة',p_starts_at:new Date(s.startsAt).toISOString(),p_ends_at:new Date(s.endsAt).toISOString(),p_meeting_url:s.meetingUrl.trim(),p_notes:s.notes.trim()});
      if(rpcError)throw rpcError;
      setNotice('أُنشئت الجلسة.');setSessionForm({title:'',startsAt:'',endsAt:'',meetingUrl:'',notes:''});await loadSessions(sessionCourseId);
    }catch(caught){setError(errorText(caught))}finally{setBusy(false)}
  };
  const cancelSession=async(id:string)=>{
    if(!authClient||busy)return;setBusy(true);setError('');setNotice('');
    try{
      const {error:rpcError}=await authClient.rpc('cancel_course_session',{p_session_id:id});
      if(rpcError)throw rpcError;
      setNotice('أُلغيت الجلسة.');if(sessionCourseId)await loadSessions(sessionCourseId);
    }catch(caught){setError(errorText(caught))}finally{setBusy(false)}
  };
  const toggleAttendance=async(sessionId:string)=>{
    if(attendanceSessionId===sessionId){setAttendanceSessionId(null);return}
    setAttendanceSessionId(sessionId);setAttendanceLoading(true);setRegistrants([]);setAttendance({});
    if(!authClient)return;
    try{
      const {data:regs}=await authClient.rpc('list_course_registrations',{p_course_id:sessionCourseId});
      const list=(regs??[]) as {registrant_id:string}[];
      setRegistrants(list);
      const {data:att}=await authClient.rpc('list_course_attendance',{p_session_id:sessionId});
      const map:Record<string,string>={};
      for(const row of (att??[]) as {attendee_id:string;attendance_status:string}[]) map[row.attendee_id]=row.attendance_status;
      setAttendance(map);
    }catch(caught){setError(errorText(caught))}
    finally{setAttendanceLoading(false)}
  };
  const markAttendance=async(sessionId:string,userId:string,status:string)=>{
    if(!authClient||busy)return;setBusy(true);
    try{
      const {error:rpcError}=await authClient.rpc('record_attendance',{p_session_id:sessionId,p_user_id:userId,p_status:status,p_note:''});
      if(rpcError)throw rpcError;
      setAttendance(current=>({...current,[userId]:status}));
    }catch(caught){setError(errorText(caught))}
    finally{setBusy(false)}
  };
  const payload=()=>({p_kind:draft.kind,p_title:draft.title.trim(),p_summary:draft.summary.trim(),p_objectives:draft.objectives.trim(),p_prerequisites:draft.prerequisites.trim(),p_level:draft.level,p_category:draft.category.trim(),p_schedule_description:draft.schedule_description.trim(),p_starts_at:draft.startsAt?new Date(draft.startsAt).toISOString():null,p_time_zone:zone,p_capacity:Number(draft.capacity),p_access:draft.access,p_registration:draft.registration,p_youtube_url:draft.youtubeUrl.trim()});
  const save=async(event:FormEvent)=>{
    event.preventDefault();if(!authClient||busy)return;
    if(!draft.title.trim()||!Number.isInteger(Number(draft.capacity))||Number(draft.capacity)<1||Number(draft.capacity)>100||(draft.access==='private'&&draft.registration==='open')){
      setError('تحقق من العنوان والسعة وطريقة التسجيل الخاصة.');return;
    }
    setBusy(true);setError('');setNotice('');
    try{
      const result=editingId?await authClient.rpc('update_course',{p_course_id:editingId,...payload()}):await authClient.rpc('create_course',payload());
      if(result.error)throw result.error;
      setOpen(false);setEditingId(null);setDraft(blank());setNotice(editingId?'حُفظت المسودة.':'أُنشئت المسودة. أكمل بياناتها ثم انشرها.');await load();
    }catch(caught){setError(errorText(caught))}finally{setBusy(false)}
  };
  const changeStatus=async(id:string,status:'published'|'closed'|'cancelled')=>{
    if(!authClient||busy)return;setBusy(true);setError('');setNotice('');
    try{
      const {error:statusError}=await authClient.rpc('set_course_status',{p_course_id:id,p_status:status});
      if(statusError)throw statusError;
      setNotice(status==='published'?'نُشر المجلس.':'حُدثت حالة المجلس.');await load();
    }catch(caught){setError(errorText(caught))}finally{setBusy(false)}
  };
  return <section className="panel course-manager" aria-labelledby="course-manager-title">
    <h2 id="course-manager-title">دوراتي ودروسي</h2><p className="muted">أنشئ درسًا منفردًا أو سلسلة أو دورة مجانية. تُحفظ كمسودة حتى تختار النشر.</p>
    {error&&<p className="teacher-notice error" role="alert">{error} <button className="soft-btn" onClick={()=>void load()}>إعادة المحاولة</button></p>}
    {notice&&<p className="teacher-notice" role="status">{notice}</p>}
    <button className="primary" aria-expanded={open} aria-controls="course-form" onClick={()=>{setOpen(!open);setEditingId(null);setDraft(blank())}}>{open?'إغلاق النموذج':'إنشاء مجلس جديد'}</button>
    {open&&<form id="course-form" onSubmit={event=>void save(event)}>
      <h3>{editingId?'تعديل المسودة':'مجلس جديد'}</h3>
      <label>النوع<select value={draft.kind} onChange={event=>set({kind:event.target.value as Kind})}>{Object.entries(kindLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label>العنوان<input required minLength={3} maxLength={160} value={draft.title} onChange={event=>set({title:event.target.value})}/></label>
      <label>الوصف<textarea required rows={3} maxLength={3000} value={draft.summary} onChange={event=>set({summary:event.target.value})}/></label>
      <label>الأهداف<textarea required rows={2} maxLength={3000} value={draft.objectives} onChange={event=>set({objectives:event.target.value})}/></label>
      <label>المتطلبات<textarea rows={2} maxLength={2000} value={draft.prerequisites} onChange={event=>set({prerequisites:event.target.value})}/></label>
      <label>المستوى<select value={draft.level} onChange={event=>set({level:event.target.value})}><option value="all">الجميع</option><option value="beginner">مبتدئ</option><option value="intermediate">متوسط</option><option value="advanced">متقدم</option></select></label>
      <label>التصنيف<input maxLength={120} value={draft.category} onChange={event=>set({category:event.target.value})}/></label>
      <label>وصف الجدول<input required maxLength={1000} value={draft.schedule_description} onChange={event=>set({schedule_description:event.target.value})}/></label>
      <label>موعد البداية بتوقيت جهازك<input required type="datetime-local" value={draft.startsAt} onChange={event=>set({startsAt:event.target.value})}/></label>
      <p className="muted small">المنطقة الزمنية المستخدمة: {zone}. ستُضاف إدارة المواعيد المتكررة لاحقًا.</p>
      <label>السعة<input type="number" min={1} max={100} required value={draft.capacity} onChange={event=>set({capacity:event.target.value})}/></label>
      <label>الوصول<select value={draft.access} onChange={event=>set({access:event.target.value as Draft['access'],registration:event.target.value==='private'?'approval':draft.registration})}><option value="public">عام للدورات</option><option value="private">خاص</option></select></label>
      <label>التسجيل<select value={draft.registration} onChange={event=>set({registration:event.target.value as Draft['registration']})}>{draft.access==='public'&&<option value="open">مفتوح</option>}<option value="approval">بموافقة</option><option value="invite">بدعوة</option></select></label>
      <label>رابط YouTube خارجي اختياري<input type="url" maxLength={500} value={draft.youtubeUrl} onChange={event=>set({youtubeUrl:event.target.value})} placeholder="https://www.youtube.com/…"/></label>
      <p className="muted small">اللقاءات المباشرة ستستخدم Google Meet لاحقًا، بلا تسجيل أو تخزين من المنصة. لا مدفوعات في هذه المرحلة.</p>
      <button className="primary" type="submit" disabled={busy}>{busy?'جارٍ الحفظ…':'حفظ المسودة'}</button>
    </form>}
    {loading?<p role="status">جارٍ تحميل الدورات والدروس…</p>:courses.length===0?<p className="muted">لا دروس أو دورات بعد.</p>:<ul className="course-list">{courses.map(course=><li key={course.id}>
      <div><strong>{course.title}</strong><p>{kindLabels[course.kind]} · {statusLabels[course.status]} · {course.access==='private'?'خاص':'عام'} · مجاني · السعة {course.capacity}</p><p>{course.summary}</p></div>
      <div className="course-actions">{course.kind!=='lesson'&&<button className="soft-btn" aria-expanded={lessonCourseId===course.id} onClick={()=>setLessonCourseId(current=>current===course.id?null:course.id)}>دروس المجلس</button>}{course.status==='draft'&&<><button className="soft-btn" onClick={()=>{setEditingId(course.id);setDraft(fromCourse(course));setOpen(true)}}>تعديل</button><button className="soft-btn" disabled={busy} onClick={()=>void changeStatus(course.id,'published')}>نشر</button></>}{(course.status==='draft'||course.status==='published')&&<><button className="soft-btn" disabled={busy} onClick={()=>void changeStatus(course.id,'closed')}>إغلاق</button><button className="soft-btn" disabled={busy} onClick={()=>void changeStatus(course.id,'cancelled')}>إلغاء المجلس</button></>}{course.status==='published'&&<button className="soft-btn" aria-expanded={sessionCourseId===course.id} onClick={()=>void toggleSessions(course.id)}>جلسات المجلس</button>}{course.status==='published'&&<button className="soft-btn" aria-expanded={materialCourseId===course.id} onClick={()=>setMaterialCourseId(current=>current===course.id?null:course.id)}>مواد وواجبات</button>}</div>
      {lessonCourseId===course.id&&<CourseLessons courseId={course.id} editable={course.status==='draft'}/>}
      {sessionCourseId===course.id&&<div className="session-panel">
        <h3>جلسات المجلس</h3>
        {sessionsLoading?<p role="status">جارٍ تحميل الجلسات…</p>:sessions.length===0?<p className="muted">لا جلسات بعد.</p>:<ul className="course-list">{sessions.map(s=><li key={s.id}><div><strong>{s.title||'جلسة'}</strong><p>{fmt(s.starts_at)} — {fmt(s.ends_at)}{s.meeting_url&&<> · <a href={s.meeting_url} target="_blank" rel="noreferrer">رابط Meet</a></>}</p>{s.notes&&<p className="muted small">{s.notes}</p>}<p className="muted small">الحالة: {sessionStatusLabels[s.status]??s.status}</p></div><div className="course-actions">{s.status==='scheduled'&&<button className="soft-btn" disabled={busy} onClick={()=>void cancelSession(s.id)}>إلغاء الجلسة</button>}<button className="soft-btn" aria-expanded={attendanceSessionId===s.id} onClick={()=>void toggleAttendance(s.id)}>حضور</button></div>{attendanceSessionId===s.id&&<div className="attendance-panel">{attendanceLoading?<p role="status">جارٍ التحميل…</p>:registrants.length===0?<p className="muted small">لا مسجلين.</p>:<ul className="course-list">{registrants.map(r=><li key={r.registrant_id}><span>طالب {r.registrant_id.slice(0,8)}</span><div className="course-actions">{['present','absent','excused','late'].map(st=><button key={st} className={attendance[r.registrant_id]===st?'primary':'soft-btn'} disabled={busy} onClick={()=>void markAttendance(s.id,r.registrant_id,st)}>{st==='present'?'حاضر':st==='absent'?'غائب':st==='excused'?'معذور':'متأخر'}</button>)}</div></li>)}</ul>}</div>}</li>)}</ul>}
        <form onSubmit={event=>void createSession(event)}>
          <h4>جلسة جديدة</h4>
          <label>العنوان<input maxLength={200} value={sessionForm.title} onChange={event=>setSessionForm(current=>({...current,title:event.target.value}))}/></label>
          <label>البداية<input required type="datetime-local" value={sessionForm.startsAt} onChange={event=>setSessionForm(current=>({...current,startsAt:event.target.value}))}/></label>
          <label>النهاية<input required type="datetime-local" value={sessionForm.endsAt} onChange={event=>setSessionForm(current=>({...current,endsAt:event.target.value}))}/></label>
          <label>رابط Meet<input type="url" maxLength={500} value={sessionForm.meetingUrl} onChange={event=>setSessionForm(current=>({...current,meetingUrl:event.target.value}))} placeholder="https://meet.google.com/…"/></label>
          <label>ملاحظات<textarea rows={2} maxLength={1000} value={sessionForm.notes} onChange={event=>setSessionForm(current=>({...current,notes:event.target.value}))}/></label>
          <button className="primary" type="submit" disabled={busy}>{busy?'جارٍ…':'إنشاء جلسة'}</button>
        </form>
      </div>}
      {materialCourseId===course.id&&<div className="material-panel"><CourseMaterials courseId={course.id} editable={course.status==='draft'}/><CourseAssignments courseId={course.id} editable={course.status==='draft'} isTeacher={true}/></div>}
    </li>)}</ul>}
  </section>;
}
