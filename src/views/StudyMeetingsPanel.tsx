import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {CalendarDays,Check,Plus,Video,X} from 'lucide-react';
import {authClient} from '../auth';

type Meeting={id:string;title:string;agenda:string;starts_at:string;ends_at:string;status:string;summary:string;pending_points:string;has_meeting_link:boolean;my_attendance:string|null;present_count:number|string};
type Attendance={user_id:string;status:string};

const statusNames:Record<string,string>={scheduled:'مجدول',cancelled:'ملغى',completed:'منتهٍ'};
const attendanceNames:Record<string,string>={present:'حاضر',absent:'غائب',excused:'معذور'};
const dateFormat=new Intl.DateTimeFormat('ar',{dateStyle:'full',timeStyle:'short'});

function errorText(error:unknown){
  if(error instanceof Error)return error.message;
  if(typeof error==='object'&&error!==null&&'message' in error&&typeof error.message==='string')return error.message;
  return 'حدث خطأ. حاول مرة أخرى.';
}

export default function StudyMeetingsPanel({circleId,userId,active,isStaff,memberIds}:{circleId:string;userId:string;active:boolean;isStaff:boolean;memberIds:string[]}){
  const [meetings,setMeetings]=useState<Meeting[]>([]);
  const [attendance,setAttendance]=useState<Record<string,Attendance[]>>({});
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [reload,setReload]=useState(0);
  const [openId,setOpenId]=useState('');

  useEffect(()=>{
    let alive=true;
    const load=async()=>{
      if(!authClient)return;
      setLoading(true);setError('');
      try{
        const {data,error:listError}=await authClient.rpc('list_study_meetings',{p_circle_id:circleId});
        if(listError)throw listError;
        const rows=(data??[]) as Meeting[];
        const marks:Record<string,Attendance[]>={};
        if(isStaff)await Promise.all(rows.map(async meeting=>{
          const {data:marked,error:markError}=await authClient!.rpc('list_study_meeting_attendance',{p_meeting_id:meeting.id});
          if(markError)throw markError;
          marks[meeting.id]=(marked??[]) as Attendance[];
        }));
        if(alive){setMeetings(rows);setAttendance(marks)}
      }catch(caught){if(alive)setError(errorText(caught))}
      finally{if(alive)setLoading(false)}
    };
    void load();
    return()=>{alive=false};
  },[circleId,isStaff,reload]);

  const run=useCallback(async(action:()=>Promise<void>)=>{
    setBusy(true);setError('');
    try{await action();setReload(value=>value+1)}
    catch(caught){setError(errorText(caught))}
    finally{setBusy(false)}
  },[]);

  const schedule=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    const client=authClient;
    if(!client)return;
    const form=event.currentTarget;
    const data=new FormData(form);
    await run(async()=>{
      const {error:scheduleError}=await client.rpc('schedule_study_meeting',{
        p_circle_id:circleId,p_title:String(data.get('title')),p_starts_at:new Date(String(data.get('start'))).toISOString(),
        p_ends_at:new Date(String(data.get('end'))).toISOString(),p_meeting_url:String(data.get('url')).trim(),p_agenda:String(data.get('agenda')??''),
      });
      if(scheduleError)throw scheduleError;
      form.reset();
    });
  };

  const join=async(meetingId:string)=>{
    if(!authClient)return;
    setError('');
    const {data,error:revealError}=await authClient.rpc('reveal_study_meeting_url',{p_meeting_id:meetingId});
    if(revealError){setError(errorText(revealError));return}
    window.open(String(data),'_blank','noopener,noreferrer');
  };

  const cancel=(meetingId:string)=>run(async()=>{
    if(!authClient)return;
    const {error:cancelError}=await authClient.rpc('cancel_study_meeting',{p_meeting_id:meetingId});
    if(cancelError)throw cancelError;
  });

  const mark=(meetingId:string,memberId:string,status:string)=>run(async()=>{
    if(!authClient)return;
    const {error:markError}=await authClient.rpc('mark_study_attendance',{p_meeting_id:meetingId,p_user_id:memberId,p_status:status});
    if(markError)throw markError;
  });

  const saveSummary=async(event:FormEvent<HTMLFormElement>,meetingId:string)=>{
    event.preventDefault();
    const client=authClient;
    if(!client)return;
    const data=new FormData(event.currentTarget);
    await run(async()=>{
      const {error:summaryError}=await client.rpc('save_study_meeting_summary',{p_meeting_id:meetingId,p_summary:String(data.get('summary')),p_pending_points:String(data.get('pending')??'')});
      if(summaryError)throw summaryError;
      setOpenId('');
    });
  };

  return <div className="mudarasa-section">
    {error&&<p className="mudarasa-message error" role="alert">{error}</p>}
    {isStaff&&active&&<section className="panel"><h3>جدولة اجتماع</h3>
      <p className="muted small">أنشئ اجتماعًا في Google Meet، ثم انسخ رابطه والصقه هنا. لا يظهر الرابط إلا لأعضاء المدارسة عند الضغط على «دخول الاجتماع».</p>
      <a className="soft-btn" href="https://meet.new" target="_blank" rel="noopener noreferrer">إنشاء اجتماع في Google Meet ↗</a>
      <form className="mudarasa-form" onSubmit={event=>void schedule(event)}>
        <div className="mudarasa-form-grid"><label>عنوان الاجتماع<input name="title" required minLength={3} maxLength={160}/></label><label>رابط Google Meet<input name="url" type="url" required placeholder="https://meet.google.com/abc-defg-hij" dir="ltr"/></label><label>البداية<input name="start" type="datetime-local" required/></label><label>النهاية<input name="end" type="datetime-local" required/></label></div>
        <label>جدول الأعمال<textarea name="agenda" rows={2} maxLength={2000}/></label>
        <button className="primary" disabled={busy}><Plus size={16}/> جدولة الاجتماع</button>
      </form></section>}
    {loading?<p role="status">جارٍ تحميل الاجتماعات…</p>:meetings.length===0?<section className="panel mudarasa-empty"><h3>لا اجتماعات بعد</h3><p>{isStaff?'جدول أول اجتماع ليصل إشعاره إلى الأعضاء.':'سيصلك إشعار عند جدولة اجتماع.'}</p></section>:
    <ul className="mudarasa-list">{meetings.map(meeting=>{
      const marks=attendance[meeting.id]??[];
      return <li key={meeting.id}><article className="panel mudarasa-item">
        <div><span className={`mudarasa-status ${meeting.status==='scheduled'?'':'paused'}`}>{statusNames[meeting.status]??meeting.status}</span><h3>{meeting.title}</h3>
          <p className="muted small"><CalendarDays size={14}/> {dateFormat.format(new Date(meeting.starts_at))}</p>
          {meeting.agenda&&<p className="mudarasa-copy">{meeting.agenda}</p>}
          {meeting.my_attendance&&<p className="muted small">حضورك: {attendanceNames[meeting.my_attendance]??meeting.my_attendance}</p>}
          {meeting.status==='completed'&&<p className="muted small">الحاضرون: {Number(meeting.present_count)}</p>}</div>
        {meeting.status==='scheduled'&&<div className="mudarasa-actions">{meeting.has_meeting_link&&active&&<button className="primary" onClick={()=>void join(meeting.id)}><Video size={15}/> دخول الاجتماع</button>}{isStaff&&<button className="soft-btn" disabled={busy} onClick={()=>void cancel(meeting.id)}><X size={15}/> إلغاء</button>}</div>}
        {meeting.summary&&<div className="mudarasa-copy"><strong>الملخص:</strong><p>{meeting.summary}</p>{meeting.pending_points&&<><strong>نقاط معلقة:</strong><p>{meeting.pending_points}</p></>}</div>}
        {isStaff&&meeting.status!=='cancelled'&&<>
          <button className="soft-btn" onClick={()=>setOpenId(openId===meeting.id?'':meeting.id)}>{openId===meeting.id?'إخفاء الحضور والملخص':'الحضور والملخص'}</button>
          {openId===meeting.id&&<>
            <ul className="mudarasa-members">{memberIds.map(memberId=>{const state=marks.find(mark=>mark.user_id===memberId)?.status;return <li key={memberId}><span>{memberId===userId?'أنت':<bdi>{memberId.slice(0,8)}</bdi>}</span><span className="mudarasa-actions">{Object.entries(attendanceNames).map(([value,label])=><button key={value} className={state===value?'primary':'soft-btn'} disabled={busy} onClick={()=>void mark(meeting.id,memberId,value)}>{state===value&&<Check size={14}/>}{label}</button>)}</span></li>})}</ul>
            <form className="mudarasa-form" onSubmit={event=>void saveSummary(event,meeting.id)}><label>ملخص الاجتماع<textarea name="summary" required rows={3} maxLength={6000} defaultValue={meeting.summary}/></label><label>نقاط معلقة<textarea name="pending" rows={2} maxLength={3000} defaultValue={meeting.pending_points}/></label><button className="primary" disabled={busy}>حفظ الملخص وإخطار الأعضاء</button></form>
          </>}
        </>}
      </article></li>;
    })}</ul>}
  </div>;
}
