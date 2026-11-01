import {useEffect,useState} from 'react';
import {Check,LoaderCircle,Search,UserPlus} from 'lucide-react';
import {authClient} from '../auth';
import '../invitations.css';

type Member={username:string;display_name:string};

type Props={
  /** نص زر الإرسال، مثل «دعوة إلى المدارسة». */
  actionLabel:string;
  /** شرح موجز يظهر تحت الحقل. */
  hint?:string;
  placeholder?:string;
  disabled?:boolean;
  /** تُستدعى مرة لكل اسم مستخدم مختار. ارمِ الخطأ لإظهار سببه. */
  onInvite:(username:string)=>Promise<void>;
  /** بعد انتهاء كل الإرسال (نجاحًا أو فشلًا) لإعادة تحميل قائمة الدعوات. */
  onDone?:()=>void;
};

const messageOf=(error:unknown)=>error instanceof Error?error.message:'تعذر إرسال الدعوة.';

/**
 * شريط دعوة أعضاء واحد يعاد استخدامه في كل نشاط. لا يعرف شيئًا عن نوع
 * النشاط: النشاط نفسه يمرر RPC الإرسال، فيبقى التحقق من الصلاحيات والسعة
 * والاكتشاف على الخادم.
 */
export default function MemberInviteBar({actionLabel,hint,placeholder='اسم المستخدم',disabled=false,onInvite,onDone}:Props){
  const [query,setQuery]=useState('');
  const [results,setResults]=useState<Member[]>([]);
  const [selected,setSelected]=useState<string[]>([]);
  const [searching,setSearching]=useState(false);
  const [sending,setSending]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');

  useEffect(()=>{
    const q=query.trim().toLowerCase();
    if(!authClient||q.length<3){setResults([]);setSearching(false);return}
    let active=true;
    setSearching(true);
    const client=authClient;
    const timer=window.setTimeout(()=>{
      void (async()=>{
        try{
          const {data,error:searchError}=await client.rpc('search_share_members',{p_query:q});
          if(!active)return;
          if(searchError){setError(messageOf(searchError));setResults([]);return}
          setError('');
          setResults((data??[]) as unknown as Member[]);
        }catch(caught){if(active)setError(messageOf(caught))}
        finally{if(active)setSearching(false)}
      })();
    },450);
    return()=>{active=false;window.clearTimeout(timer)};
  },[query]);

  const toggle=(username:string)=>setSelected(current=>current.includes(username)?current.filter(item=>item!==username):[...current,username]);

  const send=async()=>{
    if(!selected.length||sending)return;
    setSending(true);setError('');setNotice('');
    const failures:string[]=[];
    let sent=0;
    for(const username of selected){
      try{
        await onInvite(username);
        sent+=1;
        setResults(current=>current.filter(item=>item.username!==username));
      }catch(caught){
        failures.push(`${username}: ${messageOf(caught)}`);
      }
    }
    setSelected([]);setQuery('');
    if(sent)setNotice(sent===1?'أُرسلت الدعوة، ووصل إشعار للمدعو.':`أُرسلت ${sent} دعوات، ووصلت الإشعارات للمدعوين.`);
    if(failures.length)setError(failures.join(' · '));
    setSending(false);
    onDone?.();
  };

  return <div className="invite-bar">
    <label className="invite-search">
      <span className="invite-search-label"><Search size={15} aria-hidden="true"/>{hint??'ابحث باسم المستخدم ثم اختر من تريد دعوته'}</span>
      <input dir="ltr" value={query} maxLength={20} placeholder={placeholder} disabled={disabled||sending}
        onChange={event=>{setQuery(event.target.value);setError('');setNotice('')}} aria-label="البحث باسم المستخدم"/>
    </label>
    {searching&&<p className="invite-state" role="status"><LoaderCircle size={15} className="spin"/> جارٍ البحث…</p>}
    {!searching&&query.trim().length>=3&&results.length===0&&!error&&<p className="invite-state">لا نتائج. تأكد من اسم المستخدم ومن إتاحة الظهور للعضو.</p>}
    {results.length>0&&<ul className="invite-results" aria-label="نتائج البحث">
      {results.map(member=><li key={member.username}>
        <label className={selected.includes(member.username)?'selected':''}>
          <input type="checkbox" checked={selected.includes(member.username)} disabled={disabled||sending} onChange={()=>toggle(member.username)}/>
          <span><strong>{member.display_name}</strong> <bdi dir="ltr" className="muted">@{member.username}</bdi></span>
          {selected.includes(member.username)&&<Check size={15} aria-hidden="true"/>}
        </label>
      </li>)}
    </ul>}
    {selected.length>0&&<div className="invite-send-row">
      <span className="muted small">المختارون: {selected.length}</span>
      <button type="button" className="primary" disabled={disabled||sending} onClick={()=>void send()}>
        {sending?<><LoaderCircle size={15} className="spin"/> جارٍ الإرسال…</>:<><UserPlus size={15}/> {actionLabel} ({selected.length})</>}
      </button>
    </div>}
    {notice&&<p className="invite-message ok" role="status">{notice}</p>}
    {error&&<p className="invite-message error" role="alert">{error}</p>}
  </div>;
}
