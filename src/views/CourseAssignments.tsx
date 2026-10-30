import {useEffect,useState,type FormEvent} from 'react';
import {authClient} from '../auth';

type Assignment={assignment_id:string;assignment_title:string;assignment_description:string;assignment_due_at:string|null;assignment_max_score:number};
type Submission={submission_id:string;submitter_id:string;submission_content:string;submission_link:string;submission_score:number|null;submission_feedback:string;submission_status:string;submitted_at:string};
export default function CourseAssignments({courseId,editable,isTeacher}:{courseId:string;editable:boolean;isTeacher:boolean}){
  const [assignments,setAssignments]=useState<Assignment[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [form,setForm]=useState({title:'',description:'',dueAt:'',maxScore:'100'});
  const [submitting,setSubmitting]=useState<string|null>(null);
  const [submitContent,setSubmitContent]=useState('');
  const [submitLink,setSubmitLink]=useState('');
  const [grading,setGrading]=useState<string|null>(null);
  const [gradeScore,setGradeScore]=useState('');
  const [gradeFeedback,setGradeFeedback]=useState('');
  const [subsByAssignment,setSubsByAssignment]=useState<Record<string,Submission[]>>({});
  const load=async()=>{
    if(!authClient)return;setLoading(true);setError('');
    try{
      const {data,error:loadError}=await authClient.rpc('list_course_assignments',{p_course_id:courseId});
      if(loadError)throw loadError;setAssignments((data??[]) as Assignment[]);
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر تحميل الواجبات.')}
    finally{setLoading(false)}
  };
  const loadSubs=async(assignmentId:string)=>{
    if(!authClient)return;
    try{
      const {data,error:loadError}=await authClient.rpc('list_course_submissions',{p_assignment_id:assignmentId});
      if(loadError)throw loadError;
      setSubsByAssignment(current=>({...current,[assignmentId]:(data??[]) as Submission[]}));
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر تحميل التسليمات.')}
  };
  useEffect(()=>{void load()},[courseId]);
  const save=async(event:FormEvent)=>{
    event.preventDefault();if(!authClient||busy)return;
    if(!form.title.trim()){setError('عنوان الواجب مطلوب.');return}
    setBusy(true);setError('');
    try{
      const {error:rpcError}=await authClient.rpc('save_course_assignment',{p_course_id:courseId,p_assignment_id:null,p_title:form.title.trim(),p_description:form.description.trim(),p_due_at:form.dueAt?new Date(form.dueAt).toISOString():null,p_max_score:Number(form.maxScore)});
      if(rpcError)throw rpcError;
      setForm({title:'',description:'',dueAt:'',maxScore:'100'});await load();
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر حفظ الواجب.')}
    finally{setBusy(false)}
  };
  const remove=async(id:string)=>{
    if(!authClient||busy)return;setBusy(true);setError('');
    try{
      const {error:rpcError}=await authClient.rpc('remove_course_assignment',{p_course_id:courseId,p_assignment_id:id});
      if(rpcError)throw rpcError;await load();
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر حذف الواجب.')}
    finally{setBusy(false)}
  };
  const submit=async(assignmentId:string)=>{
    if(!authClient||busy)return;setBusy(true);setError('');
    try{
      const {error:rpcError}=await authClient.rpc('submit_course_assignment',{p_assignment_id:assignmentId,p_content:submitContent.trim(),p_link:submitLink.trim()});
      if(rpcError)throw rpcError;
      setSubmitting(null);setSubmitContent('');setSubmitLink('');await loadSubs(assignmentId);
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر تسليم الواجب.')}
    finally{setBusy(false)}
  };
  const grade=async(submissionId:string,assignmentId:string)=>{
    if(!authClient||busy)return;setBusy(true);setError('');
    try{
      const {error:rpcError}=await authClient.rpc('grade_course_submission',{p_submission_id:submissionId,p_score:Number(gradeScore),p_feedback:gradeFeedback.trim()});
      if(rpcError)throw rpcError;
      setGrading(null);setGradeScore('');setGradeFeedback('');await loadSubs(assignmentId);
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر تقييم التسليم.')}
    finally{setBusy(false)}
  };
  return <div className="course-assignments">
    <h3>الواجبات</h3>
    {error&&<p className="teacher-notice error" role="alert">{error}</p>}
    {loading?<p role="status">جارٍ تحميل الواجبات…</p>:assignments.length===0?<p className="muted">لا واجبات بعد.</p>:<ul className="course-list">{assignments.map(a=><li key={a.assignment_id}>
      <div><strong>{a.assignment_title}</strong><p className="muted small">{a.assignment_description}</p>{a.assignment_due_at&&<p className="muted small">الموعد: {new Date(a.assignment_due_at).toLocaleString('ar-EG')}</p>}<p className="muted small">الدرجة القصوى: {a.assignment_max_score}</p></div>
      <div className="course-actions">
        {!isTeacher&&<button className="soft-btn" onClick={()=>setSubmitting(current=>current===a.assignment_id?null:a.assignment_id)}>تسليم</button>}
        {isTeacher&&<button className="soft-btn" onClick={()=>{setGrading(null);void loadSubs(a.assignment_id)}}>عرض التسليمات</button>}
        {editable&&<button className="soft-btn" disabled={busy} onClick={()=>void remove(a.assignment_id)}>حذف</button>}
      </div>
      {submitting===a.assignment_id&&<form onSubmit={event=>{event.preventDefault();void submit(a.assignment_id)}} className="circle-form">
        <label>المحتوى<textarea rows={3} value={submitContent} onChange={e=>setSubmitContent(e.target.value)}/></label>
        <label>رابط (اختياري)<input type="url" value={submitLink} onChange={e=>setSubmitLink(e.target.value)}/></label>
        <button className="primary" type="submit" disabled={busy}>{busy?'جارٍ…':'إرسال'}</button>
        <button className="soft-btn" type="button" onClick={()=>setSubmitting(null)}>إلغاء</button>
      </form>}
      {isTeacher&&subsByAssignment[a.assignment_id]&&<ul className="course-list">{subsByAssignment[a.assignment_id].map(s=><li key={s.submission_id}><div><strong>طالب {s.submitter_id.slice(0,8)}</strong><p>{s.submission_content}</p>{s.submission_link&&<p><a href={s.submission_link} target="_blank" rel="noreferrer">{s.submission_link}</a></p>}<p className="muted small">الدرجة: {s.submission_score??'—'} · {s.submission_status}</p>{s.submission_feedback&&<p className="muted small">{s.submission_feedback}</p>}</div>{grading===s.submission_id?<form onSubmit={event=>{event.preventDefault();void grade(s.submission_id,a.assignment_id)}}><label>الدرجة<input type="number" min={0} max={a.assignment_max_score} value={gradeScore} onChange={e=>setGradeScore(e.target.value)} required/></label><label>ملاحظات<textarea rows={2} value={gradeFeedback} onChange={e=>setGradeFeedback(e.target.value)}/></label><button className="primary" type="submit" disabled={busy}>{busy?'جارٍ…':'حفظ'}</button><button className="soft-btn" type="button" onClick={()=>setGrading(null)}>إلغاء</button></form>:<button className="soft-btn" onClick={()=>{setGrading(s.submission_id);setGradeScore(s.submission_score!=null?String(s.submission_score):'');setGradeFeedback(s.submission_feedback)}}>تقييم</button>}</li>)}</ul>}
    </li>)}</ul>}
    {editable&&<form onSubmit={event=>void save(event)}>
      <h4>واجب جديد</h4>
      <label>العنوان<input required maxLength={200} value={form.title} onChange={e=>setForm(c=>({...c,title:e.target.value}))}/></label>
      <label>الوصف<textarea rows={2} maxLength={5000} value={form.description} onChange={e=>setForm(c=>({...c,description:e.target.value}))}/></label>
      <label>الموعد (اختياري)<input type="datetime-local" value={form.dueAt} onChange={e=>setForm(c=>({...c,dueAt:e.target.value}))}/></label>
      <label>الدرجة القصوى<input type="number" min={1} max={1000} value={form.maxScore} onChange={e=>setForm(c=>({...c,maxScore:e.target.value}))}/></label>
      <button className="primary" type="submit" disabled={busy}>{busy?'جارٍ…':'إضافة واجب'}</button>
    </form>}
  </div>;
}
