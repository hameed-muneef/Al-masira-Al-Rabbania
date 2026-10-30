import {useEffect,useState} from 'react';
import {authClient} from '../auth';

type Category='prayer'|'quran'|'dhikr'|'book'|'sirah'|'tazkiyah'|'beneficial';
type Cadence='daily'|'weekly'|'monthly';
type Task={category:Category;title:string;cadence:Cadence;source_note:string};
type Template='prayer'|'quran'|'dhikr'|'book'|'sirah'|'tazkiyah'|'comprehensive'|'custom';
type CompletionMode='self'|'leader';
type Program={current_revision:number;template_kind:Template;title:string;completion_mode:CompletionMode};
type Revision={revision:number;title:string;created_at:string};
type StoredTask=Task&{revision:number;position:number};
type Completion={revision:number;position:number;completed_on:string;status:'pending'|'approved'|'rejected';user_id?:string};
type ProgressSummary={sharing_members:number;completion_count:number;visible:boolean};
const categories:Record<Category,string>={prayer:'الصلاة',quran:'القرآن',dhikr:'الذكر',book:'الكتاب',sirah:'السيرة',tazkiyah:'التزكية',beneficial:'عمل نافع'};
const cadences:Record<Cadence,string>={daily:'يومي',weekly:'أسبوعي',monthly:'شهري'};
const templates:Record<Exclude<Template,'custom'>,{title:string;tasks:Task[]}>= {
  prayer:{title:'برنامج الصلاة',tasks:[{category:'prayer',title:'المحافظة على الصلاة في وقتها',cadence:'daily',source_note:''}]},
  quran:{title:'برنامج القرآن',tasks:[{category:'quran',title:'قراءة ما تيسر من القرآن',cadence:'daily',source_note:''}]},
  dhikr:{title:'برنامج الذكر',tasks:[{category:'dhikr',title:'المداومة على ذكر الله',cadence:'daily',source_note:''}]},
  book:{title:'برنامج الكتاب',tasks:[{category:'book',title:'قراءة جزء من الكتاب المختار',cadence:'weekly',source_note:''}]},
  sirah:{title:'برنامج السيرة',tasks:[{category:'sirah',title:'مدارسة جانب من السيرة',cadence:'weekly',source_note:''}]},
  tazkiyah:{title:'برنامج التزكية',tasks:[{category:'tazkiyah',title:'مراجعة خلق والعمل على تحسينه',cadence:'weekly',source_note:''}]},
  comprehensive:{title:'برنامج شامل',tasks:[
    {category:'prayer',title:'المحافظة على الصلاة في وقتها',cadence:'daily',source_note:''},
    {category:'quran',title:'قراءة ما تيسر من القرآن',cadence:'daily',source_note:''},
    {category:'dhikr',title:'المداومة على ذكر الله',cadence:'daily',source_note:''},
    {category:'book',title:'قراءة جزء من الكتاب المختار',cadence:'weekly',source_note:''},
    {category:'sirah',title:'مدارسة جانب من السيرة',cadence:'weekly',source_note:''},
    {category:'tazkiyah',title:'مراجعة خلق والعمل على تحسينه',cadence:'weekly',source_note:''},
  ]},
};
const blankTask=():Task=>({category:'beneficial',title:'',cadence:'daily',source_note:''});
const errorText=(error:unknown)=>error&&typeof error==='object'&&'message'in error?String(error.message):'تعذر تنفيذ العملية.';

export default function CircleProgram({groupId,canEdit,userId}:{groupId:string;canEdit:boolean;userId:string}){
  const [program,setProgram]=useState<Program|null>(null);
  const [revisions,setRevisions]=useState<Revision[]>([]);
  const [allTasks,setAllTasks]=useState<StoredTask[]>([]);
  const [selectedRevision,setSelectedRevision]=useState<number|null>(null);
  const [template,setTemplate]=useState<Template>('custom');
  const [completionMode,setCompletionMode]=useState<CompletionMode>('self');
  const [title,setTitle]=useState('');
  const [tasks,setTasks]=useState<Task[]>([blankTask()]);
  const [editing,setEditing]=useState(false);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [completions,setCompletions]=useState<Completion[]>([]);
  const [shareAggregate,setShareAggregate]=useState(false);
  const [summary,setSummary]=useState<ProgressSummary|null>(null);
  const [pendingReviews,setPendingReviews]=useState<Completion[]>([]);
  const [reviewFilter,setReviewFilter]=useState('');
  const [progressAvailable,setProgressAvailable]=useState(true);
  const today=new Date().toISOString().slice(0,10);
  const cutoff=new Date(Date.now()-6*86400000).toISOString().slice(0,10);
  const loadProgress=async()=>{
    if(!authClient)return;
    const [own,sharing,aggregate]=await Promise.all([
      authClient.from('group_task_completions').select('revision,position,completed_on,status').eq('group_id',groupId).eq('user_id',userId).gte('completed_on',cutoff),
      authClient.from('group_progress_sharing').select('share_aggregate').eq('group_id',groupId).eq('user_id',userId).maybeSingle(),
      authClient.rpc('group_progress_summary' as any,{p_group_id:groupId}),
    ]);
    if(own.error)throw own.error;if(sharing.error)throw sharing.error;if(aggregate.error)throw aggregate.error;
    setCompletions((own.data??[]) as Completion[]);
    setShareAggregate(Boolean(sharing.data?.share_aggregate));
    setSummary(((aggregate.data as ProgressSummary[]|null)?.[0])??null);
    if(canEdit){
      const {data:reviews,error:reviewError}=await authClient.from('group_task_completions').select('revision,position,completed_on,status,user_id').eq('group_id',groupId).eq('status','pending').order('completed_on',{ascending:false});
      if(reviewError)throw reviewError;
      setPendingReviews((reviews??[]) as Completion[]);
    } else setPendingReviews([]);
  };
  const reviewCompletion=async(review:Completion,approve:boolean)=>{
    if(!authClient||!review.user_id||busy)return;
    setBusy(true);setError('');setNotice('');
    try{
      const {error:reviewError}=await authClient.rpc('review_group_task_completion',{p_group_id:groupId,p_user_id:review.user_id,p_revision:review.revision,p_position:review.position,p_completed_on:review.completed_on,p_approve:approve});
      if(reviewError)throw reviewError;
      setNotice(approve?'تم اعتماد الإنجاز.':'تم رفض الإنجاز.');
      await loadProgress();
    }catch(caught){setError(errorText(caught))}finally{setBusy(false)}
  };
  const load=async()=>{
    if(!authClient)return;
    setLoading(true);setError('');
    try{
      const [current,history,taskRows]=await Promise.all([
        authClient.from('group_programs').select('current_revision,template_kind,title,completion_mode').eq('group_id',groupId).maybeSingle(),
        authClient.from('group_program_revisions').select('revision,title,created_at').eq('group_id',groupId).order('revision',{ascending:false}),
        authClient.from('group_program_tasks').select('revision,position,category,title,cadence,source_note').eq('group_id',groupId).order('revision',{ascending:false}).order('position'),
      ]);
      if(current.error)throw current.error;if(history.error)throw history.error;if(taskRows.error)throw taskRows.error;
      const next=current.data as Program|null;
      setProgram(next);setRevisions((history.data??[]) as Revision[]);setAllTasks((taskRows.data??[]) as StoredTask[]);
      setSelectedRevision(next?.current_revision??null);
      try{await loadProgress();setProgressAvailable(true)}
      catch(progressError){
        const code=(progressError as {code?:string})?.code;
        if(code==='42P01'||code==='PGRST205'||code==='PGRST202')setProgressAvailable(false);
        else throw progressError;
      }
    }catch(caught){setError(errorText(caught))}finally{setLoading(false)}
  };
  useEffect(()=>{void load()},[groupId]);
  const chooseTemplate=(kind:Template)=>{
    setTemplate(kind);
    if(kind==='custom'){setTitle('برنامج مخصص');setTasks([blankTask()]);return}
    const preset=templates[kind];setTitle(preset.title);setTasks(preset.tasks.map(task=>({...task})));
  };
  const startEdit=()=>{
    if(program){setTemplate(program.template_kind);setTitle(program.title);setCompletionMode(program.completion_mode??'self');setTasks(allTasks.filter(task=>task.revision===program.current_revision).map(({category,title,cadence,source_note})=>({category,title,cadence,source_note})))}
    else chooseTemplate('comprehensive');
    setEditing(true);setNotice('');
  };
  const updateTask=(index:number,patch:Partial<Task>)=>setTasks(current=>current.map((task,i)=>i===index?{...task,...patch}:task));
  const save=async()=>{
    if(!authClient||busy)return;
    if(!title.trim()||title.trim().length>120||tasks.length<1||tasks.length>30||tasks.some(task=>!task.title.trim()||task.title.trim().length>200||task.source_note.length>500)){
      setError('اكتب عنوانًا للبرنامج وكل مهمة، ضمن الحدود المحددة.');return;
    }
    setBusy(true);setError('');
    try{
      const {error:saveError}=await authClient.rpc('save_group_program',{p_group_id:groupId,p_template_kind:template,p_title:title.trim(),p_tasks:tasks.map(task=>({...task,title:task.title.trim(),source_note:task.source_note.trim()}))});
      if(saveError)throw saveError;
      const {error:modeError}=await authClient.rpc('set_group_program_completion_mode',{p_group_id:groupId,p_mode:completionMode});
      if(modeError)throw modeError;
      setEditing(false);setNotice('حُفظت نسخة جديدة من الواجب العملي للمجلس العلمي؛ النسخ السابقة باقية.');await load();
    }catch(caught){setError(errorText(caught))}finally{setBusy(false)}
  };
  const toggleCompletion=async(position:number,completed:boolean)=>{
    if(!authClient||busy)return;
    setBusy(true);setError('');setNotice('');
    try{
      const {error:saveError}=await authClient.rpc((completed?'uncomplete_group_task':'complete_group_task') as any,{p_group_id:groupId,p_position:position,p_completed_on:today});
      if(saveError)throw saveError;
      await loadProgress();
    }catch(caught){setError(errorText(caught))}finally{setBusy(false)}
  };
  const updateSharing=async(share:boolean)=>{
    if(!authClient||busy)return;
    setBusy(true);setError('');
    try{
      const {error:saveError}=await authClient.rpc('set_group_progress_sharing' as any,{p_group_id:groupId,p_share:share});
      if(saveError)throw saveError;
      await loadProgress();
      setNotice(share?'ستُحتسب إنجازاتك في الإجمالي المجهول عند توفر ثلاثة مشاركين.':'أُوقفت مشاركة إنجازاتك في الإجمالي.');
    }catch(caught){setError(errorText(caught))}finally{setBusy(false)}
  };
  const shown=selectedRevision??program?.current_revision;
  return <div className="circle-program" aria-label="الواجب العملي للمجلس العلمي">
    <p className="muted small circle-program-intro">هذا القسم اختياري. يضعه مؤسس المجلس العلمي أو الشيخ المسؤول لمساعدة الطلاب على تحويل هدف المجلس إلى خطوات عملية.</p>
    {loading?<p role="status">جارٍ تحميل البرنامج…</p>:<>
      {error&&<p className="circles-notice error" role="alert">{error} <button className="soft-btn" onClick={()=>void load()}>إعادة المحاولة</button></p>}
      {notice&&<p className="circles-notice" role="status">{notice}</p>}
      {!program&&!editing&&<p className="muted small">لم يُضف واجب عملي لهذا المجلس العلمي؛ وجود المجلس لا يتطلب واجبًا.</p>}
      {program&&!editing&&<>
        <p><strong>{program.title}</strong> · النسخة {shown}</p>
        <ul>{allTasks.filter(task=>task.revision===shown).map(task=>{
          const record=completions.find(row=>row.revision===task.revision&&row.position===task.position&&row.completed_on===today);
          const completed=record?.status==='approved';
          return <li key={`${task.revision}-${task.position}`}>{task.title} · {cadences[task.cadence]} · {categories[task.category]}{task.source_note&&<small> — المصدر: {task.source_note}</small>}{record?.status==='pending'&&<small className="muted"> قيد اعتماد الشيخ</small>}{record?.status==='rejected'&&<small className="muted"> يحتاج مراجعة</small>}{progressAvailable&&shown===program.current_revision&&(program.completion_mode==='self'||canEdit)&&<button className="soft-btn" disabled={busy} aria-pressed={completed} onClick={()=>void toggleCompletion(task.position,completed)}>{completed?'أُنجزت اليوم — تراجع':'تسجيل إنجاز اليوم'}</button>}{progressAvailable&&shown===program.current_revision&&program.completion_mode==='leader'&&!canEdit&&<small className="muted">بانتظار اعتماد الشيخ</small>}</li>;
        })}</ul>
        {progressAvailable?<section className="circle-progress" aria-label="متابعة البرنامج">
          <h4>متابعتي الخاصة</h4>
          <p>إنجازاتي في النسخة الحالية خلال آخر ٧ أيام: {completions.filter(row=>row.revision===program.current_revision).length}. لا يراها أعضاء الحلقة الآخرون.</p>
          <label className="circle-progress-share"><input type="checkbox" checked={shareAggregate} disabled={busy} onChange={event=>void updateSharing(event.target.checked)}/> أوافق على احتساب إنجازاتي ضمن إجمالي الحلقة المجهول الاسم</label>
          <p className="muted small">المشاركة اختيارية ومغلقة افتراضيًا. لا تُعرض أسماء أو إنجازات فردية. لا يشمل هذا الخيار بيانات «حاسب نفسك» الخاصة.</p>
          {summary?.visible?<p role="status">إجمالي إنجازات المشاركين في النسخة الحالية خلال آخر ٧ أيام: {summary.completion_count} من {summary.sharing_members} أعضاء مشاركين.</p>:<p className="muted small" role="status">يظهر الإجمالي بعد موافقة ثلاثة أعضاء على الأقل.</p>}
        </section>:<p className="muted small">متابعة البرنامج الجديدة بانتظار تحديث قاعدة البيانات المتصلة.</p>}
        {canEdit&&<section className="circle-progress" aria-label="طلبات اعتماد الإنجاز"><h4>طلبات اعتماد الإنجاز</h4>{pendingReviews.length===0?<p className="muted small">لا توجد طلبات معلّقة حاليًا.</p>:<><p className="muted small">عدد الطلبات المعلّقة: {pendingReviews.length}. تظهر الطلبات دون كشف بيانات شخصية غير لازمة.</p><input className="review-filter" placeholder="بحث بالتاريخ أو رقم المهمة" value={reviewFilter} onChange={event=>setReviewFilter(event.target.value.trim())}/>{(()=>{const filtered=pendingReviews.filter(review=>!reviewFilter||review.completed_on.includes(reviewFilter)||String(review.position)===reviewFilter);return filtered.length===0?<p className="muted small">لا توجد طلبات مطابقة.</p>:<ul>{filtered.map(review=><li key={`${review.user_id}-${review.revision}-${review.position}-${review.completed_on}`}>عضو المجلس · المهمة {review.position} · {review.completed_on}<button className="soft-btn" disabled={busy} onClick={()=>void reviewCompletion(review,true)}>اعتماد</button><button className="soft-btn" disabled={busy} onClick={()=>void reviewCompletion(review,false)}>رفض</button></li>)}</ul>})()}</>}</section>}
        {revisions.length>1&&<label>سجل النسخ <select value={shown} onChange={event=>setSelectedRevision(Number(event.target.value))}>{revisions.map(revision=><option key={revision.revision} value={revision.revision}>النسخة {revision.revision} · {revision.title}</option>)}</select></label>}
      </>}
      {canEdit&&!editing&&<button className="soft-btn" onClick={startEdit}>{program?'تعديل البرنامج':'إضافة برنامج'}</button>}
      {canEdit&&editing&&<div className="circle-program-editor">
        <label>قالب الواجب العملي<select value={template} onChange={event=>chooseTemplate(event.target.value as Template)}>{Object.keys(templates).map(key=><option key={key} value={key}>{templates[key as Exclude<Template,'custom'>].title}</option>)}<option value="custom">واجب عملي مخصص</option></select></label>
        <label>عنوان الواجب العملي<input value={title} maxLength={120} onChange={event=>setTitle(event.target.value)}/></label>
        <label>طريقة تسجيل الإنجاز<select value={completionMode} onChange={event=>setCompletionMode(event.target.value as CompletionMode)}><option value="self">يسجل الطالب إنجازه بنفسه</option><option value="leader">يعتمد الشيخ أو مؤسس المجلس الإنجاز</option></select></label>
        {tasks.map((task,index)=><div className="circle-program-task" key={index}>
          <label>المهمة {index+1}<input value={task.title} maxLength={200} onChange={event=>updateTask(index,{title:event.target.value})}/></label>
          <label>المجال<select value={task.category} onChange={event=>updateTask(index,{category:event.target.value as Category})}>{Object.entries(categories).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
          <label>التكرار<select value={task.cadence} onChange={event=>updateTask(index,{cadence:event.target.value as Cadence})}>{Object.entries(cadences).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
          <label>مصدر اختياري<input value={task.source_note} maxLength={500} onChange={event=>updateTask(index,{source_note:event.target.value})}/></label>
          <button className="soft-btn" disabled={tasks.length===1} onClick={()=>setTasks(current=>current.filter((_,i)=>i!==index))}>حذف المهمة</button>
        </div>)}
        <p className="muted small">لا تُنسب فضائل أو أعداد مخصوصة إلى الشرع دون مصدر موثوق. التعديل ينشئ نسخة جديدة ويحفظ القديمة.</p>
        <div className="circle-actions"><button className="soft-btn" disabled={tasks.length>=30||busy} onClick={()=>setTasks(current=>[...current,blankTask()])}>إضافة مهمة</button><button className="primary" disabled={busy} onClick={()=>void save()}>{busy?'جارٍ الحفظ…':'حفظ البرنامج'}</button><button className="soft-btn" disabled={busy} onClick={()=>setEditing(false)}>إلغاء</button></div>
      </div>}
    </>}
  </div>;
}
