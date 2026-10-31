import {useEffect,useState,type FormEvent} from 'react';
import {Check,MessageSquare,Pin,Plus} from 'lucide-react';
import {authClient} from '../auth';

type Question={id:string;asker_id:string;title:string;content:string;part_id:string|null;status:string;is_pinned:boolean;reply_count:number|string;created_at:string;reviewed_by:string|null;reviewed_at:string|null};
type Reply={id:string;author_id:string;content:string;teacher_verified:boolean;created_at:string};

const stateNames:Record<string,string>={open:'مفتوح',answered:'تمت الإجابة',needs_review:'تحتاج مراجعة'};

function errorText(error:unknown){
  if(error instanceof Error)return error.message;
  if(typeof error==='object'&&error!==null&&'message' in error&&typeof error.message==='string')return error.message;
  return 'حدث خطأ. حاول مرة أخرى.';
}

export default function StudyQuestionsPanel({circleId,userId,active,isStaff,isTeacher}:{circleId:string;userId:string;active:boolean;isStaff:boolean;isTeacher:boolean}){
  const [questions,setQuestions]=useState<Question[]>([]);
  const [replies,setReplies]=useState<Record<string,Reply[]>>({});
  const [expanded,setExpanded]=useState('');
  const [loading,setLoading]=useState(true);
  const [replyLoading,setReplyLoading]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [reload,setReload]=useState(0);

  useEffect(()=>{
    let alive=true;
    const load=async()=>{
      if(!authClient)return;
      setLoading(true);setError('');
      try{
        const {data,error:listError}=await authClient.rpc('list_study_questions',{p_circle_id:circleId});
        if(listError)throw listError;
        if(alive)setQuestions((data??[]) as Question[]);
      }catch(caught){if(alive)setError(errorText(caught))}
      finally{if(alive)setLoading(false)}
    };
    void load();
    return()=>{alive=false};
  },[circleId,reload]);

  const run=async(action:()=>Promise<void>)=>{
    setBusy(true);setError('');
    try{await action();setReload(value=>value+1)}
    catch(caught){setError(errorText(caught))}
    finally{setBusy(false)}
  };

  const addQuestion=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    const client=authClient;
    if(!client)return;
    const form=event.currentTarget;
    const data=new FormData(form);
    await run(async()=>{
      const {error:addError}=await client.rpc('add_study_question',{
        p_circle_id:circleId,p_title:String(data.get('title')??'').trim(),p_content:String(data.get('content')??'').trim(),p_part_id:null,
      });
      if(addError)throw addError;
      form.reset();
    });
  };

  const loadReplies=async(questionId:string,force=false)=>{
    if(replies[questionId]&&!force)return;
    setReplyLoading(questionId);setError('');
    try{
      if(!authClient)return;
      const {data,error:listError}=await authClient.rpc('list_study_question_replies',{p_question_id:questionId});
      if(listError)throw listError;
      setReplies(current=>({...current,[questionId]:(data??[]) as Reply[]}));
    }catch(caught){setError(errorText(caught))}
    finally{setReplyLoading('')}
  };

  const toggleReplies=(questionId:string)=>{
    if(expanded===questionId){setExpanded('');return}
    setExpanded(questionId);
    void loadReplies(questionId);
  };

  const addReply=async(event:FormEvent<HTMLFormElement>,questionId:string)=>{
    event.preventDefault();
    const client=authClient;
    if(!client)return;
    const form=event.currentTarget;
    const content=String(new FormData(form).get('content')??'').trim();
    await run(async()=>{
      const {error:replyError}=await client.rpc('reply_study_question',{p_question_id:questionId,p_content:content});
      if(replyError)throw replyError;
      form.reset();
      setExpanded(questionId);
      await loadReplies(questionId,true);
    });
  };

  const updateState=(question:Question,status:string,isPinned:boolean)=>run(async()=>{
    if(!authClient)return;
    const {error:updateError}=await authClient.rpc('set_study_question_state',{
      p_question_id:question.id,p_status:status,p_is_pinned:isPinned,
    });
    if(updateError)throw updateError;
  });

  return <div className="mudarasa-section">
    {error&&<p className="mudarasa-message error" role="alert">{error}</p>}
    {active&&<section className="panel"><h3>اطرح سؤالًا</h3><form className="mudarasa-form" onSubmit={event=>void addQuestion(event)}>
      <label>عنوان السؤال<input name="title" required minLength={3} maxLength={200}/></label>
      <label>السؤال<textarea name="content" required rows={3} maxLength={4000}/></label>
      <button className="primary" disabled={busy}><Plus size={16}/> نشر السؤال</button>
    </form></section>}
    {loading?<p role="status">جارٍ تحميل الأسئلة…</p>:questions.length===0?<section className="panel mudarasa-empty"><h3>لا أسئلة بعد</h3><p>تُعرض الأسئلة وردود الأعضاء والمعلمين هنا لأعضاء المدارسة فقط.</p></section>:
      <ul className="mudarasa-list">{questions.map(question=>{
        const questionReplies=replies[question.id]??[];
        const hasVerifiedReply=questionReplies.some(reply=>reply.teacher_verified);
        return <li key={question.id}><article className="panel mudarasa-item">
          <div className="mudarasa-question-heading">
            <div><span className={`mudarasa-status ${question.status==='open'?'paused':''}`}>{stateNames[question.status]??question.status}</span>{question.is_pinned&&<span className="mudarasa-question-pinned"><Pin size={14}/> مثبت</span>}<h3>{question.title}</h3></div>
            <p className="muted small">{question.asker_id===userId?'أنت':<bdi>{question.asker_id.slice(0,8)}</bdi>}</p>
          </div>
          <p className="mudarasa-copy">{question.content}</p>
          <div className="mudarasa-actions">
            <button className="soft-btn" onClick={()=>toggleReplies(question.id)}><MessageSquare size={15}/>{expanded===question.id?'إخفاء الردود':'الردود'} · {Number(question.reply_count)}</button>
            {isStaff&&<button className="soft-btn" disabled={busy} onClick={()=>void updateState(question,question.status, !question.is_pinned)}><Pin size={15}/>{question.is_pinned?'إلغاء التثبيت':'تثبيت'}</button>}
            {isStaff&&question.status!=='needs_review'&&<button className="soft-btn" disabled={busy} onClick={()=>void updateState(question,'needs_review',question.is_pinned)}>تحتاج مراجعة</button>}
            {isTeacher&&question.status!=='answered'&&<button className="primary" disabled={busy||!hasVerifiedReply} title={!hasVerifiedReply?'أضف ردًا بصفتك معلمًا معتمدًا أولًا':''} onClick={()=>void updateState(question,'answered',question.is_pinned)}><Check size={15}/> تمت الإجابة</button>}
            {isStaff&&question.status!=='open'&&<button className="soft-btn" disabled={busy} onClick={()=>void updateState(question,'open',question.is_pinned)}>إعادة فتح</button>}
          </div>
          {expanded===question.id&&<div className="mudarasa-question-replies">
            {replyLoading===question.id?<p role="status">جارٍ تحميل الردود…</p>:questionReplies.length===0?<p className="muted">لا ردود بعد.</p>:<ul className="mudarasa-parts">{questionReplies.map(reply=><li key={reply.id}><strong>{reply.author_id===userId?'أنت':<bdi>{reply.author_id.slice(0,8)}</bdi>}</strong>{reply.teacher_verified&&<span className="mudarasa-teacher-verified"> · معلم معتمد</span>}<p className="mudarasa-copy">{reply.content}</p></li>)}</ul>}
            {active&&<form className="mudarasa-inline-form" onSubmit={event=>void addReply(event,question.id)}><label>أضف ردًا<textarea name="content" required rows={2} maxLength={4000}/></label><button className="primary" disabled={busy}>إرسال الرد</button></form>}
          </div>}
        </article></li>;
      })}</ul>}
  </div>;
}
