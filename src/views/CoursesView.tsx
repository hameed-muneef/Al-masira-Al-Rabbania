import {useCallback,useEffect,useState} from 'react';
import {BookOpen,RefreshCw} from 'lucide-react';
import {authClient} from '../auth';
import CourseMaterials from './CourseMaterials';
import CourseAssignments from './CourseAssignments';
import CirclesView from './CirclesView';
import CourseInviteManager from './CourseInviteManager';
import {ReceivedInvitations} from './ActivityInvitations';
import '../teacher.css';

type Course={id:string;teacher_id:string;kind:string;title:string;summary:string;objectives:string;prerequisites:string;level:string;category:string;schedule_description:string;starts_at:string|null;time_zone:string;capacity:number;access:string;registration:string;youtube_url:string;status:string};
type Registration={course_id:string;status:string};
type TeacherIntro={course_id:string;display_name:string;biography:string;specialties:string};
type SeatAvailability={course_id:string;capacity:number;registered_count:number;remaining_count:number};
const kindLabel=(k:string)=>({lesson:'درس منفرد',series:'سلسلة دروس',course:'دورة'}[k]??k);
const levelLabel=(l:string)=>({all:'للجميع',beginner:'مبتدئ',intermediate:'متوسط',advanced:'متقدم'}[l]??l);
const fmtDate=(v:string|null)=>v?new Intl.DateTimeFormat('ar-EG',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(v)):null;

export default function CoursesView({user,navigate,admin=false}:{user:{id:string}|null;navigate?:(view:any)=>void;admin?:boolean}){
  const [courses,setCourses]=useState<Course[]>([]);
  const [regs,setRegs]=useState<Registration[]>([]);
  const [teachers,setTeachers]=useState<Record<string,TeacherIntro>>({});
  const [seats,setSeats]=useState<Record<string,SeatAvailability>>({});
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busyId,setBusyId]=useState<string|null>(null);
  const [creatingCircle,setCreatingCircle]=useState<string|null>(null);
  const [reportingId,setReportingId]=useState<string|null>(null);
  const [reportReason,setReportReason]=useState('other');
  const [reportDetails,setReportDetails]=useState('');
  const [tab,setTab]=useState<'discover'|'mine'|'groups'>('discover');
  const [filter,setFilter]=useState('');
  const [page,setPage]=useState(1);

  const load=useCallback(async()=>{
    if(!authClient){setLoading(false);return}
    setLoading(true);setError('');
    try{
      const {data:courseData,error:courseError}=await authClient.from('courses').select('*').eq('status','published').eq('access','public').order('starts_at');
      if(courseError)throw courseError;
      const list=(courseData??[]) as Course[];
      setCourses(list);
      const introductions:Record<string,TeacherIntro>={};
      const availability:Record<string,SeatAvailability>={};
      for(let offset=0;offset<list.length;offset+=100){
        const ids=list.slice(offset,offset+100).map(course=>course.id);
        const [teacherResult,seatResult]=await Promise.all([
          authClient.rpc('list_public_course_teachers' as any,{p_course_ids:ids}),
          authClient.rpc('list_public_course_seats' as any,{p_course_ids:ids}),
        ]);
        for(const row of (teacherResult.data??[]) as TeacherIntro[])introductions[row.course_id]=row;
        for(const row of (seatResult.data??[]) as SeatAvailability[])availability[row.course_id]=row;
      }
      setTeachers(introductions);
      setSeats(availability);
      if(user){
        const {data:mine}=await authClient.from('course_registrations').select('course_id,status').eq('user_id',user.id);
        setRegs((mine??[]) as Registration[]);
      } else setRegs([]);
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر تحميل مجالس العلم.')}
    finally{setLoading(false)}
  },[user?.id]);
  useEffect(()=>{void load()},[load]);

  const registered=(courseId:string)=>regs.find(r=>r.course_id===courseId&&r.status==='registered');
  const register=async(courseId:string)=>{
    if(!authClient||!user||busyId)return;setBusyId(courseId);setError('');setNotice('');
    try{
      const {data,error:rpcError}=await authClient.rpc('register_for_course',{p_course_id:courseId});
      if(rpcError)throw rpcError;
      setNotice(data==='already_registered'?'أنت مسجل بالفعل في هذا المجلس.':'تم تسجيلك في المجلس.');
      await load();
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر التسجيل.')}
    finally{setBusyId(null)}
  };
  const cancel=async(courseId:string)=>{
    if(!authClient||busyId)return;setBusyId(courseId);setError('');setNotice('');
    try{
      const {error:rpcError}=await authClient.rpc('cancel_course_registration',{p_course_id:courseId});
      if(rpcError)throw rpcError;
      setNotice('أُلغي تسجيلك.');
      await load();
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر إلغاء التسجيل.')}
    finally{setBusyId(null)}
  };

  const submitReport=async(courseId:string)=>{
    if(!authClient||!user||busyId)return;setBusyId(courseId);setError('');setNotice('');
    try{
      const {error:rpcError}=await authClient.rpc('submit_report',{p_target_type:'course',p_target_id:courseId,p_reason:reportReason,p_details:reportDetails.trim()});
      if(rpcError)throw rpcError;
      setNotice('تم إرسال الإبلاغ. سنراجعه وفق السياسة.');
      setReportingId(null);setReportDetails('');
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر إرسال الإبلاغ.')}
    finally{setBusyId(null)}
  };

  const createCircleFromCourse=async(course:Course)=>{
    if(!authClient||!user||creatingCircle)return;setCreatingCircle(course.id);setError('');setNotice('');
    try{
      const groupId=(await authClient.rpc('create_group',{p_name:`${course.title} — تواصٍ`,p_kind:course.kind==='lesson'?'course':'book',p_description:course.summary,p_goal:course.objectives,p_participation_rules:course.prerequisites,p_member_limit:Math.min(course.capacity,100),p_starts_on:course.starts_at?course.starts_at.slice(0,10):null,p_ends_on:null})).data;
      if(!groupId)throw new Error('تعذر إنشاء الحلقة.');
      setNotice('أُنشئت حلقة تواصٍ لهذا المجلس. يمكنك دعوة المشاركين من صفحة التواصي.');
      if(navigate)navigate('circles');
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر إنشاء الحلقة.')}
    finally{setCreatingCircle(null)}
  };
  const visible=courses.filter(c=>!filter||c.title.includes(filter)||c.category.includes(filter)||c.level.includes(filter));
  const pageSize=9;
  const pageCount=Math.max(1,Math.ceil(visible.length/pageSize));
  const currentPage=Math.min(page,pageCount);
  const pageCourses=visible.slice((currentPage-1)*pageSize,currentPage*pageSize);
  const myCourses=courses.filter(c=>registered(c.id));

  return <div className="teacher-view courses-view">
    <div className="page-intro"><span className="eyebrow">مجالس العلم</span><h1>دورات ودروس مفتوحة</h1><p>مجالس علم مجانية يقدّمها معلمون معتمدون. التسجيل يحفظ مقعدك؛ اللقاءات مباشرة ولا تُسجَّل.</p></div>
    {tab!=='groups'&&error&&<p className="teacher-notice error" role="alert">{error}</p>}
    {notice&&<p className="teacher-notice" role="status">{notice}</p>}
    {user&&tab!=='groups'&&<ReceivedInvitations activityType="course" title="دعوات مجالس العلم"
      intro="دعوات وصلتك من معلمي المجالس. قبولها يسجّلك في المجلس وفق قواعد السعة والتسجيل."
      emptyText="لا دعوات مجالس واردة الآن." onChanged={()=>void load()}/>}
    <div className="circles-toolbar">
      <div role="tablist" aria-label="عرض المجالس">
        <button role="tab" aria-selected={tab==='discover'} className={tab==='discover'?'primary':'soft-btn'} onClick={()=>setTab('discover')}>استكشاف</button>
        <button role="tab" aria-selected={tab==='mine'} className={tab==='mine'?'primary':'soft-btn'} onClick={()=>setTab('mine')}>دوراتي المسجلة</button>
        {user&&<button role="tab" aria-selected={tab==='groups'} className={tab==='groups'?'primary':'soft-btn'} onClick={()=>setTab('groups')}>مجالسي العلمية الخاصة</button>}
      </div>
      {tab!=='groups'&&<><input className="soft-btn" placeholder="بحث بالعنوان أو التصنيف" value={filter} onChange={e=>{setFilter(e.target.value);setPage(1)}} aria-label="بحث" style={{minWidth:220}}/>
      <button className="soft-btn" onClick={()=>void load()}><RefreshCw size={15}/> تحديث</button></>}
    </div>
    {tab==='groups'?<CirclesView user={user} mode="science" admin={admin} embedded/>:loading?<p role="status">جارٍ تحميل مجالس العلم…</p>:tab==='discover'?(
      visible.length===0?<section className="panel"><h2>{filter?'لا نتائج للبحث':'لا توجد مجالس منشورة'}</h2><p className="muted">{filter?'جرّب عنوانًا أو تصنيفًا آخر.':'لم يُنشر أي مجلس علم بعد.'}</p></section>:
      <div><div className="feature-grid">{pageCourses.map(course=>{
        const reg=registered(course.id);
        const remaining=seats[course.id]?.remaining_count;
        return <section className="panel" key={course.id} aria-label={course.title}>
          <div className="panel-head"><BookOpen size={20}/><h2>{course.title}</h2><span className="circles-role">{kindLabel(course.kind)}</span></div>
          <p className="muted small">المعلم: {teachers[course.id]?.display_name??'معلم معتمد'}</p>
          {course.summary&&<p className="muted small">{course.summary}</p>}
          <ul className="circle-meta"><li>المستوى: {levelLabel(course.level)}</li><li>التصنيف: {course.category||'عام'}</li><li>{remaining===undefined?`السعة: ${course.capacity} مقعدًا`:`المقاعد المتبقية: ${remaining} من ${course.capacity}`}</li>{course.starts_at&&<li>البداية: {fmtDate(course.starts_at)}</li>}{course.time_zone&&<li>المنطقة: {course.time_zone}</li>}</ul>
          {course.objectives&&<p className="circle-text"><strong>الأهداف:</strong> {course.objectives}</p>}
          {course.schedule_description&&<p className="circle-text"><strong>الجدول:</strong> {course.schedule_description}</p>}
          {course.prerequisites&&<p className="circle-text"><strong>المتطلبات:</strong> {course.prerequisites}</p>}
          {teachers[course.id]&&(teachers[course.id].biography||teachers[course.id].specialties)&&<details><summary>عن المعلم</summary>{teachers[course.id].biography&&<p className="circle-text">{teachers[course.id].biography}</p>}{teachers[course.id].specialties&&<p className="circle-text"><strong>التخصصات:</strong> {teachers[course.id].specialties}</p>}</details>}
          {course.youtube_url&&<p className="circle-text"><strong>رابط YouTube:</strong> <a href={course.youtube_url} target="_blank" rel="noreferrer">{course.youtube_url}</a></p>}
          <div className="circle-actions">
            {!user? <p className="muted small">سجّل الدخول للتسجيل.</p>:
              reg? <button className="soft-btn" disabled={busyId===course.id} onClick={()=>void cancel(course.id)}>{busyId===course.id?'جارٍ…':'إلغاء التسجيل'}</button>:
              remaining===0? <p className="muted small">اكتملت المقاعد. حدّث القائمة للتحقق مجددًا.</p>:
              course.registration!=='open'? <p className="muted small">التسجيل {course.registration==='approval'?'بموافقة المعلم':'بدعوة'}.</p>:
              <button className="primary" disabled={busyId===course.id} onClick={()=>void register(course.id)}>{busyId===course.id?'جارٍ…':'تسجيل'}</button>}
            {user&&<button className="soft-btn" onClick={()=>setReportingId(current=>current===course.id?null:course.id)}>إبلاغ</button>}
            {user&&<button className="soft-btn" disabled={creatingCircle===course.id} onClick={()=>void createCircleFromCourse(course)}>{creatingCircle===course.id?'جارٍ…':'إنشاء حلقة تواصٍ'}</button>}
            {reportingId===course.id&&<form className="circle-actions" onSubmit={e=>{e.preventDefault();void submitReport(course.id)}} style={{flex:'1 1 100%'}}>
              <select value={reportReason} onChange={e=>setReportReason(e.target.value)} aria-label="سبب الإبلاغ"><option value="spam">رسائل مزعجة</option><option value="harassment">مضايقة</option><option value="inappropriate">محتوى غير لائق</option><option value="misinformation">معلومات مضللة</option><option value="privacy">خصوصية</option><option value="other">أخرى</option></select>
              <textarea rows={2} placeholder="تفاصيل (اختياري)" value={reportDetails} onChange={e=>setReportDetails(e.target.value)} maxLength={2000}/>
              <button className="primary" type="submit" disabled={busyId===course.id}>{busyId===course.id?'جارٍ…':'إرسال الإبلاغ'}</button>
              <button className="soft-btn" type="button" onClick={()=>setReportingId(null)}>إلغاء</button>
            </form>}
          </div>
          {user&&(course.teacher_id===user.id||admin)&&course.registration==='open'&&<CourseInviteManager courseId={course.id} onChanged={()=>void load()}/>}
          {reg&&<div className="course-materials-panel"><CourseMaterials courseId={course.id} editable={false}/><CourseAssignments courseId={course.id} editable={false} isTeacher={false}/></div>}
        </section>;
      })}</div>{pageCount>1&&<nav className="circle-actions" aria-label="صفحات المجالس"><button className="soft-btn" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>السابق</button><span aria-live="polite">صفحة {currentPage} من {pageCount}</span><button className="soft-btn" disabled={currentPage===pageCount} onClick={()=>setPage(currentPage+1)}>التالي</button></nav>}</div>):
      (myCourses.length===0?<section className="panel"><h2>لا توجد تسجيلات</h2><p className="muted">لم تسجّل في أي مجلس بعد.</p></section>:
        <div className="feature-grid">{myCourses.map(course=>(
          <section className="panel" key={course.id}><div className="panel-head"><BookOpen size={20}/><h2>{course.title}</h2><span className="circles-flag">{registered(course.id)?.status}</span></div><p className="muted small">{fmtDate(course.starts_at)}</p><button className="soft-btn" disabled={busyId===course.id} onClick={()=>void cancel(course.id)}>إلغاء التسجيل</button></section>
        ))}</div>)
    }
  </div>;
}
