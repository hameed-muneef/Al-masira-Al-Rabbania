import {useCallback,useEffect,useState} from 'react';
import {CalendarDays,Lock,Plus,Pencil,RefreshCw,Users,Link2,Megaphone} from 'lucide-react';
import {authClient} from '../auth';
import '../circles.css';
import CircleProgram from './CircleProgram';
import TawasiMentorshipPanel from './TawasiMentorshipPanel';
import {TawasiHistoryPanel,TawasiInvitesPanel} from './TawasiHubPanels';

// حلقات التواصي الخاص: المصدر ترحيلات TAW-001/002 في Supabase عبر RLS ووظائف خادم محدودة.
// لا دليل عام ولا ظهور لغير الأعضاء؛ كل الاستعلامات بشأن حلقات المستخدم فقط.
export type Circle={id:string;name:string;description:string;goal:string;kind:string;status:'active'|'closed';member_limit:number;starts_on:string|null;ends_on:string|null;participation_rules:string};
type MembershipRow={role:'founder'|'manager'|'assistant'|'member';joined_at:string;study_group:Circle|null};
type Draft={name:string;kind:string;memberLimit:string;startsOn:string;endsOn:string;goal:string;description:string;rules:string};
type StatusFlag='loading'|'ready'|'error'|'denied';
type CirclesMode='tawasi'|'science';
type InviteRow={invite_id:string;invite_status:'active'|'revoked';invite_expires_at:string;invite_max_uses:number;invite_uses_count:number};
type JoinRequest={id:string;user_id:string;requested_at:string;status:'pending'|'accepted'|'rejected'};
type MemberRow={user_id:string;role:'founder'|'manager'|'assistant'|'member';joined_at:string};

const kindOptions:[string,string][]=[
  ['friends','رفقة وتواصل'],['book','كتاب ومدارسة'],['quran','قرآن وتحفيظ'],
  ['mentoring','مساندة وإرشاد'],['course','دورة معلّم'],['program','برنامج مشترك'],
];
const kindLabel=(kind:string)=>kindOptions.find(entry=>entry[0]===kind)?.[1]??kind;
const emptyDraft:Draft={name:'',kind:'',memberLimit:'12',startsOn:'',endsOn:'',goal:'',description:'',rules:''};
const messageOf=(value:unknown)=>value instanceof Error&&value.message?value.message:'تعذّر تنفيذ العملية، حاول مرة أخرى.';
const isMissingGroupsSchema=(value:unknown)=>{
  if(!value||typeof value!=='object')return false;
  const error=value as {code?:string;message?:string};
  return error.code==='42P01'||error.code==='PGRST205'||(error.code==='PGRST200'&&/study_groups|group_members/i.test(error.message??''));
};
// A new session starts from what the circle already says, so nothing is typed twice.
const sessionDefaults=(circle:{goal:string;starts_on:string|null})=>({title:'',startsAt:circle.starts_on?`T20:00`:'',endsAt:circle.starts_on?`T21:00`:'',meetingUrl:'',notes:'',agenda:circle.goal,discussionPoints:''});
const draftOf=(circle:Circle):Draft=>({name:circle.name,kind:circle.kind,memberLimit:String(circle.member_limit),startsOn:circle.starts_on??'',endsOn:circle.ends_on??'',goal:circle.goal,description:circle.description,rules:circle.participation_rules});
const countLabel=(value:number)=>value.toLocaleString('ar-EG');
const dateLabel=(value:string)=>new Intl.DateTimeFormat('ar-EG',{day:'numeric',month:'long',year:'numeric',calendar:'gregory'}).format(new Date(`${value}T12:00:00`));
const roleLabel=(role:MemberRow['role'])=>({founder:'المؤسس',manager:'مسؤول',assistant:'مساعد',member:'عضو'})[role];

export default function CirclesView({user,mode='tawasi',admin=false,embedded=false}:{user:{id:string}|null;mode?:CirclesMode;admin?:boolean;embedded?:boolean}){
  const [rows,setRows]=useState<MembershipRow[]|null>(null);
  const [status,setStatus]=useState<StatusFlag>(authClient?'loading':'ready');
  const [loadError,setLoadError]=useState('');
  const [notice,setNotice]=useState('');
  const [noticeIsError,setNoticeIsError]=useState(false);
  const [busy,setBusy]=useState(false);
  const [formOpen,setFormOpen]=useState(false);
  const [editingId,setEditingId]=useState<string|null>(null);
  const [draft,setDraft]=useState<Draft>(emptyDraft);
  const [confirmClose,setConfirmClose]=useState<string|null>(null);
  const [inviteGroup,setInviteGroup]=useState<string|null>(null);
  const [invites,setInvites]=useState<InviteRow[]>([]);
  const [newInviteUrl,setNewInviteUrl]=useState('');
  const [requestGroup,setRequestGroup]=useState<string|null>(null);
  const [joinRequests,setJoinRequests]=useState<JoinRequest[]>([]);
  const [rosterGroup,setRosterGroup]=useState<string|null>(null);
  const [sessionGroup,setSessionGroup]=useState<string|null>(null);
  const [circleSessions,setCircleSessions]=useState<any[]>([]);
  const [sessionsLoading,setSessionsLoading]=useState(false);
  const [meetingAccess,setMeetingAccess]=useState<boolean|null>(null);
  const [meetingAccessError,setMeetingAccessError]=useState('');
  const [revealedMeeting,setRevealedMeeting]=useState<{id:string;url:string}|null>(null);
  const [recurring,setRecurring]=useState(false);
  const [tab,setTab]=useState<'mine'|'invites'|'mentor'|'history'>('mine');
  const [firstSession,setFirstSession]=useState({startsAt:'',endsAt:'',meetingUrl:''});
  const [sessionForm,setSessionForm]=useState({title:'',startsAt:'',endsAt:'',meetingUrl:'',notes:'',agenda:'',discussionPoints:''});
  const [announcementGroup,setAnnouncementGroup]=useState<string|null>(null);
  const [announcements,setAnnouncements]=useState<any[]>([]);
  const [announcementForm,setAnnouncementForm]=useState({title:'',body:''});
  const [reportingCircle,setReportingCircle]=useState<string|null>(null);
  const [reportReason,setReportReason]=useState('other');
  const [reportDetails,setReportDetails]=useState('');
  const [roster,setRoster]=useState<MemberRow[]>([]);
  const [confirmMemberAction,setConfirmMemberAction]=useState<string|null>(null);
  const set=(patch:Partial<Draft>)=>setDraft(current=>({...current,...patch}));
  const say=(text:string,isError=false)=>{setNotice(text);setNoticeIsError(isError)};

  const load=useCallback(async()=>{
    if(!authClient||!user)return;
    setStatus('loading');setLoadError('');
    try{
      if(mode==='science'&&!admin){
        const {data:allowed,error:accessError}=await authClient.rpc('has_feature_access' as any,{p_feature_key:'private_circles'});
        if(accessError)throw accessError;
        if(!allowed){setRows([]);setStatus('denied');return}
      }
      const {data,error}=await authClient.from('group_members')
        .select('role,joined_at,study_group:study_groups(*)').eq('user_id',user.id).order('joined_at');
      if(error)throw error;
      setRows((data??[])as unknown as MembershipRow[]);setStatus('ready');
    }catch(error){setStatus('error');setLoadError(isMissingGroupsSchema(error)
      ?'جداول التواصي غير متاحة في قاعدة البيانات المتصلة بهذا التطبيق. تحقّق من إعدادات الاتصال ثم أعد المحاولة.'
      :messageOf(error))}
  },[user?.id,mode,admin]);
  useEffect(()=>{
    if(!authClient||!user){setStatus('ready');setRows([])}
    else void load();
  },[load,!!user,!!authClient]);

  const refreshMeetingAccess=useCallback(async()=>{
    if(!authClient||!user)return;
    setMeetingAccess(null);setMeetingAccessError('');
    const {data,error}=await authClient.rpc('has_feature_access' as any,{p_feature_key:'circle_live'});
    if(error){setMeetingAccessError(messageOf(error));return}
    setMeetingAccess(Boolean(data));
  },[user?.id]);
  useEffect(()=>{void refreshMeetingAccess()},[refreshMeetingAccess]);

  const openCreate=()=>{setDraft(emptyDraft);setRecurring(false);setFirstSession({startsAt:'',endsAt:'',meetingUrl:''});setEditingId(null);setFormOpen(true);say('');setConfirmClose(null)};
  const openEdit=(circle:Circle)=>{setDraft(draftOf(circle));setEditingId(circle.id);setFormOpen(true);say('');setConfirmClose(null)};
  const singleMode=!editingId&&mode!=='science'&&!recurring;
  const validate=()=>{
    const name=draft.name.trim();
    if(!name)return 'اكتب اسم الحلقة.';
    if(name.length>120)return 'اسم الحلقة أطول من ١٢٠ حرفًا.';
    if(!singleMode&&!draft.kind)return 'اختر نوع الحلقة.';
    if(singleMode&&(!firstSession.startsAt||!firstSession.endsAt))return 'حدد بداية المجلس ونهايته.';
    const limit=Number(draft.memberLimit);
    if(!Number.isInteger(limit)||limit<2||limit>100)return 'سعة الحلقة يجب أن تكون عددًا بين ٢ و١٠٠.';
    if([draft.goal,draft.description,draft.rules].some(text=>text.length>2000))return 'أحد الحقول أطول من ٢٠٠٠ حرف.';
    if(draft.startsOn&&draft.endsOn&&draft.endsOn<draft.startsOn)return 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية أو مساويًا له.';
    if(!editingId&&(firstSession.startsAt||firstSession.endsAt||firstSession.meetingUrl.trim())){
      if(!firstSession.startsAt||!firstSession.endsAt)return 'حدد بداية الجلسة الأولى ونهايتها.';
      if(new Date(firstSession.endsAt)<=new Date(firstSession.startsAt))return 'نهاية الجلسة يجب أن تكون بعد بدايتها.';
      if(firstSession.meetingUrl.trim()){
        try{const url=new URL(firstSession.meetingUrl.trim());if(url.protocol!=='https:'||url.hostname!=='meet.google.com')throw new Error()}
        catch{return 'استخدم رابط Google Meet صالحًا يبدأ بـ https://meet.google.com/'}
      }
    }
    return '';
  };
  const payload=()=>({p_name:draft.name.trim(),p_kind:singleMode?'friends':draft.kind,p_description:draft.description.trim(),p_goal:draft.goal.trim(),p_participation_rules:draft.rules.trim(),p_member_limit:Number(draft.memberLimit),p_starts_on:draft.startsOn||null,p_ends_on:draft.endsOn||null});
  const save=async()=>{
    const problem=validate();
    if(problem){say(problem,true);return}
    if(!authClient||!user||busy)return;
    const created=draft;
    const first=firstSession;
    setBusy(true);
    try{
      const {data,error}=editingId?await authClient.rpc('update_group',{p_group_id:editingId,...payload()}):await authClient.rpc('create_group',payload());
      if(error)throw error;
      setFormOpen(false);setEditingId(null);setDraft(emptyDraft);
      let note=editingId?'حُدّثت بيانات الحلقة.':'أُنشئت الحلقة الخاصة. أضف أول جلسة من «الجلسات» داخل بطاقتها.';
      let failed=false;
      if(!editingId&&typeof data==='string'&&first.startsAt&&first.endsAt){
        try{
          const {data:sessionId,error:sessionError}=await authClient.rpc('create_circle_session',{p_circle_id:data,p_title:'مجلس ذكر وتأمل',p_starts_at:new Date(first.startsAt).toISOString(),p_ends_at:new Date(first.endsAt).toISOString(),p_meeting_url:first.meetingUrl.trim(),p_notes:''});
          if(sessionError)throw sessionError;
          if(sessionId&&created.goal.trim()){const {error:agendaError}=await authClient.rpc('update_circle_session_agenda',{p_session_id:sessionId,p_agenda:created.goal.trim(),p_discussion_points:''});if(agendaError)throw agendaError}
          note=singleMode?'أُنشئ المجلس وحُدد موعده.':'أُنشئت الحلقة وجلستها الأولى.';
        }catch(sessionError){failed=true;note='أُنشئت الحلقة، لكن تعذّرت إضافة الجلسة: '+messageOf(sessionError)+' يمكنك إضافتها من «الجلسات».'}
      }
      say(note,failed);
      await load();
      if(!editingId&&typeof data==='string'){setSessionForm(sessionDefaults({goal:created.goal.trim(),starts_on:created.startsOn||null}));setSessionGroup(data);await loadCircleSessions(data)}
    }catch(error){say(messageOf(error),true)}
    finally{setBusy(false)}
  };
  const closeGroup=async(group:string)=>{
    if(!authClient||busy)return;
    setBusy(true);setConfirmClose(null);
    try{
      const {error}=await authClient.rpc('close_group',{p_group_id:group});
      if(error)throw error;
      say('أُغلقت الحلقة؛ تبقى للمؤسس والأعضاء سجلاتهم، ولا يقبل تعديلًا أو انضمامًا جديدًا.');
      await load();
    }catch(error){say(messageOf(error),true)}
    finally{setBusy(false)}
  };

  const submitCircleReport=async(circleId:string)=>{
    if(!authClient||busy)return;setBusy(true);say('');
    try{
      const {error}=await authClient.rpc('submit_report',{p_target_type:'circle',p_target_id:circleId,p_reason:reportReason,p_details:reportDetails.trim()});
      if(error)throw error;
      say('تم إرسال الإبلاغ.');setReportingCircle(null);setReportDetails('');
    }catch(error){say(messageOf(error),true)}
    finally{setBusy(false)}
  };
  const loadCircleSessions=async(circleId:string)=>{
    if(!authClient)return;setSessionsLoading(true);
    try{
      const {data,error}=await authClient.rpc('list_circle_sessions_with_agenda',{p_circle_id:circleId});
      if(error)throw error;setCircleSessions((data??[]) as any[]);
    }catch(error){say(messageOf(error),true)}
    finally{setSessionsLoading(false)}
  };
  const toggleCircleSessions=async(circleId:string)=>{
    if(sessionGroup===circleId){setSessionGroup(null);setCircleSessions([]);setRevealedMeeting(null);return}
    const target=memberships.find(row=>row.study_group?.id===circleId)?.study_group;
    if(target)setSessionForm(sessionDefaults(target));
    setSessionGroup(circleId);setRevealedMeeting(null);
    await refreshMeetingAccess();
    await loadCircleSessions(circleId);
  };
  const createCircleSession=async(circleId:string,event:React.FormEvent)=>{
    event.preventDefault();if(!authClient||busy)return;
    if(!sessionForm.startsAt||!sessionForm.endsAt){say('حدد موعد البداية والنهاية.',true);return}
    if(new Date(sessionForm.endsAt)<=new Date(sessionForm.startsAt)){say('نهاية الجلسة يجب أن تكون بعد بدايتها.',true);return}
    if(sessionForm.meetingUrl.trim()){
      try{const url=new URL(sessionForm.meetingUrl.trim());if(url.protocol!=='https:'||url.hostname!=='meet.google.com')throw new Error()}
      catch{say('استخدم رابط Google Meet صالحًا يبدأ بـ https://meet.google.com/',true);return}
    }
    setBusy(true);say('');
    try{
      const {data,error}=await authClient.rpc('create_circle_session',{p_circle_id:circleId,p_title:sessionForm.title.trim()||'مجلس ذكر وتأمل',p_starts_at:new Date(sessionForm.startsAt).toISOString(),p_ends_at:new Date(sessionForm.endsAt).toISOString(),p_meeting_url:sessionForm.meetingUrl.trim(),p_notes:sessionForm.notes.trim()});
      if(error)throw error;
      if(data&&(sessionForm.agenda.trim()||sessionForm.discussionPoints.trim())){
        const {error:agendaError}=await authClient.rpc('update_circle_session_agenda',{p_session_id:data,p_agenda:sessionForm.agenda.trim(),p_discussion_points:sessionForm.discussionPoints.trim()});
        if(agendaError)throw agendaError;
      }
      say('أُنشئ مجلس الذكر والتأمل.');setSessionForm(sessionDefaults(memberships.find(row=>row.study_group?.id===circleId)?.study_group??{goal:'',starts_on:null}));await loadCircleSessions(circleId);
    }catch(error){say(messageOf(error),true)}
    finally{setBusy(false)}
  };
  const cancelCircleSession=async(id:string)=>{
    if(!authClient||busy)return;setBusy(true);say('');
    try{
      const {error}=await authClient.rpc('cancel_circle_session',{p_session_id:id});
      if(error)throw error;setRevealedMeeting(null);say('أُلغيت الجلسة.');if(sessionGroup)await loadCircleSessions(sessionGroup);
    }catch(error){say(messageOf(error),true)}
    finally{setBusy(false)}
  };
  const openCircleMeeting=async(id:string)=>{
    if(!authClient||busy)return;
    setBusy(true);say('');
    try{
      const {data,error}=await authClient.rpc('reveal_circle_meeting_url' as any,{p_session_id:id});
      if(error)throw error;
      const url=new URL(String(data));
      if(url.protocol!=='https:'||url.hostname!=='meet.google.com')throw new Error('رابط Meet غير صالح.');
      setRevealedMeeting({id,url:url.href});
    }catch(error){say(messageOf(error),true)}
    finally{setBusy(false)}
  };
  const loadAnnouncements=async(circleId:string)=>{
    if(!authClient)return;
    try{
      const {data,error}=await authClient.from('circle_announcements').select('id,title,body,created_at').eq('circle_id',circleId).order('created_at',{ascending:false});
      if(error)throw error;setAnnouncements((data??[]) as any[]);
    }catch(error){say(messageOf(error),true)}
  };
  const toggleAnnouncements=async(circleId:string)=>{
    if(announcementGroup===circleId){setAnnouncementGroup(null);setAnnouncements([]);return}
    setAnnouncementGroup(circleId);await loadAnnouncements(circleId);
  };
  const createAnnouncement=async(circleId:string,event:React.FormEvent)=>{
    event.preventDefault();if(!authClient||busy)return;
    if(!announcementForm.title.trim()){say('عنوان التنبيه مطلوب.',true);return}
    setBusy(true);say('');
    try{
      const {error}=await authClient.rpc('create_circle_announcement',{p_circle_id:circleId,p_title:announcementForm.title.trim(),p_body:announcementForm.body.trim()});
      if(error)throw error;
      say('أُرسل تنبيه المجلس.');setAnnouncementForm({title:'',body:''});await loadAnnouncements(circleId);
    }catch(error){say(messageOf(error),true)}
    finally{setBusy(false)}
  };
  const loadInvites=async(groupId:string)=>{
    if(!authClient)return;
    try{
      const {data,error}=await authClient.rpc('list_group_invites',{p_group_id:groupId});
      if(error)throw error;
      setInvites((data??[]) as InviteRow[]);
    }catch(error){say(messageOf(error),true)}
  };
  const openInvites=async(groupId:string)=>{
    if(inviteGroup===groupId){setInviteGroup(null);setNewInviteUrl('');return}
    if(busy)return;
    setInviteGroup(groupId);setInvites([]);setNewInviteUrl('');setBusy(true);
    try{await loadInvites(groupId)}catch(error){setInviteGroup(null);say(messageOf(error),true)}finally{setBusy(false)}
  };
  const createInvite=async(groupId:string)=>{
    if(!authClient||busy)return;
    setBusy(true);setNewInviteUrl('');
    try{
      const {data,error}=await authClient.rpc('create_group_invite',{p_group_id:groupId,p_ttl_hours:72,p_max_uses:10});
      if(error)throw error;
      setNewInviteUrl(`${window.location.origin}/invite/${data}`);
      await loadInvites(groupId);
      say('أُنشئ رابط خاص صالح لثلاثة أيام وعشرة استخدامات. فتحه لا يمنح العضوية تلقائيًا.');
    }catch(error){say(messageOf(error),true)}finally{setBusy(false)}
  };
  const revokeInvite=async(groupId:string,inviteId:string)=>{
    if(!authClient||busy)return;
    setBusy(true);setNewInviteUrl('');
    try{
      const {error}=await authClient.rpc('revoke_group_invite',{p_invite_id:inviteId});
      if(error)throw error;
      await loadInvites(groupId);say('أُلغي رابط الدعوة. يمكنك إنشاء رابط جديد.');
    }catch(error){say(messageOf(error),true)}finally{setBusy(false)}
  };
  const loadRequests=async(groupId:string)=>{
    if(!authClient)return;
    const {data,error}=await authClient.from('group_join_requests')
      .select('id,user_id,requested_at,status').eq('group_id',groupId).eq('status','pending').order('requested_at');
    if(error)throw error;
    setJoinRequests((data??[]) as JoinRequest[]);
  };
  const openRequests=async(groupId:string)=>{
    if(requestGroup===groupId){setRequestGroup(null);return}
    if(busy)return;
    setRequestGroup(groupId);setJoinRequests([]);setBusy(true);
    try{await loadRequests(groupId)}catch(error){setRequestGroup(null);say(messageOf(error),true)}finally{setBusy(false)}
  };
  const decideRequest=async(groupId:string,requestId:string,approve:boolean)=>{
    if(!authClient||busy)return;
    setBusy(true);
    try{
      const {error}=await authClient.rpc('decide_group_join_request',{p_request_id:requestId,p_approve:approve});
      if(error)throw error;
      await loadRequests(groupId);
      say(approve?'قُبل الطلب وأُضيف العضو إلى الحلقة.':'رُفض طلب الانضمام.');
    }catch(error){say(messageOf(error),true)}finally{setBusy(false)}
  };
  const loadRoster=async(groupId:string)=>{
    if(!authClient)return;
    const {data,error}=await authClient.from('group_members')
      .select('user_id,role,joined_at').eq('group_id',groupId).order('joined_at');
    if(error)throw error;
    setRoster((data??[]) as MemberRow[]);
  };
  const openRoster=async(groupId:string)=>{
    if(rosterGroup===groupId){setRosterGroup(null);setConfirmMemberAction(null);return}
    if(busy)return;
    setRosterGroup(groupId);setRoster([]);setConfirmMemberAction(null);setBusy(true);
    try{await loadRoster(groupId)}catch(error){setRosterGroup(null);say(messageOf(error),true)}finally{setBusy(false)}
  };
  const changeRole=async(groupId:string,memberId:string,role:MemberRow['role'])=>{
    if(!authClient||busy||role==='founder')return;
    setBusy(true);
    try{
      const {error}=await authClient.rpc('set_group_member_role',{p_group_id:groupId,p_user_id:memberId,p_role:role});
      if(error)throw error;
      await loadRoster(groupId);say('حُدث دور العضو.');
    }catch(error){say(messageOf(error),true)}finally{setBusy(false)}
  };
  const manageMember=async(groupId:string,memberId:string,action:'remove'|'transfer'|'leave')=>{
    if(!authClient||busy)return;
    setBusy(true);setConfirmMemberAction(null);
    try{
      const result=action==='transfer'
        ?await authClient.rpc('transfer_group_foundership',{p_group_id:groupId,p_new_founder:memberId})
        :action==='leave'?await authClient.rpc('leave_group',{p_group_id:groupId})
        :await authClient.rpc('remove_group_member',{p_group_id:groupId,p_user_id:memberId});
      if(result.error)throw result.error;
      if(action==='leave'){setRosterGroup(null);await load()}
      else {await loadRoster(groupId);if(action==='transfer')await load()}
      say(action==='transfer'?'نُقلت ملكية الحلقة.':action==='leave'?'غادرت الحلقة.':'أُزيل العضو وسُحب وصوله إلى الحلقة.');
    }catch(error){say(messageOf(error),true)}finally{setBusy(false)}
  };

  const heading=mode==='science'?<div className={embedded?'circle-section-heading':'page-intro'}><span className="eyebrow">مجالس العلم</span><h1>مجالسك العلمية الخاصة</h1><p>مجالسك التعليمية الخاصة وبرامجها وأعضاؤها، مع الاحتفاظ ببياناتها وسجلها.</p></div>:<div className="page-intro"><span className="eyebrow">التواصي</span><h1>تعال نؤمن ساعة</h1><p>تواصي بين إخوة موثوقين؛ إنشاؤه ومتابعته من الحساب دون أي عرض عام.</p></div>;
  if(!user||!authClient)return <div className="circles-view">{heading}<section className="panel"><div className="panel-head"><Lock size={20}/><h2>عضوية موثوقة</h2></div><p>إنشاء الحلقات وإدارتها يحتاج تسجيل الدخول بواسطة حساب موثق؛ عُد بعد الدخول.</p></section></div>;
  if(status==='loading')return <div className="circles-view">{heading}<div className="auth-loading" role="status">جارٍ تحميل حلقاتك…</div></div>;
  if(status==='denied')return <div className="circles-view">{heading}<section className="panel feature-access-required"><h2>مجالسك الخاصة غير مشمولة باستحقاق الحساب</h2><p>يمكنك استكشاف الدورات العامة، أما إدارة المجالس الخاصة فتتطلب تفعيل ميزة التواصي الخاص.</p></section></div>;
  if(status==='error')return <div className="circles-view">{heading}<section className="panel"><div className="panel-head"><RefreshCw size={20}/><h2>تعذر التحميل</h2></div><p role="alert">{loadError}</p><button className="soft-btn" onClick={()=>void load()}>إعادة المحاولة</button></section></div>;

  const memberships=(rows??[]).filter(row=>{
    const kind=row.study_group?.kind;
    const scientific=['book','course','program'].includes(kind??'');
    return mode==='science'?scientific:!scientific;
  });
  return <div className="circles-view">
    {!embedded&&heading}
    {mode==='tawasi'&&<div className="circle-kind-choice" role="tablist" aria-label="أقسام التواصي">{([['mine','مجالسي'],['invites','الدعوات'],['mentor','طلب شيخ معتمد'],['history','السجل']] as const).map(([key,label])=><button key={key} type="button" role="tab" aria-selected={tab===key} className={tab===key?'soft-btn selected':'soft-btn'} onClick={()=>setTab(key)}>{label}</button>)}</div>}
    {mode==='tawasi'&&tab==='invites'&&<TawasiInvitesPanel userId={user.id} circles={memberships.flatMap(row=>row.study_group?[{id:row.study_group.id,name:row.study_group.name}]:[])} onChanged={()=>void load()}/>}
    {mode==='tawasi'&&tab==='mentor'&&<TawasiMentorshipPanel userId={user.id} always/>}
    {mode==='tawasi'&&tab==='history'&&<TawasiHistoryPanel circles={memberships.flatMap(row=>row.study_group?[{id:row.study_group.id,name:row.study_group.name}]:[])}/>}
    {(mode!=='tawasi'||tab==='mine')&&<>
    {mode==='science'&&<section className="panel"><div className="panel-head"><Lock size={20}/><h2>خصوصية المجالس العلمية الخاصة</h2></div>
      <p className="muted small">هذه المجالس خاصة بلا دليل أو بحث عام. رابط الدعوة يعرض تعريفًا محدودًا فقط؛ والانضمام يتطلب طلبًا وموافقة مسؤول المجلس، ولا يمنح الرابط العضوية تلقائيًا.</p>
    </section>}
    {mode==='tawasi'&&<section className="panel circle-live-access" aria-label="صلاحية اللقاءات المباشرة">
      <div><strong>جلسات التواصي المباشرة</strong><p className="muted small" role="status">{meetingAccessError?`تعذر فحص الصلاحية: ${meetingAccessError}`:meetingAccess===null?'جارٍ فحص صلاحية فتح رابط Meet…':meetingAccess?'يمكنك فتح رابط Meet لجلسة مجدولة داخل حلقة أنت عضو فيها.':'فتح رابط Meet يتطلب اشتراك Premium فعّالًا أو منح الميزة من إدارة المنصة.'}</p><p className="muted small">إنشاء الحلقة وإدارة أعضائها متاحان دون هذه الصلاحية. يظهر رابط اللقاء بعد إنشاء الحلقة وجدولة جلسة لها.</p></div>
      <button className="soft-btn" type="button" onClick={()=>void refreshMeetingAccess()}>تحديث الصلاحية</button>
    </section>}
    {notice&&<p className={`circles-notice${noticeIsError?' error':''}`} role={noticeIsError?'alert':'status'}>{notice}</p>}
    <div className="circles-toolbar"><button className="primary" aria-expanded={formOpen} aria-controls="circle-form" onClick={()=>{if(formOpen){setFormOpen(false);setEditingId(null)}else openCreate()}}><Plus size={17}/>{formOpen?'إلغاء النموذج':mode==='science'?'مجلس علمي خاص جديد':'مجلس تواصٍ جديد'}</button></div>
    {formOpen&&<section id="circle-form" className="panel circle-form" aria-labelledby="circle-form-title">
      <div className="panel-head"><Users size={20}/><h2 id="circle-form-title">{editingId?'تعديل بيانات المجلس':mode==='science'?'إنشاء مجلس علمي خاص':'إنشاء مجلس تواصٍ خاص'}</h2></div>
      <form onSubmit={e=>{e.preventDefault();void save()}}>
        {!editingId&&mode!=='science'&&<div className="circle-kind-choice" role="group" aria-label="نوع المجلس"><button type="button" className={!recurring?'soft-btn selected':'soft-btn'} aria-pressed={!recurring} onClick={()=>setRecurring(false)}>لقاء واحد</button><button type="button" className={recurring?'soft-btn selected':'soft-btn'} aria-pressed={recurring} onClick={()=>setRecurring(true)}>مجلس متكرر (حلقة بأعضاء ثابتين)</button></div>}
        <div className="form-grid">
          <label>{singleMode?'عنوان المجلس':'اسم الحلقة'}<input required maxLength={120} aria-label="اسم الحلقة" value={draft.name} onChange={e=>set({name:e.target.value})}/></label>
          {!singleMode&&<><label>نوع الحلقة<select required aria-label="نوع الحلقة" value={draft.kind} onChange={e=>set({kind:e.target.value})}><option value="" disabled>اختَر النوع</option>{kindOptions.filter(([value])=>mode==='science'?['book','course','program'].includes(value):!['book','course','program'].includes(value)).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
          <label>سعة الأعضاء<input type="number" required min={2} max={100} step={1} aria-label="سعة الأعضاء" value={draft.memberLimit} onChange={e=>set({memberLimit:e.target.value})}/></label>
          <label>بداية الفترة<input type="date" aria-label="بداية الفترة" value={draft.startsOn} onChange={e=>set({startsOn:e.target.value})}/></label>
          <label>نهاية الفترة<input type="date" aria-label="نهاية الفترة" value={draft.endsOn} onChange={e=>set({endsOn:e.target.value})}/></label></>}
        </div>
        <label>{singleMode?'هدف المجلس أو موضوعه':'هدف الحلقة'}<textarea rows={2} maxLength={2000} aria-label="هدف الحلقة" value={draft.goal} onChange={e=>set({goal:e.target.value})}/></label>
        {(editingId||draft.description)&&<label>وصف الحلقة<textarea rows={2} maxLength={2000} aria-label="وصف الحلقة" value={draft.description} onChange={e=>set({description:e.target.value})}/></label>}
        {!editingId&&<fieldset className="circle-first-session"><legend>{singleMode?'موعد المجلس':'أول جلسة (اختياري)'}</legend><p className="muted small">{singleMode?'':'يُستخدم هدف الحلقة هدفًا للجلسة تلقائيًا. '} افتح <a href="https://meet.new" target="_blank" rel="noopener noreferrer">Google Meet ↗</a> وانسخ رابطه هنا إن أردت.</p><div className="form-grid"><label>البداية<input type="datetime-local" required={singleMode} value={firstSession.startsAt} onChange={e=>setFirstSession(c=>({...c,startsAt:e.target.value}))}/></label><label>النهاية<input type="datetime-local" required={singleMode} value={firstSession.endsAt} onChange={e=>setFirstSession(c=>({...c,endsAt:e.target.value}))}/></label><label>رابط Meet<input type="url" maxLength={500} dir="ltr" value={firstSession.meetingUrl} onChange={e=>setFirstSession(c=>({...c,meetingUrl:e.target.value}))} placeholder="https://meet.google.com/…"/></label></div></fieldset>}
        {!singleMode&&<label>قواعد المشاركة<textarea rows={3} maxLength={2000} aria-label="قواعد المشاركة" value={draft.rules} onChange={e=>set({rules:e.target.value})}/></label>}
        <p className="muted small">{mode==='science'?'تظهر المجالس العلمية الخاصة هنا ضمن «مجالس العلم»، وتبقى مخصصة للأعضاء المدعوين.':'برامج المتابعة اليومية (الصلاة والقرآن والأذكار) تُضاف في مهام الخطط؛ تُدار الحلقة من مؤسسها.'}</p>
        <button className="primary" type="submit" disabled={busy}>{busy?'جارٍ الحفظ…':editingId?'حفظ التعديلات':mode==='science'?'إنشاء المجلس العلمي':singleMode?'إنشاء المجلس':'إنشاء مجلس التواصي'}</button>
      </form>
    </section>}
    {memberships.length===0&&<section className="panel"><div className="panel-head"><Users size={20}/><h2>{mode==='science'?'لا مجالس علمية خاصة بعد':'لا مجالس تواصٍ بعد'}</h2></div><p className="muted">{mode==='science'?'لم تُنشئ مجلسًا علميًا خاصًا أو تنضم إلى واحد حتى الآن. أنشئ مجلسًا أو تابع مجالس العلم المنشورة.':'لم تُنشئ مجلس تواصٍ أو تنضم إلى واحد حتى الآن. أنشئ مجلسًا للرفقة والتذكير والمساندة.'}</p></section>}
    {memberships.map(row=>{
      const circle=row.study_group;
      if(!circle)return null;
      const closed=circle.status==='closed';
      return <section className="panel circle-card" key={circle.id} aria-label={`حلقة ${circle.name}`}>
        <div className="panel-head"><CalendarDays size={20}/><h2>{circle.name}</h2><span className={`circles-flag ${closed?'closed':''}`}>{closed?'مغلقة':'نشطة'}</span><span className="circles-role">{roleLabel(row.role)}</span></div>
        <p className="circle-kind muted small">{kindLabel(circle.kind)}</p>
        <ul className="circle-meta"><li>السعة: {countLabel(circle.member_limit)}</li><li>{circle.starts_on?`من ${dateLabel(circle.starts_on)}`:'بلا بدء'}</li><li>{circle.ends_on?`إلى ${dateLabel(circle.ends_on)}`:'بلا نهاية'}</li></ul>
        {circle.goal&&<p className="circle-text"><strong>الهدف:</strong> {circle.goal}</p>}
        {circle.description&&<p className="circle-text"><strong>الوصف:</strong> {circle.description}</p>}
        {circle.participation_rules&&<p className="circle-text"><strong>قواعد المشاركة:</strong> {circle.participation_rules}</p>}
        <p className="muted small circle-purpose-note">{mode==='science'?'مجلس علمي خاص؛ محتواه وخطته متاحان لأعضائه فقط.':'مجلس للرفقة والتذكير والمساندة بين أعضائه.'}</p>
        {['book','course','program'].includes(circle.kind)&&<details className="panel circle-scientific-program"><summary>الواجب العملي للمجلس العلمي</summary><CircleProgram groupId={circle.id} canEdit={row.role==='founder'} userId={user.id}/></details>}
        <div className="circle-actions"><button className="soft-btn" disabled={busy} aria-expanded={sessionGroup===circle.id} aria-controls={`sessions-${circle.id}`} onClick={()=>void toggleCircleSessions(circle.id)}>الجلسات</button><button className="soft-btn" disabled={busy} aria-expanded={announcementGroup===circle.id} aria-controls={`announcements-${circle.id}`} onClick={()=>void toggleAnnouncements(circle.id)}>تنبيهات المجلس</button></div>
        {sessionGroup===circle.id&&<section className="panel circle-invites" id={`sessions-${circle.id}`}>
          <div className="panel-head"><CalendarDays size={18}/><h2>جلسات الحلقة</h2></div>
          {meetingAccess===false&&<p className="muted small">فتح لقاءات التواصي متاح لأعضاء Premium أو لمن منحته إدارة المنصة هذه الميزة.</p>}
          {meetingAccessError&&<p className="circles-notice error" role="alert">تعذر فحص صلاحية اللقاء: {meetingAccessError}</p>}
          {sessionsLoading?<p className="muted small" role="status">جارٍ تحميل المجالس…</p>:circleSessions.length===0?<p className="muted small">لا مجالس بعد. ينشئ المؤسس مجلس ذكر وتأمل ويحدد محاوره اختياريًا.</p>:<ul className="course-list">{circleSessions.map((s:any)=><li key={s.id}><div><strong>{s.title||'مجلس ذكر وتأمل'}</strong><p>{new Date(s.starts_at).toLocaleString('ar-EG',{dateStyle:'medium',timeStyle:'short'})} — {new Date(s.ends_at).toLocaleString('ar-EG',{dateStyle:'medium',timeStyle:'short'})}</p>{s.agenda&&<p><strong>الهدف:</strong> {s.agenda}</p>}{s.discussion_points&&<p><strong>محاور الحديث:</strong> {s.discussion_points}</p>}{s.notes&&<p className="muted small">{s.notes}</p>}</div><div className="course-actions">{s.status==='scheduled'&&s.has_meeting_link&&meetingAccess===true&&<button className="soft-btn" disabled={busy} onClick={()=>void openCircleMeeting(s.id)}>عرض رابط Meet</button>}{meetingAccess===true&&revealedMeeting?.id===s.id&&<a className="soft-btn" href={revealedMeeting?.url} target="_blank" rel="noreferrer">دخول مجلس Meet</a>}{s.status==='scheduled'&&!s.has_meeting_link&&<span className="muted small">لم يُضف رابط Meet بعد</span>}{s.status==='scheduled'&&row.role==='founder'&&<button className="soft-btn" disabled={busy} onClick={()=>void cancelCircleSession(s.id)}>إلغاء المجلس</button>}</div></li>)}</ul>}
          {row.role==='founder'&&!closed&&<form className="circle-session-form" onSubmit={e=>void createCircleSession(circle.id,e)}>
            <h3>مجلس ذكر وتأمل جديد</h3>
            <p className="muted small">افتح Google Meet في نافذة جديدة، وأنشئ الاجتماع، ثم انسخ رابطه والصقه أدناه. لا يمنح فتح Google Meet وحده أعضاء الحلقة وصولًا إلى الرابط.</p>
            <a className="soft-btn circle-meet-create" href="https://meet.new" target="_blank" rel="noopener noreferrer">إنشاء اجتماع في Google Meet ↗</a>
            <label>عنوان المجلس<input maxLength={200} value={sessionForm.title} onChange={e=>setSessionForm(current=>({...current,title:e.target.value}))}/></label>
            <label>البداية<input required type="datetime-local" value={sessionForm.startsAt} onChange={e=>setSessionForm(current=>({...current,startsAt:e.target.value}))}/></label>
            <label>النهاية<input required type="datetime-local" value={sessionForm.endsAt} onChange={e=>setSessionForm(current=>({...current,endsAt:e.target.value}))}/></label>
            <label>رابط Meet<input type="url" maxLength={500} value={sessionForm.meetingUrl} onChange={e=>setSessionForm(current=>({...current,meetingUrl:e.target.value}))} placeholder="https://meet.google.com/…"/></label>
            <label>هدف المجلس أو موضوعه<textarea rows={2} maxLength={2000} value={sessionForm.agenda} onChange={e=>setSessionForm(current=>({...current,agenda:e.target.value}))}/></label>
            <label>محاور الحديث والنقاط المقترحة<textarea rows={3} maxLength={4000} value={sessionForm.discussionPoints} onChange={e=>setSessionForm(current=>({...current,discussionPoints:e.target.value}))}/></label>
            <label>ملاحظات<textarea rows={2} maxLength={1000} value={sessionForm.notes} onChange={e=>setSessionForm(current=>({...current,notes:e.target.value}))}/></label>
            <button className="primary" type="submit" disabled={busy}>إنشاء جلسة</button>
          </form>}
        </section>}
        {announcementGroup===circle.id&&<section className="panel circle-invites" id={`announcements-${circle.id}`}>
          <div className="panel-head"><Megaphone size={18}/><h2>تنبيهات المجلس</h2></div>
          <p className="muted small circle-adab-note">تُستخدم هذه المساحة للتذكير النافع ومواعيد المجلس وما يتصل بموضوعه، مع مراعاة الرفق والاختصار واحترام خصوصية الأعضاء.</p>
          {announcements.length===0?<p className="muted small">لا توجد تنبيهات بعد.</p>:<ul className="course-list">{announcements.map((a:any)=><li key={a.id}><div><strong>{a.title}</strong><p>{a.body}</p><small className="muted small">{new Date(a.created_at).toLocaleString('ar-EG',{dateStyle:'medium',timeStyle:'short'})}</small></div></li>)}</ul>}
          <form onSubmit={e=>void createAnnouncement(circle.id,e)}>
            <h3>تنبيه جديد للمجلس</h3>
            <label>العنوان<input maxLength={200} value={announcementForm.title} onChange={e=>setAnnouncementForm(current=>({...current,title:e.target.value}))}/></label>
            <label>النص<textarea rows={3} maxLength={2000} value={announcementForm.body} onChange={e=>setAnnouncementForm(current=>({...current,body:e.target.value}))}/></label>
            <button className="primary" type="submit" disabled={busy}>إرسال التنبيه</button>
          </form>
        </section>}
      {row.role==='founder'&&!closed&&<div className="circle-actions">
          <button className="soft-btn" onClick={()=>openEdit(circle)}><Pencil size={15}/> تعديل البيانات</button>
          <button className="soft-btn" disabled={busy} aria-expanded={inviteGroup===circle.id} aria-controls={`invites-${circle.id}`} onClick={()=>void openInvites(circle.id)}><Link2 size={15}/> روابط الدعوة</button>
          <button className="soft-btn" onClick={()=>setReportingCircle(current=>current===circle.id?null:circle.id)}>إبلاغ</button>
          {reportingCircle===circle.id&&<form className="circle-actions" style={{flex:'1 1 100%'}} onSubmit={e=>{e.preventDefault();void submitCircleReport(circle.id)}}>
            <select value={reportReason} onChange={e=>setReportReason(e.target.value)} aria-label="سبب الإبلاغ"><option value="spam">رسائل مزعجة</option><option value="harassment">مضايقة</option><option value="inappropriate">محتوى غير لائق</option><option value="misinformation">معلومات مضللة</option><option value="privacy">خصوصية</option><option value="other">أخرى</option></select>
            <textarea rows={2} placeholder="تفاصيل (اختياري)" value={reportDetails} onChange={e=>setReportDetails(e.target.value)} maxLength={2000}/>
            <button className="primary" type="submit" disabled={busy}>إرسال الإبلاغ</button>
            <button className="soft-btn" type="button" onClick={()=>setReportingCircle(null)}>إلغاء</button>
          </form>}
          {confirmClose===circle.id?<>
            <p className="circles-notice error" role="alert">يُغلق هذا الإجراء الحلقة نهائيًا: تبقى سجلاتها محفوظة للأعضاء حسب صلاحياتهم، ولا يمكن إعادة فتحها. أتأكد من الإغلاق؟</p>
            <button className="soft-btn" disabled={busy} onClick={()=>void closeGroup(circle.id)}>تأكيد الإغلاق</button><button className="soft-btn" onClick={()=>setConfirmClose(null)}>تراجع</button>
          </>:<button className="soft-btn" disabled={busy} onClick={()=>setConfirmClose(circle.id)}>إغلاق الحلقة</button>}
        </div>}
        {(row.role==='founder'||row.role==='manager')&&<div className="circle-actions"><button className="soft-btn" disabled={busy} aria-expanded={requestGroup===circle.id} aria-controls={`requests-${circle.id}`} onClick={()=>void openRequests(circle.id)}>طلبات الانضمام</button><button className="soft-btn" disabled={busy} aria-expanded={rosterGroup===circle.id} aria-controls={`roster-${circle.id}`} onClick={()=>void openRoster(circle.id)}>إدارة الأعضاء</button></div>}
        {row.role!=='founder'&&<div className="circle-actions">{confirmMemberAction===`leave:${circle.id}`?<><p className="circles-notice error" role="alert">هل تريد مغادرة الحلقة؟ ستفقد الوصول إلى محتواها.</p><button className="soft-btn" disabled={busy} onClick={()=>void manageMember(circle.id,user.id,'leave')}>تأكيد المغادرة</button><button className="soft-btn" onClick={()=>setConfirmMemberAction(null)}>تراجع</button></>:<button className="soft-btn" onClick={()=>setConfirmMemberAction(`leave:${circle.id}`)}>مغادرة الحلقة</button>}</div>}
        {row.role==='founder'&&inviteGroup===circle.id&&<div id={`invites-${circle.id}`} className="circle-invites">
          <h3>روابط الدعوة الخاصة</h3>
          {!closed&&<button className="soft-btn" disabled={busy} onClick={()=>void createInvite(circle.id)}>إنشاء رابط جديد</button>}
          {newInviteUrl&&<div className="circle-invite-created" role="status"><p>انسخ الرابط الآن؛ لا يُعرض الرمز الخام مرة أخرى.</p><input readOnly aria-label="رابط الدعوة الجديد" value={newInviteUrl} onFocus={e=>e.currentTarget.select()}/><button className="soft-btn" onClick={()=>void navigator.clipboard.writeText(newInviteUrl).then(()=>say('نُسخ الرابط.')).catch(()=>say('حدّد الرابط وانسخه يدويًا.',true))}>نسخ الرابط</button></div>}
          {busy&&invites.length===0?<p className="muted small" role="status">جارٍ تحميل الروابط…</p>:invites.length===0?<p className="muted small">لا روابط صادرة لهذه الحلقة.</p>:<ul>{invites.map(invite=><li key={invite.invite_id}><span>{invite.invite_status==='revoked'?'ملغى':new Date(invite.invite_expires_at)<=new Date()?'منتهي':'نشط'} · الاستخدامات {invite.invite_uses_count}/{invite.invite_max_uses} · ينتهي {new Intl.DateTimeFormat('ar-EG',{dateStyle:'medium',timeStyle:'short'}).format(new Date(invite.invite_expires_at))}</span>{invite.invite_status==='active'&&<button className="soft-btn" disabled={busy} onClick={()=>void revokeInvite(circle.id,invite.invite_id)}>إلغاء</button>}</li>)}</ul>}
        </div>}
        {(row.role==='founder'||row.role==='manager')&&requestGroup===circle.id&&<div id={`requests-${circle.id}`} className="circle-invites">
          <h3>طلبات الانضمام المعلقة</h3>
          {busy&&joinRequests.length===0?<p className="muted small" role="status">جارٍ تحميل الطلبات…</p>:joinRequests.length===0?<p className="muted small">لا طلبات معلقة.</p>:<ul>{joinRequests.map(request=><li key={request.id}><span>حساب {request.user_id.slice(0,8)}… · {new Intl.DateTimeFormat('ar-EG',{dateStyle:'medium'}).format(new Date(request.requested_at))}</span><button className="soft-btn" disabled={busy||closed} onClick={()=>void decideRequest(circle.id,request.id,true)}>قبول</button><button className="soft-btn" disabled={busy||closed} onClick={()=>void decideRequest(circle.id,request.id,false)}>رفض</button></li>)}</ul>}
        </div>}
        {(row.role==='founder'||row.role==='manager')&&rosterGroup===circle.id&&<div id={`roster-${circle.id}`} className="circle-invites">
          <h3>أعضاء الحلقة</h3>
          {busy&&roster.length===0?<p className="muted small" role="status">جارٍ تحميل الأعضاء…</p>:roster.length===0?<p className="muted small">لا أعضاء ظاهرين.</p>:<ul>{roster.map(member=><li key={member.user_id}>
            <span>حساب {member.user_id.slice(0,8)}… · {roleLabel(member.role)}</span>
            {row.role==='founder'&&member.role!=='founder'&&<select aria-label={`دور حساب ${member.user_id.slice(0,8)}`} value={member.role} disabled={busy||closed} onChange={e=>void changeRole(circle.id,member.user_id,e.target.value as MemberRow['role'])}><option value="member">عضو</option><option value="assistant">مساعد</option><option value="manager">مسؤول</option></select>}
            {member.user_id!==user.id&&member.role!=='founder'&&(row.role==='founder'||member.role!=='manager')&&<>
              {confirmMemberAction===`remove:${member.user_id}`?<><span role="alert">تأكيد إزالة هذا العضو؟</span><button className="soft-btn" disabled={busy} onClick={()=>void manageMember(circle.id,member.user_id,'remove')}>تأكيد</button><button className="soft-btn" onClick={()=>setConfirmMemberAction(null)}>تراجع</button></>:<button className="soft-btn" disabled={busy||closed} onClick={()=>setConfirmMemberAction(`remove:${member.user_id}`)}>إزالة</button>}
            </>}
            {row.role==='founder'&&member.user_id!==user.id&&<>
              {confirmMemberAction===`transfer:${member.user_id}`?<><span role="alert">سيصبح هذا العضو المؤسس، وستصبح مسؤولًا. تأكيد؟</span><button className="soft-btn" disabled={busy} onClick={()=>void manageMember(circle.id,member.user_id,'transfer')}>تأكيد النقل</button><button className="soft-btn" onClick={()=>setConfirmMemberAction(null)}>تراجع</button></>:<button className="soft-btn" disabled={busy||closed} onClick={()=>setConfirmMemberAction(`transfer:${member.user_id}`)}>نقل الملكية</button>}
            </>}
          </li>)}</ul>}
        </div>}
      </section>;
    })}
    </>}
  </div>;
}
