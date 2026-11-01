import {useEffect,useState} from 'react';
import {Archive,ArchiveRestore,RefreshCw} from 'lucide-react';
import {authClient} from '../auth';
import {getArchivePageAfterResult} from '../archive-pagination';

type ContentItem={
  content_type:string;
  content_id:string;
  content_title:string;
  content_summary:string;
  context_title:string;
  content_created_at:string;
  archived_at:string|null;
  reason:string|null;
  total_count:number;
};

const pageSize=50;
const labels:Record<string,string>={
  course_lesson:'درس دورة',
  course_material:'مادة دورة',
  course_assignment:'واجب دورة',
  study_material:'مادة مدارسة',
  study_plan_task:'مهمة خطة مدارسة',
  study_note:'مشاركة علمية',
  study_question:'سؤال مدارسة',
  study_meeting:'اجتماع مدارسة',
  circle_announcement:'إعلان حلقة',
  circle_live_session:'جلسة حلقة'
};

export default function AdminContentArchivePanel(){
  const [archived,setArchived]=useState(false);
  const [page,setPage]=useState(0);
  const [items,setItems]=useState<ContentItem[]>([]);
  const [reason,setReason]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState<string|null>(null);
  const total=Number(items[0]?.total_count??0);
  const load=async()=>{
    if(!authClient){setLoading(false);setError('خدمة المنصة غير متاحة.');return}
    setLoading(true);setError('');
    try{
      const {data,error:rpcError}=await authClient.rpc('list_admin_archivable_content',{
        p_archived:archived,p_limit:pageSize,p_offset:page*pageSize
      });
      if(rpcError)throw rpcError;
      const result=data??[];
      setItems(result as ContentItem[]);
      const nextPage=getArchivePageAfterResult(page,result.length);
      if(nextPage!==page)setPage(nextPage);
    }catch(caught){
      setError(caught instanceof Error?caught.message:'تعذر تحميل محتوى الأرشيف.');
      setItems([]);
    }finally{setLoading(false)}
  };
  useEffect(()=>{void load()},[archived,page]);
  const changeView=(next:boolean)=>{setArchived(next);setPage(0)};
  const changeArchiveState=async(item:ContentItem)=>{
    if(!authClient||busy)return;
    const prompt=archived
      ?`استعادة «${item.content_title}» وإظهاره مجددًا لأعضاء المنصة؟`
      :`أرشفة «${item.content_title}»؟ سيبقى محفوظًا ويمكن استعادته لاحقًا.`;
    if(!window.confirm(prompt))return;
    const key=`${item.content_type}:${item.content_id}`;
    setBusy(key);setError('');
    try{
      const {error:rpcError}=archived
        ?await authClient.rpc('restore_platform_content',{p_content_type:item.content_type,p_content_id:item.content_id})
        :await authClient.rpc('archive_platform_content',{
          p_content_type:item.content_type,p_content_id:item.content_id,p_reason:reason.trim()
        });
      if(rpcError)throw rpcError;
      await load();
    }catch(caught){setError(caught instanceof Error?caught.message:'تعذر تحديث حالة المحتوى.')}
    finally{setBusy(null)}
  };
  const pages=Math.ceil(total/pageSize);
  return <section className="panel admin-content-archive" aria-labelledby="admin-content-archive-title">
    <div className="admin-content-archive-heading">
      <div><h2 id="admin-content-archive-title">أرشيف المحتوى</h2>
        <p>أخفِ المحتوى المشترك مؤقتًا أو استعده لاحقًا. لا تُحذف البيانات نهائيًا.</p></div>
      <button type="button" className="admin-users-refresh" aria-label="تحديث قائمة المحتوى" disabled={loading} onClick={()=>void load()}><RefreshCw size={17}/></button>
    </div>
    <div className="admin-content-archive-toolbar">
      <div className="admin-content-archive-tabs" role="group" aria-label="حالة المحتوى">
        <button type="button" aria-pressed={!archived} className={!archived?'selected':''} onClick={()=>changeView(false)}>المتاح</button>
        <button type="button" aria-pressed={archived} className={archived?'selected':''} onClick={()=>changeView(true)}>المؤرشف</button>
      </div>
      {!archived&&<label>سبب الأرشفة (اختياري)<input maxLength={500} value={reason} onChange={event=>setReason(event.target.value)} placeholder="مثال: محتوى قديم"/></label>}
    </div>
    {error&&<p className="admin-users-error" role="alert">{error}</p>}
    {loading?<p role="status">جارٍ تحميل المحتوى…</p>:items.length===0
      ?<p className="admin-users-empty">{archived?'لا يوجد محتوى مؤرشف.':'لا يوجد محتوى متاح للأرشفة.'}</p>
      :<ul className="admin-content-archive-list">{items.map(item=>{
        const key=`${item.content_type}:${item.content_id}`;
        return <li key={key}>
          <div className="admin-content-archive-item">
            <div className="admin-content-archive-tags"><span>{labels[item.content_type]??item.content_type}</span>{item.context_title&&<span>{item.context_title}</span>}</div>
            <strong>{item.content_title||'محتوى دون عنوان'}</strong>
            {item.content_summary&&<p>{item.content_summary}</p>}
            <small>{new Date(item.content_created_at).toLocaleDateString('ar-EG')}
              {item.archived_at&&` · أُرشف ${new Date(item.archived_at).toLocaleDateString('ar-EG')}`}
              {item.reason&&` · ${item.reason}`}</small>
          </div>
          <button type="button" className="admin-user-manage" disabled={busy===key}
            onClick={()=>void changeArchiveState(item)}>
            {archived?<><ArchiveRestore size={16}/> استعادة</>:<><Archive size={16}/> أرشفة</>}
          </button>
        </li>;
      })}</ul>}
    {pages>1&&<div className="admin-content-archive-pagination">
      <button type="button" disabled={page===0||loading} onClick={()=>setPage(value=>Math.max(0,value-1))}>السابق</button>
      <span>صفحة {page+1} من {pages} · {total.toLocaleString('ar-EG')} عنصر</span>
      <button type="button" disabled={page+1>=pages||loading} onClick={()=>setPage(value=>value+1)}>التالي</button>
    </div>}
  </section>;
}
