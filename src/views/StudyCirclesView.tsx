import {useEffect,useState,type FormEvent} from 'react';
import {ArrowRight,BookOpen,CalendarDays,Check,ClipboardCopy,Plus,RefreshCw,Users} from 'lucide-react';
import {authClient} from '../auth';
import StudyTracksView from './StudyTracksView';
import StudyMeetingsPanel from './StudyMeetingsPanel';
import StudyNotesPanel from './StudyNotesPanel';
import StudyQuestionsPanel from './StudyQuestionsPanel';
import '../mudarasa.css';

type Circle={
  id:string;creator_id:string;title:string;description:string;goal:string;kind:string;category:string;mode:string;access:string;
  status:string;starts_on:string|null;ends_on:string|null;pace_target:number|null;pace_unit:string;pace_period:string;created_at:string;
};
type Material={id:string;circle_id:string;kind:string;title:string;author:string;url:string;description:string;position:number};
type Part={id:string;material_id:string;title:string;position:number;page_start:number|null;page_end:number|null;url:string;is_required:boolean};
type Task={id:string;title:string;position:number;material_id:string|null;part_id:string|null;target_date:string|null};
type Member={member_id:string;member_role:string;joined_at:string};
type Request={id:string;user_id:string;note:string;created_at:string};
type Summary={total_tasks:number;my_completed:number;members_count:number;group_completed:number};
type Detail={materials:Material[];parts:Part[];tasks:Task[];members:Member[];requests:Request[];completed:string[];summary:Summary|null};
type Draft={title:string;kind:string;category:string;mode:string;access:string;description:string;goal:string;startsOn:string;endsOn:string;paceTarget:string;paceUnit:string;pacePeriod:string};

const blankDraft:Draft={title:'',kind:'book',category:'aqeedah',mode:'async',access:'approval',description:'',goal:'',startsOn:'',endsOn:'',paceTarget:'',paceUnit:'pages',pacePeriod:'weekly'};
const kindNames:Record<string,string>={book:'كتاب',series:'سلسلة دروس',lectures:'محاضرات',topic:'موضوع علمي'};
const categoryNames:Record<string,string>={aqeedah:'العقيدة',tafsir:'التفسير',hadith:'الحديث',fiqh:'الفقه',seerah:'السيرة',tazkiyah:'التزكية',other:'أخرى'};
const modeNames:Record<string,string>={sync:'متزامنة',async:'غير متزامنة',supervised:'بإشراف معلم'};
const statusNames:Record<string,string>={active:'نشطة',paused:'متوقفة مؤقتًا',completed:'مكتملة',cancelled:'ملغاة'};
const roleNames:Record<string,string>={creator:'المؤسس',supervisor:'المشرف',teacher:'المعلم',member:'عضو'};
const tabs=[['overview','نظرة عامة'],['material','المادة'],['plan','الخطة'],['notes','الفوائد'],['questions','الأسئلة'],['meetings','الاجتماعات'],['members','الأعضاء']] as const;

function errorText(error:unknown){
  if(error instanceof Error)return error.message;
  if(typeof error==='object'&&error!==null&&'message' in error&&typeof error.message==='string')return error.message;
  return 'حدث خطأ. حاول مرة أخرى.';
}

export default function StudyCirclesView({user}:{user:{id:string}|null}){
  const [section,setSection]=useState<'circles'|'tracks'>('circles');
  const [circles,setCircles]=useState<Circle[]>([]);
  const [selectedId,setSelectedId]=useState('');
  const [detail,setDetail]=useState<Detail|null>(null);
  const [tab,setTab]=useState<(typeof tabs)[number][0]>('overview');
  const [loading,setLoading]=useState(true);
  const [detailLoading,setDetailLoading]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [refresh,setRefresh]=useState(0);
  const [createOpen,setCreateOpen]=useState(false);
  const [draft,setDraft]=useState(blankDraft);
  const [joinCode,setJoinCode]=useState('');
  const [joinNote,setJoinNote]=useState('');
  const [inviteCode,setInviteCode]=useState('');
  const selected=circles.find(circle=>circle.id===selectedId)??null;

  useEffect(()=>{
    let active=true;
    const loadCircles=async()=>{
      setLoading(true);setError('');
      if(!authClient||!user){setCircles([]);setLoading(false);return}
      try{
        const {data,error:loadError}=await authClient.from('study_circles').select('*').order('created_at',{ascending:false});
        if(loadError)throw loadError;
        if(active)setCircles((data??[]) as Circle[]);
      }catch(caught){if(active)setError(errorText(caught))}
      finally{if(active)setLoading(false)}
    };
    void loadCircles();
    return()=>{active=false};
  },[user?.id,refresh]);

  useEffect(()=>{
    let active=true;
    const loadDetail=async()=>{
      if(!selectedId||!user||!authClient){setDetail(null);return}
      setDetailLoading(true);setError('');setInviteCode('');
      try{
        const {data:memberData,error:memberError}=await authClient.rpc('list_study_members',{p_circle_id:selectedId});
        if(memberError)throw memberError;
        const members=(memberData??[]) as Member[];
        const ownRole=members.find(member=>member.member_id===user.id)?.member_role;
        const canReview=ownRole==='creator'||ownRole==='supervisor';
        const [materialResult,partResult,taskResult,progressResult,summaryResult,requestResult]=await Promise.all([
          authClient.from('study_materials').select('*').eq('circle_id',selectedId).order('position'),
          authClient.from('study_material_parts').select('*').eq('circle_id',selectedId).order('position'),
          authClient.from('study_plan_tasks').select('*').eq('circle_id',selectedId).order('position'),
          authClient.from('study_task_progress').select('task_id').eq('circle_id',selectedId).eq('user_id',user.id),
          authClient.rpc('study_progress_summary',{p_circle_id:selectedId}),
          canReview?authClient.from('study_circle_join_requests').select('id,user_id,note,created_at').eq('circle_id',selectedId).eq('status','pending').order('created_at'):
            Promise.resolve({data:[],error:null}),
        ]);
        for(const result of [materialResult,partResult,taskResult,progressResult,summaryResult,requestResult])if(result.error)throw result.error;
        if(!active)return;
        setDetail({
          materials:(materialResult.data??[]) as Material[],parts:(partResult.data??[]) as Part[],tasks:(taskResult.data??[]) as Task[],
          members,requests:(requestResult.data??[]) as Request[],completed:(progressResult.data??[]).map((row:any)=>row.task_id),
          summary:((summaryResult.data??[])[0]??null) as Summary|null,
        });
      }catch(caught){if(active){setDetail(null);setError(errorText(caught))}}
      finally{if(active)setDetailLoading(false)}
    };
    void loadDetail();
    return()=>{active=false};
  },[selectedId,user?.id,refresh]);

  const runAction=async(action:()=>Promise<void>,success:string)=>{
    setBusy(true);setError('');setNotice('');
    try{await action();setNotice(success);setRefresh(value=>value+1)}
    catch(caught){setError(errorText(caught))}
    finally{setBusy(false)}
  };

  const createCircle=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    const client=authClient;
    if(!client)return;
    const paceTarget=draft.paceTarget?Number(draft.paceTarget):null;
    await runAction(async()=>{
      const {data,error:createError}=await client.rpc('create_study_circle',{
        p_title:draft.title.trim(),p_kind:draft.kind,p_category:draft.category,p_mode:draft.mode,
        p_description:draft.description,p_goal:draft.goal,p_access:draft.access,
        p_starts_on:draft.startsOn||null,p_ends_on:draft.endsOn||null,p_pace_target:paceTarget,
        p_pace_unit:paceTarget?draft.paceUnit:'',p_pace_period:paceTarget?draft.pacePeriod:'',
      });
      if(createError)throw createError;
      const id=String(data??'');
      if(!id)throw new Error('لم يُرجع الخادم معرف المدارسة.');
      setSelectedId(id);setTab('overview');setCreateOpen(false);setDraft(blankDraft);
    },'أُنشئت المدارسة.');
  };

  const requestJoin=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    const client=authClient;
    if(!client)return;
    await runAction(async()=>{
      const {error:requestError}=await client.rpc('request_study_join',{p_code:joinCode.trim().toUpperCase(),p_note:joinNote.trim()});
      if(requestError)throw requestError;
      setJoinCode('');setJoinNote('');
    },'أُرسل طلب الانضمام للمراجعة.');
  };

  const createInvite=async()=>{
    if(!authClient||!selected)return;
    setBusy(true);setError('');setNotice('');
    try{
      const {data,error:inviteError}=await authClient.rpc('create_study_invite',{p_circle_id:selected.id});
      if(inviteError)throw inviteError;
      const code=typeof data==='string'?data:'';
      if(!code)throw new Error('لم يُرجع الخادم رمز الدعوة. تحقق من تحديث قاعدة البيانات ثم أعد المحاولة.');
      setInviteCode(code);setNotice('أُنشئ رمز الدعوة. أرسله لمن تريد دعوته.');
    }catch(caught){setError(errorText(caught))}finally{setBusy(false)}
  };

  const addMaterial=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    const client=authClient;
    if(!client||!selected)return;
    const targetForm=event.currentTarget;
    const form=new FormData(targetForm);
    await runAction(async()=>{
      const {error:addError}=await client.rpc('add_study_material',{
        p_circle_id:selected.id,p_kind:String(form.get('kind')),p_title:String(form.get('title')),
        p_author:String(form.get('author')??''),p_url:String(form.get('url')??''),p_description:String(form.get('description')??''),
      });
      if(addError)throw addError;
      targetForm.reset();
    },'أُضيفت المادة.');
  };

  const addPart=async(event:FormEvent<HTMLFormElement>,materialId:string)=>{
    event.preventDefault();
    const client=authClient;
    if(!client)return;
    const targetForm=event.currentTarget;
    const form=new FormData(targetForm);
    await runAction(async()=>{
      const {error:addError}=await client.rpc('add_study_part',{
        p_material_id:materialId,p_title:String(form.get('title')),p_page_start:form.get('pageStart')?Number(form.get('pageStart')):null,
        p_page_end:form.get('pageEnd')?Number(form.get('pageEnd')):null,p_url:'',p_is_required:true,
      });
      if(addError)throw addError;
      targetForm.reset();
    },'أُضيف الجزء إلى المادة.');
  };

  const addTask=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    const client=authClient;
    if(!client||!selected||!detail)return;
    const targetForm=event.currentTarget;
    const form=new FormData(targetForm);
    const title=String(form.get('title')??'').trim();
    await runAction(async()=>{
      const p_tasks=[...detail.tasks.map(task=>({title:task.title,material_id:task.material_id,part_id:task.part_id,target_date:task.target_date})),{title,material_id:null,part_id:null,target_date:null}];
      const {error:addError}=await client.rpc('set_study_plan',{p_circle_id:selected.id,p_tasks});
      if(addError)throw addError;
      targetForm.reset();
    },'أُضيفت المهمة إلى الخطة.');
  };

  const markTask=async(taskId:string,done:boolean)=>{
    const client=authClient;
    if(!client)return;
    await runAction(async()=>{
      const {error:markError}=await client.rpc('mark_study_task',{p_task_id:taskId,p_done:done});
      if(markError)throw markError;
    },done?'سُجّل إنجازك.':'أُلغي تسجيل الإنجاز.');
  };

  const reviewRequest=async(requestId:string,approve:boolean)=>{
    const client=authClient;
    if(!client)return;
    await runAction(async()=>{
      const {error:reviewError}=await client.rpc('decide_study_join_request',{p_request_id:requestId,p_approve:approve});
      if(reviewError)throw reviewError;
    },approve?'قُبل طلب الانضمام.':'رُفض طلب الانضمام.');
  };

  const setStatus=async(status:string)=>{
    const client=authClient;
    if(!client||!selected)return;
    await runAction(async()=>{
      const {error:statusError}=await client.rpc('set_study_circle_status',{p_circle_id:selected.id,p_status:status});
      if(statusError)throw statusError;
    },`تغيرت حالة المدارسة إلى ${statusNames[status]??status}.`);
  };

  if(section==='tracks')return <div className="mudarasa-view"><div className="mudarasa-topline"><button className="soft-btn" onClick={()=>setSection('circles')}><ArrowRight size={16}/> مدارساتي</button></div><StudyTracksView user={user}/></div>;

  const ownRole=detail?.members.find(member=>member.member_id===user?.id)?.member_role;
  const canReview=ownRole==='creator'||ownRole==='supervisor';
  const canInvite=canReview;
  const canEditPlan=canInvite;
  const canEditMaterial=ownRole==='creator'||ownRole==='supervisor'||ownRole==='teacher';
  const isCreator=ownRole==='creator';

  return <div className="mudarasa-view" dir="rtl">
    <header className="page-intro mudarasa-heading">
      <div><span className="eyebrow">طلب العلم معًا</span><h1>المدارسة</h1><p>مدارسات خاصة يجتمع أعضاؤها على مادة علمية وخطة واضحة.</p></div>
      <div className="mudarasa-actions"><button className="soft-btn" onClick={()=>setSection('tracks')}><BookOpen size={16}/> مسارات الدراسة القديمة</button><button className="soft-btn" onClick={()=>setRefresh(value=>value+1)}><RefreshCw size={16}/> تحديث</button></div>
    </header>
    {error&&<p className="mudarasa-message error" role="alert">{error}</p>}
    {notice&&<p className="mudarasa-message" role="status">{notice}</p>}
    {!user?<section className="panel mudarasa-empty"><h2>سجّل الدخول لفتح المدارسة</h2><p>المدارسات ومحتواها متاحة للأعضاء فقط.</p></section>:<>
      {selected&&<>
        <button className="mudarasa-back" onClick={()=>{setSelectedId('');setDetail(null);setError('');setNotice('')}}><ArrowRight size={16}/> العودة إلى مدارساتي</button>
        <section className="panel mudarasa-detail-head">
          <div className="mudarasa-detail-title"><span className={`mudarasa-status ${selected.status}`}>{statusNames[selected.status]??selected.status}</span><h2>{selected.title}</h2><p>{kindNames[selected.kind]??selected.kind} · {categoryNames[selected.category]??selected.category} · {modeNames[selected.mode]??selected.mode}</p></div>
          {canInvite&&selected.status==='active'&&<button className="primary" disabled={busy} onClick={()=>void createInvite()}><Plus size={16}/> إنشاء دعوة</button>}
          {isCreator&&<div className="mudarasa-status-actions">{selected.status==='active'?<button className="soft-btn" disabled={busy} onClick={()=>void setStatus('paused')}>إيقاف مؤقت</button>:selected.status==='paused'?<button className="soft-btn" disabled={busy} onClick={()=>void setStatus('active')}>استئناف</button>:null}</div>}
          {inviteCode&&<div className="mudarasa-invite"><strong>رابط الدعوة</strong><input readOnly value={`${window.location.origin}/invite/${inviteCode}`} aria-label="رابط الدعوة"/><button className="soft-btn" onClick={()=>void navigator.clipboard?.writeText(`${window.location.origin}/invite/${inviteCode}`)}><ClipboardCopy size={15}/> نسخ</button></div>}
        </section>
        <nav className="mudarasa-tabs" aria-label="أقسام المدارسة">{tabs.map(([id,label])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}</button>)}</nav>
        {detailLoading?<p role="status">جارٍ تحميل محتوى المدارسة…</p>:detail&&<>
          {tab==='overview'&&<div className="mudarasa-columns">
            <section className="panel"><h3>عن المدارسة</h3><p className="mudarasa-copy">{selected.description||'لم يضف المؤسس وصفًا بعد.'}</p>{selected.goal&&<p><strong>الهدف:</strong> {selected.goal}</p>}<ul className="mudarasa-facts"><li><Users size={16}/>{detail.members.length} أعضاء</li>{selected.starts_on&&<li><CalendarDays size={16}/>تبدأ {selected.starts_on}</li>}{selected.ends_on&&<li><CalendarDays size={16}/>تنتهي {selected.ends_on}</li>}{selected.pace_target&&<li><BookOpen size={16}/>{selected.pace_target} {selected.pace_unit} {selected.pace_period==='daily'?'يوميًا':'أسبوعيًا'}</li>}</ul></section>
            <section className="panel"><h3>التقدم</h3><p className="mudarasa-progress-number">{detail.summary?.my_completed??0}<span> / {detail.summary?.total_tasks??detail.tasks.length}</span></p><p className="muted">إنجازك الشخصي في الخطة</p><p className="mudarasa-group-progress">إنجازات المجموعة المجهولة: {detail.summary?.group_completed??0}</p></section>
          </div>}
          {tab==='material'&&<div className="mudarasa-section">
            {canEditMaterial&&selected.status==='active'&&<section className="panel"><h3>إضافة مادة</h3><form className="mudarasa-form" onSubmit={event=>void addMaterial(event)}><div className="mudarasa-form-grid"><label>نوع المادة<select name="kind"><option value="book">كتاب</option><option value="video">درس مرئي</option><option value="audio">درس صوتي</option><option value="pdf">ملف PDF</option><option value="other">أخرى</option></select></label><label>العنوان<input name="title" required maxLength={200}/></label><label>المؤلف أو المعلم<input name="author" maxLength={200}/></label><label>رابط المادة<input name="url" type="url" maxLength={1000}/></label></div><label>وصف موجز<textarea name="description" rows={2} maxLength={2000}/></label><button className="primary" disabled={busy}><Plus size={16}/> إضافة المادة</button></form></section>}
            {detail.materials.length===0?<section className="panel mudarasa-empty"><h3>لم تُضف مادة بعد</h3><p>ستظهر هنا الكتب والدروس المعتمدة لهذه المدارسة.</p></section>:<ul className="mudarasa-list">{detail.materials.map(material=><li key={material.id}><article className="panel mudarasa-item"><div className="mudarasa-item-title"><div><span className="eyebrow">{material.kind==='book'?'كتاب':material.kind==='video'?'درس مرئي':material.kind==='audio'?'درس صوتي':material.kind==='pdf'?'ملف PDF':'مادة'}</span><h3>{material.title}</h3>{material.author&&<p className="muted">{material.author}</p>}{material.description&&<p>{material.description}</p>}{material.url&&<a href={material.url} target="_blank" rel="noreferrer">فتح المادة</a>}</div></div><ul className="mudarasa-parts">{detail.parts.filter(part=>part.material_id===material.id).map(part=><li key={part.id}>{part.position}. {part.title}{part.page_start&&<span> · ص {part.page_start}{part.page_end?`–${part.page_end}`:''}</span>}</li>)}</ul>{canEditMaterial&&selected.status==='active'&&<form className="mudarasa-part-form" onSubmit={event=>void addPart(event,material.id)}><label>جزء جديد<input name="title" required maxLength={200} placeholder="عنوان الفصل أو الدرس"/></label><label>من صفحة<input name="pageStart" type="number" min="1" max="10000"/></label><label>إلى صفحة<input name="pageEnd" type="number" min="1" max="10000"/></label><button className="soft-btn" disabled={busy}><Plus size={15}/> إضافة جزء</button></form>}</article></li>)}</ul>}
          </div>}
          {tab==='plan'&&<div className="mudarasa-section">
            {canEditPlan&&selected.status==='active'&&<section className="panel"><h3>إضافة مهمة للخطة</h3><form className="mudarasa-inline-form" onSubmit={event=>void addTask(event)}><label>المهمة<input name="title" required maxLength={200} placeholder="مثل: قراءة الفصل الأول"/></label><button className="primary" disabled={busy}><Plus size={16}/> إضافة</button></form></section>}
            {detail.tasks.length===0?<section className="panel mudarasa-empty"><h3>الخطة لم تبدأ بعد</h3><p>يضيف المؤسس أو المشرف مهام القراءة هنا.</p></section>:<ol className="mudarasa-plan">{detail.tasks.map(task=>{const done=detail.completed.includes(task.id);return <li key={task.id}><div><strong>{task.position}. {task.title}</strong>{task.target_date&&<span className="muted"> · {task.target_date}</span>}</div><button className={done?'soft-btn':'primary'} disabled={busy} onClick={()=>void markTask(task.id,!done)}>{done?<><Check size={15}/> أُنجزت</>:'تسجيل الإنجاز'}</button></li>})}</ol>}
          </div>}
          {tab==='notes'&&<StudyNotesPanel circleId={selected.id} userId={user.id} active={selected.status==='active'}/>}
          {tab==='questions'&&<StudyQuestionsPanel circleId={selected.id} userId={user.id} active={selected.status==='active'} isStaff={Boolean(canReview||ownRole==='teacher')} isTeacher={ownRole==='teacher'}/>}
          {tab==='meetings'&&<StudyMeetingsPanel circleId={selected.id} userId={user.id} active={selected.status==='active'} isStaff={Boolean(canEditMaterial)} memberIds={detail.members.map(member=>member.member_id)}/>}
          {tab==='members'&&<div className="mudarasa-section">
            <section className="panel"><h3>الأعضاء</h3><ul className="mudarasa-members">{detail.members.map(member=><li key={member.member_id}><span><bdi>{member.member_id.slice(0,8)}</bdi></span><span className="mudarasa-role">{roleNames[member.member_role]??member.member_role}</span></li>)}</ul></section>
            {canReview&&<section className="panel"><h3>طلبات الانضمام <span className="mudarasa-count">{detail.requests.length}</span></h3>{detail.requests.length===0?<p className="muted">لا توجد طلبات معلقة.</p>:<ul className="mudarasa-requests">{detail.requests.map(request=><li key={request.id}><div><strong><bdi>{request.user_id.slice(0,8)}</bdi></strong><p>{request.note||'بلا ملاحظة'}</p></div><div className="mudarasa-actions"><button className="primary" disabled={busy} onClick={()=>void reviewRequest(request.id,true)}><Check size={15}/> قبول</button><button className="soft-btn" disabled={busy} onClick={()=>void reviewRequest(request.id,false)}>رفض</button></div></li>)}</ul>}</section>}
          </div>}
        </>}
      </>}
      {!selected&&<>
        <div className="mudarasa-toolbar"><button className="primary" onClick={()=>setCreateOpen(open=>!open)}><Plus size={16}/>{createOpen?'إغلاق النموذج':'إنشاء مدارسة'}</button><span>{circles.length} مدارسات</span></div>
        {createOpen&&<section className="panel"><h2>مدارسة جديدة</h2><form className="mudarasa-form" onSubmit={event=>void createCircle(event)}>
          <div className="mudarasa-form-grid"><label>اسم المدارسة<input required minLength={3} maxLength={160} value={draft.title} onChange={event=>setDraft({...draft,title:event.target.value})}/></label><label>المادة<select value={draft.kind} onChange={event=>setDraft({...draft,kind:event.target.value})}><option value="book">كتاب</option><option value="series">سلسلة دروس</option><option value="lectures">محاضرات</option><option value="topic">موضوع علمي</option></select></label><label>التصنيف<select value={draft.category} onChange={event=>setDraft({...draft,category:event.target.value})}>{Object.entries(categoryNames).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>طريقة المدارسة<select value={draft.mode} onChange={event=>setDraft({...draft,mode:event.target.value})}><option value="async">غير متزامنة</option><option value="sync">متزامنة</option><option value="supervised">بإشراف معلم</option></select></label><label>الانضمام<select value={draft.access} onChange={event=>setDraft({...draft,access:event.target.value})}><option value="approval">بطلب وموافقة</option><option value="invite">بدعوة</option></select></label><label>تاريخ البداية<input type="date" value={draft.startsOn} onChange={event=>setDraft({...draft,startsOn:event.target.value})}/></label><label>تاريخ النهاية<input type="date" min={draft.startsOn||undefined} value={draft.endsOn} onChange={event=>setDraft({...draft,endsOn:event.target.value})}/></label><label>هدف الإنجاز<input name="paceTarget" type="number" min="1" max="500" inputMode="numeric" value={draft.paceTarget} onChange={event=>setDraft({...draft,paceTarget:event.target.value})} placeholder="اختياري"/></label><label>وحدة الإنجاز<select value={draft.paceUnit} disabled={!draft.paceTarget} onChange={event=>setDraft({...draft,paceUnit:event.target.value})}><option value="pages">صفحات</option><option value="chapters">فصول</option><option value="lessons">دروس</option><option value="minutes">دقائق</option></select></label><label>التكرار<select value={draft.pacePeriod} disabled={!draft.paceTarget} onChange={event=>setDraft({...draft,pacePeriod:event.target.value})}><option value="daily">يومي</option><option value="weekly">أسبوعي</option></select></label></div>
          <label>وصف المدارسة<textarea maxLength={3000} rows={3} value={draft.description} onChange={event=>setDraft({...draft,description:event.target.value})}/></label><label>الهدف العلمي<textarea maxLength={2000} rows={2} value={draft.goal} onChange={event=>setDraft({...draft,goal:event.target.value})}/></label><button className="primary" disabled={busy}><Plus size={16}/> إنشاء المدارسة</button>
        </form></section>}
        <section className="mudarasa-join"><div><h2>لديك رمز دعوة؟</h2><p>أرسل طلب انضمام، ويصل للمؤسس أو المشرف لاتخاذ القرار.</p></div><form onSubmit={event=>void requestJoin(event)}><label>رمز الدعوة<input required minLength={20} maxLength={20} value={joinCode} onChange={event=>setJoinCode(event.target.value.toUpperCase())} placeholder="20 حرفًا"/></label><label>ملاحظة للمؤسس<input maxLength={500} value={joinNote} onChange={event=>setJoinNote(event.target.value)}/></label><button className="soft-btn" disabled={busy||joinCode.trim().length!==20}>إرسال الطلب</button></form></section>
        {loading?<p role="status">جارٍ تحميل مدارساتك…</p>:error?null:circles.length===0?<section className="panel mudarasa-empty"><h2>لا توجد مدارسات بعد</h2><p>أنشئ مدارسة أو انضم برمز دعوة لتبدأ طلب العلم مع مجموعة.</p><button className="primary" onClick={()=>setCreateOpen(true)}><Plus size={16}/> إنشاء أول مدارسة</button></section>:<ul className="mudarasa-grid">{circles.map(circle=><li key={circle.id}><button className="panel mudarasa-circle-card" onClick={()=>{setSelectedId(circle.id);setTab('overview')}}><span className={`mudarasa-status ${circle.status}`}>{statusNames[circle.status]??circle.status}</span><h2>{circle.title}</h2><p>{kindNames[circle.kind]??circle.kind} · {categoryNames[circle.category]??circle.category}</p>{circle.goal&&<p className="mudarasa-card-goal">{circle.goal}</p>}<span className="mudarasa-open">فتح المدارسة <ArrowRight size={15}/></span></button></li>)}</ul>}
      </>}
    </>}
  </div>;
}