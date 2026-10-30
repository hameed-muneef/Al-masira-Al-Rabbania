import {useEffect,useState,type FormEvent} from 'react';
import {authClient} from '../auth';
import '../teacher.css';

type Feature={key:string;title:string;description:string;enabled:boolean;requires_premium:boolean};
type Override={feature_key:string;allowed:boolean};
const message=(error:unknown)=>error instanceof Error?error.message:'تعذّر تنفيذ العملية.';

export default function PlatformFeaturesPanel(){
  const [features,setFeatures]=useState<Feature[]>([]);
  const [form,setForm]=useState<Feature>({key:'',title:'',description:'',enabled:true,requires_premium:true});
  const [email,setEmail]=useState('');
  const [selectedKey,setSelectedKey]=useState('circle_live');
  const [overrides,setOverrides]=useState<Override[]>([]);
  const [inspected,setInspected]=useState(false);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const load=async()=>{
    if(!authClient)return;
    setLoading(true);setError('');
    const {data,error:loadError}=await authClient.from('platform_features')
      .select('key,title,description,enabled,requires_premium').order('key');
    if(loadError)setError(loadError.message);
    else setFeatures((data??[]) as Feature[]);
    setLoading(false);
  };
  useEffect(()=>{void load()},[]);
  const saveFeature=async(event:FormEvent)=>{
    event.preventDefault();if(!authClient||busy)return;
    setBusy(true);setError('');setNotice('');
    try{
      const {error:saveError}=await authClient.rpc('save_platform_feature' as any,{
        p_key:form.key.trim(),p_title:form.title.trim(),p_description:form.description.trim(),
        p_enabled:form.enabled,p_requires_premium:form.requires_premium,
      });
      if(saveError)throw saveError;
      setNotice('حُفظت الميزة. إضافتها إلى القائمة لا تُنشئ وظيفة جديدة في التطبيق تلقائيًا.');
      setForm({key:'',title:'',description:'',enabled:true,requires_premium:true});
      await load();
    }catch(caught){setError(message(caught))}finally{setBusy(false)}
  };
  const inspectMember=async()=>{
    if(!authClient||!email.trim())return;
    setBusy(true);setError('');setNotice('');
    try{
      const {data,error:readError}=await authClient.rpc('list_member_features' as any,{p_email:email.trim()});
      if(readError)throw readError;
      setOverrides((data??[]) as Override[]);
      setInspected(true);
    }catch(caught){setError(message(caught))}finally{setBusy(false)}
  };
  const setMember=async(allowed:boolean|null)=>{
    if(!authClient||!email.trim()||busy)return;
    setBusy(true);setError('');setNotice('');
    try{
      const {error:saveError}=await authClient.rpc('set_member_feature' as any,{
        p_email:email.trim(),p_feature_key:selectedKey,p_allowed:allowed,
      });
      if(saveError)throw saveError;
      setNotice(allowed===null?'أُزيل التخصيص؛ يعود العضو للقاعدة العامة.':allowed?'مُنحت الميزة للعضو.':'سُحبت الميزة من العضو.');
      const {data,error:readError}=await authClient.rpc('list_member_features' as any,{p_email:email.trim()});
      if(readError)throw readError;
      setOverrides((data??[]) as Override[]);
      setInspected(true);
    }catch(caught){setError(message(caught))}finally{setBusy(false)}
  };
  return <section className="panel teacher-review-panel" aria-labelledby="platform-features-title">
    <h2 id="platform-features-title">مميزات المنصة واشتراكات Premium</h2>
    <p className="muted">يُمنح اشتراك Premium بعد تحقق الدفع عبر مزود معتمد. هنا يمكنك إدارة قائمة المميزات ومنح أو سحب ميزة محددة من عضو. لا تُسجل هذه اللوحة دفعًا أو اشتراكًا.</p>
    {error&&<p className="teacher-notice error" role="alert">{error}</p>}
    {notice&&<p className="teacher-notice" role="status">{notice}</p>}
    {loading?<p role="status">جارٍ تحميل المميزات…</p>:<ul className="teacher-review-list">{features.map(feature=><li key={feature.key}><strong>{feature.title}</strong><span>{feature.enabled?'مفعّلة':'معطلة'} · {feature.requires_premium?'Premium':'مجانية'}</span><button className="soft-btn" onClick={()=>setForm(feature)}>تعديل</button></li>)}</ul>}
    <form className="teacher-review-form" onSubmit={event=>void saveFeature(event)}>
      <h3>إضافة أو تعديل ميزة</h3>
      <label>رمز الميزة<input required pattern="[a-z][a-z0-9_]{2,63}" value={form.key} onChange={event=>setForm(current=>({...current,key:event.target.value}))} disabled={form.key==='circle_live'}/></label>
      <label>الاسم<input required maxLength={120} value={form.title} onChange={event=>setForm(current=>({...current,title:event.target.value}))}/></label>
      <label>الوصف<textarea maxLength={500} value={form.description} onChange={event=>setForm(current=>({...current,description:event.target.value}))}/></label>
      <label className="feature-checkbox"><input type="checkbox" checked={form.enabled} onChange={event=>setForm(current=>({...current,enabled:event.target.checked}))}/> مفعّلة</label>
      <label className="feature-checkbox"><input type="checkbox" checked={form.requires_premium} disabled={form.key==='circle_live'} onChange={event=>setForm(current=>({...current,requires_premium:event.target.checked}))}/> تتطلب Premium</label>
      <button className="primary" disabled={busy} type="submit">حفظ الميزة</button>
    </form>
    <div className="teacher-review-form">
      <h3>مميزات عضو</h3>
      <label>بريد العضو<input type="email" value={email} onChange={event=>{setEmail(event.target.value);setOverrides([]);setInspected(false)}}/></label>
      <label>الميزة<select value={selectedKey} onChange={event=>setSelectedKey(event.target.value)}>{features.map(feature=><option key={feature.key} value={feature.key}>{feature.title}</option>)}</select></label>
      <div className="teacher-review-actions"><button className="soft-btn" disabled={busy||!email.trim()} onClick={()=>void inspectMember()}>عرض التخصيصات</button><button className="primary" disabled={busy||!email.trim()} onClick={()=>void setMember(true)}>منح</button><button className="soft-btn" disabled={busy||!email.trim()} onClick={()=>void setMember(false)}>سحب</button><button className="soft-btn" disabled={busy||!email.trim()} onClick={()=>void setMember(null)}>إعادة إلى القاعدة العامة</button></div>
      {inspected&&(overrides.length>0?<ul>{overrides.map(row=><li key={row.feature_key}>{row.feature_key}: {row.allowed?'ممنوحة':'مسحوبة'}</li>)}</ul>:<p className="muted" role="status">لا توجد تخصيصات محفوظة لهذا البريد؛ قد يكون الحساب غير موجود.</p>)}
    </div>
  </section>;
}
