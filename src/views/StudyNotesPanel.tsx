import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {Check,Plus,ThumbsUp,Trash2} from 'lucide-react';
import {authClient} from '../auth';

type Note={id:string;author_id:string;note_type:string;title:string;content:string;page_start:number|null;page_end:number|null;source_ref:string;helpful_count:number|string;created_at:string};
type Comment={id:string;note_id:string;author_id:string;content:string;created_at:string};

const noteTypes:Record<string,string>={scientific:'فائدة علمية',reflection:'تأمل',question:'سؤال',practical:'تطبيق عملي',quote:'اقتباس',personal:'ملاحظة شخصية'};

function errorText(error:unknown){
  if(error instanceof Error)return error.message;
  if(typeof error==='object'&&error!==null&&'message' in error&&typeof error.message==='string')return error.message;
  return 'حدث خطأ. حاول مرة أخرى.';
}

export default function StudyNotesPanel({circleId,userId,active}:{circleId:string;userId:string;active:boolean}){
  const [notes,setNotes]=useState<Note[]>([]);
  const [comments,setComments]=useState<Comment[]>([]);
  const [mine,setMine]=useState<Set<string>>(new Set());
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [reload,setReload]=useState(0);

  useEffect(()=>{
    let alive=true;
    const load=async()=>{
      if(!authClient)return;
      setLoading(true);setError('');
      try{
        const [noteResult,commentResult,reactionResult]=await Promise.all([
          authClient.rpc('list_study_notes',{p_circle_id:circleId}),
          authClient.from('study_note_comments').select('id,note_id,author_id,content,created_at').eq('circle_id',circleId).order('created_at'),
          authClient.from('study_note_reactions').select('note_id').eq('user_id',userId).eq('is_helpful',true),
        ]);
        for(const result of [noteResult,commentResult,reactionResult])if(result.error)throw result.error;
        if(!alive)return;
        setNotes(((noteResult.data??[]) as Note[]).slice().sort((a,b)=>b.created_at.localeCompare(a.created_at)));
        setComments((commentResult.data??[]) as Comment[]);
        setMine(new Set((reactionResult.data??[]).map((row:{note_id:string})=>row.note_id)));
      }catch(caught){if(alive)setError(errorText(caught))}
      finally{if(alive)setLoading(false)}
    };
    void load();
    return()=>{alive=false};
  },[circleId,userId,reload]);

  const run=useCallback(async(action:()=>Promise<void>)=>{
    setBusy(true);setError('');
    try{await action();setReload(value=>value+1)}
    catch(caught){setError(errorText(caught))}
    finally{setBusy(false)}
  },[]);

  const addNote=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    const client=authClient;
    if(!client)return;
    const form=event.currentTarget;
    const data=new FormData(form);
    await run(async()=>{
      const {error:addError}=await client.rpc('add_study_note',{
        p_circle_id:circleId,p_note_type:String(data.get('type')),p_title:String(data.get('title')??''),p_content:String(data.get('content')??'').trim(),
        p_part_id:null,p_page_start:data.get('pageStart')?Number(data.get('pageStart')):null,p_page_end:data.get('pageEnd')?Number(data.get('pageEnd')):null,
        p_source_ref:String(data.get('source')??''),
      });
      if(addError)throw addError;
      form.reset();
    });
  };

  const toggleHelpful=(noteId:string)=>run(async()=>{
    if(!authClient)return;
    const {error:toggleError}=await authClient.rpc('toggle_study_note_helpful',{p_note_id:noteId,p_is_helpful:!mine.has(noteId)});
    if(toggleError)throw toggleError;
  });

  const removeNote=(noteId:string)=>run(async()=>{
    if(!authClient)return;
    const {error:deleteError}=await authClient.rpc('delete_study_note',{p_note_id:noteId});
    if(deleteError)throw deleteError;
  });

  const addComment=async(event:FormEvent<HTMLFormElement>,noteId:string)=>{
    event.preventDefault();
    const client=authClient;
    if(!client)return;
    const form=event.currentTarget;
    const content=String(new FormData(form).get('content')??'').trim();
    if(!content)return;
    await run(async()=>{
      const {error:commentError}=await client.rpc('add_study_note_comment',{p_note_id:noteId,p_content:content});
      if(commentError)throw commentError;
      form.reset();
    });
  };

  return <div className="mudarasa-section">
    {error&&<p className="mudarasa-message error" role="alert">{error}</p>}
    {active&&<section className="panel"><h3>شارك فائدة</h3><form className="mudarasa-form" onSubmit={event=>void addNote(event)}>
      <div className="mudarasa-form-grid"><label>النوع<select name="type" defaultValue="scientific">{Object.entries(noteTypes).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>العنوان<input name="title" maxLength={200} placeholder="اختياري"/></label><label>من صفحة<input name="pageStart" type="number" min="1" max="10000"/></label><label>إلى صفحة<input name="pageEnd" type="number" min="1" max="10000"/></label></div>
      <label>المصدر<input name="source" maxLength={200} placeholder="اسم الكتاب أو الدرس (اختياري)"/></label>
      <label>الفائدة<textarea name="content" required rows={3} maxLength={4000}/></label>
      <button className="primary" disabled={busy}><Plus size={16}/> نشر الفائدة</button>
    </form></section>}
    {loading?<p role="status">جارٍ تحميل الفوائد…</p>:notes.length===0?<section className="panel mudarasa-empty"><h3>لا فوائد بعد</h3><p>تظهر هنا فوائد الأعضاء وتأملاتهم وأسئلتهم، ولا يراها غير أعضاء المدارسة.</p></section>:
    <ul className="mudarasa-list">{notes.map(note=>{
      const noteComments=comments.filter(comment=>comment.note_id===note.id);
      const liked=mine.has(note.id);
      return <li key={note.id}><article className="panel mudarasa-item">
        <div><span className="eyebrow">{noteTypes[note.note_type]??note.note_type}</span>{note.title&&<h3>{note.title}</h3>}<p className="mudarasa-copy">{note.content}</p>
          <p className="muted small">{note.author_id===userId?'أنت':<bdi>{note.author_id.slice(0,8)}</bdi>}{note.source_ref&&` · ${note.source_ref}`}{note.page_start&&` · ص ${note.page_start}${note.page_end?`–${note.page_end}`:''}`}</p></div>
        <div className="mudarasa-actions"><button className={liked?'primary':'soft-btn'} disabled={busy} aria-pressed={liked} onClick={()=>void toggleHelpful(note.id)}>{liked?<Check size={15}/>:<ThumbsUp size={15}/>} فائدة نافعة · {Number(note.helpful_count)}</button>{note.author_id===userId&&<button className="soft-btn" disabled={busy} onClick={()=>void removeNote(note.id)}><Trash2 size={15}/> حذف</button>}</div>
        {noteComments.length>0&&<ul className="mudarasa-parts">{noteComments.map(comment=><li key={comment.id}><strong>{comment.author_id===userId?'أنت':comment.author_id.slice(0,8)}:</strong> {comment.content}</li>)}</ul>}
        {active&&<form className="mudarasa-inline-form" onSubmit={event=>void addComment(event,note.id)}><label>تعليق<input name="content" required maxLength={2000}/></label><button className="soft-btn" disabled={busy}>إرسال</button></form>}
      </article></li>;
    })}</ul>}
  </div>;
}
