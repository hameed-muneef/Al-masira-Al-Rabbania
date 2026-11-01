import {FormEvent,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {authClient} from '../auth';
import {initialCurriculum} from '../curriculum';
import {fetchPlatformCurriculum} from '../platform-curriculum';
import '../shares.css';

type ShareType='resource'|'activity_invitation'|'notification'|'recommendation';
type Profile={username:string;display_name:string;discoverable:boolean};
type Config={allowed_types:ShareType[];max_description_length:number;invitation_ttl_days:number;restricted:boolean};
type Member={username:string;display_name:string};
type Received={share_id:string;share_type:ShareType;sender_username:string|null;sender_name:string|null;ref_kind:string;ref_key:string;ref_title:string;template_key:string;description:string;share_status:string;expires_at:string|null;created_at:string;read_at:string|null;archived_at:string|null};
type Sent={share_id:string;share_type:ShareType;recipient_username:string|null;recipient_name:string|null;ref_kind:string;ref_key:string;ref_title:string;template_key:string;description:string;share_status:string;expires_at:string|null;created_at:string};
type Option={kind:'course'|'resource'|'unit';key:string;title:string};

const typeLabel:Record<ShareType,string>={resource:'مصدر',activity_invitation:'دعوة إلى نشاط',notification:'تنبيه مهم',recommendation:'توصية تعليمية'};
const typeHint:Record<ShareType,string>={resource:'كتاب أو مقال أو درس أو رابط مفيد',activity_invitation:'ادعُ عضوًا إلى مجلس علم قائم',notification:'رسالة جاهزة تخص نشاطًا تشاركانه',recommendation:'توصية بمحتوى داخل المنصة'};
const templates:Record<string,string>={session_reminder:'تذكير بموعد الجلسة',materials_ready:'المواد جاهزة للاطلاع',confirm_attendance:'يرجى تأكيد الحضور',schedule_changed:'تغيّر موعد النشاط'};
const statusLabel:Record<string,string>={sent:'بانتظار الرد',accepted:'قُبلت',declined:'اعتُذر عنها',expired:'انتهت صلاحيتها'};
const reasons:[string,string][]=[['spam','مزعجة'],['harassment','إساءة'],['inappropriate','غير لائقة'],['misinformation','معلومة مضللة'],['privacy','تمس الخصوصية'],['other','أخرى']];
const messageOf=(value:unknown)=>(value as {message?:string})?.message||'تعذّر تنفيذ العملية، حاول مرة أخرى.';
const dateOf=(value:string)=>new Date(value).toLocaleDateString('ar-EG',{day:'numeric',month:'long',year:'numeric'});

export default function SharesView({displayName}:{displayName:string}){
  const [tab,setTab]=useState<'inbox'|'sent'|'send'>('inbox');
  const [profile,setProfile]=useState<Profile|null|undefined>(undefined);
  const [config,setConfig]=useState<Config|null>(null);
  const [message,setMessage]=useState('');
  const [failed,setFailed]=useState(false);
  const say=useCallback((text:string,error=false)=>{setMessage(text);setFailed(error)},[]);

  const load=useCallback(async()=>{
    if(!authClient)return;
    const [p,c]=await Promise.all([authClient.rpc('get_my_share_profile'),authClient.rpc('get_share_config')]);
    if(p.error){say(messageOf(p.error),true);setProfile(null);return}
    setProfile((p.data as Profile[])?.[0]??null);
    setConfig(((c.data as Config[])?.[0])??null);
  },[say]);
  useEffect(()=>{void load()},[load]);

  if(profile===undefined)return <section className="panel shares" aria-busy="true"><p className="muted">جارٍ التحميل…</p></section>;
  return <div className="shares">
    <section className="panel shares-head">
      <h2>المشاركات</h2>
      <p className="muted">مشاركة محدودة للمصادر والدعوات والتنبيهات بين الأعضاء. لا توجد محادثات ولا ردود نصية.</p>
    </section>
    {message&&<p className={failed?'shares-note error':'shares-note'} role={failed?'alert':'status'}>{message}</p>}
    <ProfileCard profile={profile} defaultName={displayName} say={say} onSaved={load}/>
    {profile&&<>
      <div className="shares-tabs" role="tablist" aria-label="أقسام المشاركات">
        {([['inbox','الوارد'],['sent','الصادر'],['send','إرسال مشاركة']] as const).map(([key,label])=><button key={key} type="button" role="tab" aria-selected={tab===key} className={tab===key?'soft-btn selected':'soft-btn'} onClick={()=>setTab(key)}>{label}</button>)}
      </div>
      {tab==='inbox'&&<Inbox say={say}/>}
      {tab==='sent'&&<SentList say={say}/>}
      {tab==='send'&&<SendFlow config={config} say={say} onSent={()=>setTab('sent')}/>}
      <Blocks say={say}/>
    </>}
  </div>;
}

function ProfileCard({profile,defaultName,say,onSaved}:{profile:Profile|null;defaultName:string;say:(t:string,e?:boolean)=>void;onSaved:()=>Promise<void>}){
  const [username,setUsername]=useState(profile?.username??'');
  const [name,setName]=useState(profile?.display_name??defaultName);
  const [discoverable,setDiscoverable]=useState(profile?.discoverable??true);
  const [busy,setBusy]=useState(false);
  const [open,setOpen]=useState(!profile);
  const submit=async(event:FormEvent)=>{
    event.preventDefault();if(!authClient||busy)return;setBusy(true);
    try{
      const {error}=await authClient.rpc('save_my_share_profile',{p_username:username,p_display_name:name,p_discoverable:discoverable});
      if(error)throw error;
      say('حُفظ اسم المستخدم.');setOpen(false);await onSaved();
    }catch(error){say(messageOf(error),true)}finally{setBusy(false)}
  };
  if(profile&&!open)return <section className="panel shares-profile"><span>اسم المستخدم: <bdi dir="ltr">@{profile.username}</bdi> · {profile.discoverable?'يمكن للأعضاء العثور عليك':'مخفي من البحث'}</span><button type="button" className="soft-btn" onClick={()=>setOpen(true)}>تعديل</button></section>;
  return <form className="panel shares-form" onSubmit={submit}>
    <h3>{profile?'تعديل ملفك في المشاركات':'أنشئ اسم مستخدم للمشاركات'}</h3>
    <label>اسم المستخدم<input dir="ltr" value={username} onChange={event=>setUsername(event.target.value.toLowerCase())} minLength={3} maxLength={20} pattern="[a-z][a-z0-9_]{2,19}" required autoComplete="off"/></label>
    <small className="muted">من 3 إلى 20 حرفًا إنجليزيًا صغيرًا أو أرقامًا أو _، ويبدأ بحرف. لا يُعرض بريدك ولا هاتفك.</small>
    <label>الاسم الظاهر<input value={name} onChange={event=>setName(event.target.value)} maxLength={60} required/></label>
    <label className="shares-check"><input type="checkbox" checked={discoverable} onChange={event=>setDiscoverable(event.target.checked)}/>اسمح للأعضاء بالعثور عليّ عبر اسم المستخدم</label>
    <div className="shares-actions"><button className="primary-btn" disabled={busy}>{busy?'جارٍ الحفظ…':'حفظ'}</button>{profile&&<button type="button" className="soft-btn" onClick={()=>setOpen(false)}>إلغاء</button>}</div>
  </form>;
}

function Inbox({say}:{say:(t:string,e?:boolean)=>void}){
  const [rows,setRows]=useState<Received[]>([]);
  const [archived,setArchived]=useState(false);
  const [busy,setBusy]=useState('');
  const [reporting,setReporting]=useState<string|null>(null);
  const [reason,setReason]=useState('spam');
  const load=useCallback(async()=>{
    if(!authClient)return;
    const {data,error}=await authClient.rpc('list_received_shares',{p_archived:archived,p_limit:100});
    if(error){say(messageOf(error),true);return}
    setRows((data??[]) as Received[]);
  },[archived,say]);
  useEffect(()=>{void load()},[load]);
  const run=async(id:string,action:()=>PromiseLike<{error:unknown}>,ok:string)=>{
    if(busy)return;setBusy(id);
    try{const {error}=await action();if(error)throw error;say(ok);await load()}
    catch(error){say(messageOf(error),true)}finally{setBusy('')}
  };
  const open=(row:Received)=>{
    if(!row.read_at&&authClient)void authClient.rpc('mark_share_read',{p_share_id:row.share_id}).then(()=>load());
    if(row.ref_kind==='url'&&/^https?:\/\//i.test(row.ref_key))window.open(row.ref_key,'_blank','noopener,noreferrer');
  };
  return <section className="shares-list" aria-label="الوارد">
    <div className="shares-actions">
      <button type="button" className={!archived?'soft-btn selected':'soft-btn'} onClick={()=>setArchived(false)}>الوارد</button>
      <button type="button" className={archived?'soft-btn selected':'soft-btn'} onClick={()=>setArchived(true)}>المؤرشف</button>
      {!archived&&rows.some(row=>!row.read_at)&&<button type="button" className="soft-btn" onClick={()=>run('all',()=>authClient!.rpc('mark_all_shares_read'),'تم تحديد الكل كمقروء.')}>تحديد الكل كمقروء</button>}
    </div>
    {rows.length===0&&<p className="muted panel">لا توجد مشاركات.</p>}
    {rows.map(row=><article key={row.share_id} className={row.read_at?'panel share-card':'panel share-card unread'}>
      <header><span className="share-type">{typeLabel[row.share_type]}</span>{!row.read_at&&<b className="share-dot">جديد</b>}<time className="muted">{dateOf(row.created_at)}</time></header>
      <p className="share-from">من: <strong>{row.sender_name??'عضو'}</strong>{row.sender_username&&<bdi dir="ltr" className="muted"> @{row.sender_username}</bdi>}</p>
      <h4>{row.share_type==='notification'?templates[row.template_key]??'':''}{row.share_type==='notification'?' — ':''}{row.ref_kind==='url'?<span dir="ltr">{row.ref_title}</span>:row.ref_title}</h4>
      {row.description&&<p className="share-desc">{row.description}</p>}
      {row.share_type==='activity_invitation'&&<p className="muted small">{statusLabel[row.share_status]??row.share_status}{row.expires_at&&row.share_status==='sent'?` · حتى ${dateOf(row.expires_at)}`:''}</p>}
      <div className="shares-actions">
        {row.share_type==='activity_invitation'&&row.share_status==='sent'&&<>
          <button type="button" className="primary-btn" disabled={!!busy} onClick={()=>run(row.share_id,()=>authClient!.rpc('respond_share_invitation',{p_share_id:row.share_id,p_accept:true}),'قبلت الدعوة وسُجّلت في النشاط.')}>قبول</button>
          <button type="button" className="soft-btn" disabled={!!busy} onClick={()=>run(row.share_id,()=>authClient!.rpc('respond_share_invitation',{p_share_id:row.share_id,p_accept:false}),'اعتذرت عن الدعوة.')}>اعتذار</button>
        </>}
        {row.ref_kind==='url'&&<button type="button" className="soft-btn" onClick={()=>open(row)}>فتح الرابط</button>}
        {!row.read_at&&<button type="button" className="soft-btn" onClick={()=>open(row)}>تحديد كمقروء</button>}
        <button type="button" className="soft-btn" disabled={!!busy} onClick={()=>run(row.share_id,()=>authClient!.rpc('archive_share',{p_share_id:row.share_id,p_archived:!archived}),archived?'أُعيدت إلى الوارد.':'أُرشفت.')}>{archived?'إلغاء الأرشفة':'أرشفة'}</button>
        <button type="button" className="soft-btn" onClick={()=>setReporting(reporting===row.share_id?null:row.share_id)}>إبلاغ</button>
        <button type="button" className="soft-btn danger" disabled={!!busy} onClick={()=>{if(window.confirm('سيُمنع هذا العضو من مراسلتك. متابعة؟'))void run(row.share_id,()=>authClient!.rpc('block_share_sender',{p_share_id:row.share_id}),'تم حظر المرسل.')}}>حظر المرسل</button>
      </div>
      {reporting===row.share_id&&<div className="shares-report">
        <label>سبب الإبلاغ<select value={reason} onChange={event=>setReason(event.target.value)}>{reasons.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
        <button type="button" className="primary-btn" disabled={!!busy} onClick={()=>run(row.share_id,()=>authClient!.rpc('report_share',{p_share_id:row.share_id,p_reason:reason,p_details:''}),'وصل بلاغك إلى الإدارة.').then(()=>setReporting(null))}>إرسال البلاغ</button>
      </div>}
    </article>)}
  </section>;
}

function SentList({say}:{say:(t:string,e?:boolean)=>void}){
  const [rows,setRows]=useState<Sent[]>([]);
  const load=useCallback(async()=>{
    if(!authClient)return;
    const {data,error}=await authClient.rpc('list_sent_shares',{p_limit:100});
    if(error){say(messageOf(error),true);return}
    setRows((data??[]) as Sent[]);
  },[say]);
  useEffect(()=>{void load()},[load]);
  const hide=async(id:string)=>{
    if(!authClient)return;
    const {error}=await authClient.rpc('hide_sent_share',{p_share_id:id});
    if(error){say(messageOf(error),true);return}
    say('أُزيلت من سجلك الصادر، ولا تتأثر نسخة المستلم.');await load();
  };
  return <section className="shares-list" aria-label="الصادر">
    {rows.length===0&&<p className="muted panel">لم ترسل مشاركات بعد.</p>}
    {rows.map(row=><article key={row.share_id} className="panel share-card">
      <header><span className="share-type">{typeLabel[row.share_type]}</span><time className="muted">{dateOf(row.created_at)}</time></header>
      <p className="share-from">إلى: <strong>{row.recipient_name??'عضو'}</strong>{row.recipient_username&&<bdi dir="ltr" className="muted"> @{row.recipient_username}</bdi>}</p>
      <h4>{row.share_type==='notification'?`${templates[row.template_key]??''} — `:''}{row.ref_kind==='url'?<span dir="ltr">{row.ref_title}</span>:row.ref_title}</h4>
      {row.description&&<p className="share-desc">{row.description}</p>}
      {row.share_type==='activity_invitation'&&<p className="muted small">{statusLabel[row.share_status]??row.share_status}</p>}
      <div className="shares-actions"><button type="button" className="soft-btn" onClick={()=>void hide(row.share_id)}>إزالة من سجلي</button></div>
    </article>)}
  </section>;
}

function SendFlow({config,say,onSent}:{config:Config|null;say:(t:string,e?:boolean)=>void;onSent:()=>void}){
  const allowed=config?.allowed_types??[];
  const maxLen=config?.max_description_length??280;
  const [step,setStep]=useState(1);
  const [type,setType]=useState<ShareType|''>('');
  const [query,setQuery]=useState('');
  const [found,setFound]=useState<Member[]>([]);
  const [recipient,setRecipient]=useState<Member|null>(null);
  const [options,setOptions]=useState<Option[]>([]);
  const [optionKey,setOptionKey]=useState('');
  const [url,setUrl]=useState('');
  const [refMode,setRefMode]=useState<'internal'|'url'>('internal');
  const [template,setTemplate]=useState('session_reminder');
  const [description,setDescription]=useState('');
  const [busy,setBusy]=useState(false);
  const requestKey=useRef(crypto.randomUUID());

  useEffect(()=>{
    if(!authClient||step<3)return;
    let alive=true;
    (async()=>{
      const list:Option[]=[];
      if(type==='activity_invitation'||type==='notification'||type==='resource'||type==='recommendation'){
        const {data}=await authClient!.from('courses').select('id,title').eq('status','published').order('starts_at',{ascending:true}).limit(100);
        for(const row of (data??[]) as {id:string;title:string}[])list.push({kind:'course',key:row.id,title:row.title});
      }
      if(type==='resource'||type==='recommendation'){
        let curriculum=null;
        try{curriculum=await fetchPlatformCurriculum()}catch{curriculum=null}
        for(const unit of (curriculum??initialCurriculum()).units.filter(item=>item.status==='published')){
          if(type==='recommendation')list.push({kind:'unit',key:unit.id,title:`مسار: ${unit.title}`});
          for(const resource of unit.resources)list.push({kind:'resource',key:resource.id,title:resource.title});
        }
      }
      if(alive)setOptions(list);
    })();
    return ()=>{alive=false};
  },[step,type]);

  const search=async(event:FormEvent)=>{
    event.preventDefault();if(!authClient||busy)return;setBusy(true);
    try{
      const {data,error}=await authClient.rpc('search_share_members',{p_query:query});
      if(error)throw error;
      setFound((data??[]) as Member[]);
      if(!(data as Member[])?.length)say('لا نتائج. اكتب اسم المستخدم كاملًا أو أوله (3 أحرف على الأقل).',true);else say('');
    }catch(error){say(messageOf(error),true)}finally{setBusy(false)}
  };
  const current=useMemo(()=>options.find(option=>option.key===optionKey),[options,optionKey]);
  const refKind=type==='resource'&&refMode==='url'?'url':current?.kind??'course';
  const refKey=refKind==='url'?url.trim():optionKey;
  const refReady=type==='notification'||refKind==='url'?!!refKey:!!current;
  const needsDescription=type!=='notification';
  const refTitle=refKind==='url'?url.trim():current?.title??'';

  const confirm=async()=>{
    if(!authClient||busy||!recipient||!type)return;setBusy(true);
    try{
      const {error}=await authClient.rpc('send_member_share',{p_request_key:requestKey.current,p_recipient_username:recipient.username,p_type:type,p_ref_kind:refKind,p_ref_key:refKey,p_description:needsDescription?description.trim():'',p_template_key:type==='notification'?template:'',p_title_hint:current?.title??''});
      if(error)throw error;
      say('أُرسلت المشاركة.');requestKey.current=crypto.randomUUID();
      setStep(1);setType('');setRecipient(null);setFound([]);setQuery('');setOptionKey('');setUrl('');setDescription('');onSent();
    }catch(error){say(messageOf(error),true)}finally{setBusy(false)}
  };

  if(config?.restricted)return <section className="panel"><p className="shares-note error">الإرسال متوقف مؤقتًا لحسابك. تواصل مع الإدارة إن كان ذلك خطأ.</p></section>;
  return <section className="panel shares-form" aria-label="إرسال مشاركة">
    <ol className="shares-steps" aria-label="الخطوات">{['النوع','المستلم','التفاصيل','المراجعة'].map((label,index)=><li key={label} className={step===index+1?'current':step>index+1?'done':''}>{label}</li>)}</ol>
    {step===1&&<div className="shares-types">
      {(['resource','activity_invitation','notification','recommendation'] as ShareType[]).map(key=><button key={key} type="button" disabled={!allowed.includes(key)} className={type===key?'share-type-btn selected':'share-type-btn'} onClick={()=>{setType(key);setOptionKey('');setStep(2)}}><strong>{typeLabel[key]}</strong><small>{allowed.includes(key)?typeHint[key]:'غير متاح حاليًا'}</small></button>)}
    </div>}
    {step===2&&<div>
      <form className="shares-search" onSubmit={search}>
        <label>اسم مستخدم المستلم<input dir="ltr" value={query} onChange={event=>setQuery(event.target.value.toLowerCase())} minLength={3} maxLength={20} placeholder="username" autoComplete="off" required/></label>
        <button className="soft-btn" disabled={busy}>بحث</button>
      </form>
      <ul className="shares-results">{found.map(member=><li key={member.username}><button type="button" className={recipient?.username===member.username?'soft-btn selected':'soft-btn'} onClick={()=>setRecipient(member)}>{member.display_name} <bdi dir="ltr">@{member.username}</bdi></button></li>)}</ul>
      <div className="shares-actions"><button type="button" className="soft-btn" onClick={()=>setStep(1)}>السابق</button><button type="button" className="primary-btn" disabled={!recipient} onClick={()=>setStep(3)}>التالي</button></div>
    </div>}
    {step===3&&type&&<div>
      {type==='resource'&&<div className="shares-actions"><button type="button" className={refMode==='internal'?'soft-btn selected':'soft-btn'} onClick={()=>setRefMode('internal')}>من المنصة</button><button type="button" className={refMode==='url'?'soft-btn selected':'soft-btn'} onClick={()=>setRefMode('url')}>رابط خارجي</button></div>}
      {refKind==='url'
        ?<label>الرابط (http أو https فقط)<input dir="ltr" type="url" value={url} onChange={event=>setUrl(event.target.value)} maxLength={500} placeholder="https://" required/></label>
        :<label>{type==='activity_invitation'||type==='notification'?'النشاط':'المحتوى'}<select value={optionKey} onChange={event=>setOptionKey(event.target.value)} required><option value="">اختر…</option>{options.filter(option=>type==='activity_invitation'||type==='notification'?option.kind==='course':true).map(option=><option key={`${option.kind}:${option.key}`} value={option.key}>{option.title}</option>)}</select></label>}
      {type==='notification'&&<label>نص التنبيه<select value={template} onChange={event=>setTemplate(event.target.value)}>{Object.entries(templates).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>}
      {needsDescription&&<label>وصف قصير (اختياري)<textarea value={description} onChange={event=>setDescription(event.target.value)} maxLength={maxLen} rows={3}/><small className="muted">{description.length}/{maxLen} — بدون روابط</small></label>}
      <div className="shares-actions"><button type="button" className="soft-btn" onClick={()=>setStep(2)}>السابق</button><button type="button" className="primary-btn" disabled={!refReady} onClick={()=>setStep(4)}>مراجعة</button></div>
    </div>}
    {step===4&&type&&recipient&&<div>
      <dl className="shares-review">
        <dt>النوع</dt><dd>{typeLabel[type]}</dd>
        <dt>إلى</dt><dd>{recipient.display_name} <bdi dir="ltr">@{recipient.username}</bdi></dd>
        <dt>المحتوى</dt><dd>{type==='notification'?`${templates[template]} — `:''}{refTitle}</dd>
        {needsDescription&&description.trim()&&<><dt>الوصف</dt><dd>{description.trim()}</dd></>}
      </dl>
      <p className="muted small">لن يتمكن المستلم من الرد نصيًا، وسيتلقى إشعارًا فقط.</p>
      <div className="shares-actions"><button type="button" className="soft-btn" disabled={busy} onClick={()=>setStep(3)}>تعديل</button><button type="button" className="primary-btn" disabled={busy} onClick={()=>void confirm()}>{busy?'جارٍ الإرسال…':'تأكيد الإرسال'}</button></div>
    </div>}
  </section>;
}

function Blocks({say}:{say:(t:string,e?:boolean)=>void}){
  const [rows,setRows]=useState<{username:string;display_name:string}[]>([]);
  const load=useCallback(async()=>{
    if(!authClient)return;
    const {data}=await authClient.rpc('list_my_blocks');
    setRows((data??[]) as {username:string;display_name:string}[]);
  },[]);
  useEffect(()=>{void load()},[load]);
  if(!rows.length)return null;
  return <details className="panel shares-blocks"><summary>الأعضاء المحظورون ({rows.length})</summary>
    <ul>{rows.map(row=><li key={row.username}>{row.display_name} <bdi dir="ltr">@{row.username}</bdi><button type="button" className="soft-btn" onClick={async()=>{const {error}=await authClient!.rpc('unblock_member',{p_username:row.username});if(error)say(messageOf(error),true);else{say('أُلغي الحظر.');await load()}}}>إلغاء الحظر</button></li>)}</ul>
  </details>;
}
