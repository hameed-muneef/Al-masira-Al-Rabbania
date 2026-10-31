import {useEffect,useRef,useState,type FormEvent} from 'react';
import {authClient} from '../auth';
import '../teacher.css';

type Feature={key:string;title:string;description:string;enabled:boolean;requires_premium:boolean;price_amount:number|null;currency_code:string|null;billing_interval:string|null};
type Override={feature_key:string;allowed:boolean};
type FeatureEvent={id:string;feature_key:string;before_state:Record<string,unknown>|null;after_state:Record<string,unknown>;changed_by_email:string|null;changed_at:string};
type PermissionEvent={id:string;feature_key:string;feature_title:string;allowed:boolean|null;changed_by_email:string|null;changed_at:string};
const message=(error:unknown)=>error instanceof Error?error.message:'تعذّر تنفيذ العملية.';
const intervalName=(value:string|null)=>value==='monthly'?'شهريًا':value==='yearly'?'سنويًا':'';
const formatPrice=(feature:Feature)=>feature.price_amount===null||!feature.currency_code?'السعر غير محدد':`${new Intl.NumberFormat('ar-EG',{style:'currency',currency:feature.currency_code,maximumFractionDigits:3}).format(feature.price_amount)} ${intervalName(feature.billing_interval)}`;
const formatDate=(value:string)=>new Intl.DateTimeFormat('ar-EG',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));

export default function PlatformFeaturesPanel(){
  const editorRef=useRef<HTMLFormElement>(null);
  const [features,setFeatures]=useState<Feature[]>([]);
  const [form,setForm]=useState<Feature>({key:'',title:'',description:'',enabled:true,requires_premium:false,price_amount:null,currency_code:null,billing_interval:null});
  const [email,setEmail]=useState('');
  const [selectedKey,setSelectedKey]=useState('circle_live');
  const [overrides,setOverrides]=useState<Override[]>([]);
  const [featureEvents,setFeatureEvents]=useState<FeatureEvent[]>([]);
  const [permissionEvents,setPermissionEvents]=useState<PermissionEvent[]>([]);
  const [inspected,setInspected]=useState(false);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const load=async()=>{
    if(!authClient)return;
    setLoading(true);setError('');
    try{
      const [featureResult,eventResult]=await Promise.all([
        authClient.from('platform_features').select('key,title,description,enabled,requires_premium,price_amount,currency_code,billing_interval').order('key'),
        authClient.rpc('list_admin_platform_feature_events' as any,{p_limit:30}),
      ]);
      if(featureResult.error)throw featureResult.error;
      if(eventResult.error)throw eventResult.error;
      setFeatures((featureResult.data??[]) as Feature[]);
      setFeatureEvents((eventResult.data??[]) as FeatureEvent[]);
    }catch(caught){setError(message(caught))}
    finally{setLoading(false)}
  };
  useEffect(()=>{void load()},[]);
  const editFeature=(feature:Feature)=>{
    setForm(feature);setError('');
    requestAnimationFrame(()=>{
      editorRef.current?.scrollIntoView({behavior:'smooth',block:'center'});
      editorRef.current?.querySelector('select')?.focus({preventScroll:true});
    });
  };
  const saveFeature=async(event:FormEvent)=>{
    event.preventDefault();if(!authClient||busy)return;
    const hasPrice=String(form.price_amount??'').trim()!==''||Boolean(form.currency_code)||Boolean(form.billing_interval);
    if(form.requires_premium&&hasPrice&&(!form.price_amount||form.price_amount<=0||!form.currency_code||!form.billing_interval)){
      setError('أكمل السعر والعملة والفترة، أو اترك حقول السعر كلها فارغة.');return;
    }
    setBusy(true);setError('');setNotice('');
    try{
      const {error:saveError}=await authClient.rpc('save_platform_feature_pricing' as any,{
        p_key:form.key.trim(),p_title:form.title.trim(),p_description:form.description.trim(),
        p_enabled:form.enabled,p_requires_premium:form.requires_premium,
        p_price_amount:form.requires_premium&&hasPrice?form.price_amount:null,
        p_currency_code:form.requires_premium&&hasPrice?form.currency_code:null,
        p_billing_interval:form.requires_premium&&hasPrice?form.billing_interval:null,
      });
      if(saveError)throw saveError;
      setNotice('حُفظ إعداد الميزة والسعر. لا يُحصّل هذا الإعداد أي رسوم ولا يفعّل الدفع.');
      setForm({key:'',title:'',description:'',enabled:true,requires_premium:false,price_amount:null,currency_code:null,billing_interval:null});
      await load();
    }catch(caught){setError(message(caught))}finally{setBusy(false)}
  };
  const inspectMember=async()=>{
    if(!authClient||!email.trim())return;
    setBusy(true);setError('');setNotice('');
    try{
      const [overridesResult,eventsResult]=await Promise.all([
        authClient.rpc('list_member_features' as any,{p_email:email.trim()}),
        authClient.rpc('list_admin_member_feature_events' as any,{p_email:email.trim(),p_limit:30}),
      ]);
      if(overridesResult.error)throw overridesResult.error;
      if(eventsResult.error)throw eventsResult.error;
      setOverrides((overridesResult.data??[]) as Override[]);
      setPermissionEvents((eventsResult.data??[]) as PermissionEvent[]);
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
      const [overridesResult,eventsResult]=await Promise.all([
        authClient.rpc('list_member_features' as any,{p_email:email.trim()}),
        authClient.rpc('list_admin_member_feature_events' as any,{p_email:email.trim(),p_limit:30}),
      ]);
      if(overridesResult.error)throw overridesResult.error;
      if(eventsResult.error)throw eventsResult.error;
      setOverrides((overridesResult.data??[]) as Override[]);
      setPermissionEvents((eventsResult.data??[]) as PermissionEvent[]);
      setInspected(true);
    }catch(caught){setError(message(caught))}finally{setBusy(false)}
  };
  return <section className="panel teacher-review-panel" aria-labelledby="platform-features-title">
    <h2 id="platform-features-title">مميزات المنصة واشتراكات Premium</h2>
    <p className="muted">جميع الميزات مجانية مبدئيًا. اختر ميزة موجودة إذا أردت تغييرها إلى مدفوعة وتحديد سعرها. تبقى الحسابات والخصوصية والأمان مجانية دائمًا. هذه إعدادات فقط؛ لا يوجد تحصيل أو اشتراك فعلي حتى اختيار مزود الدفع وإتمام تكامله.</p>
    {error&&<p className="teacher-notice error" role="alert">{error}</p>}
    {notice&&<p className="teacher-notice" role="status">{notice}</p>}
    {loading?<p role="status">جارٍ تحميل المميزات…</p>:<ul className="teacher-review-list">{features.map(feature=><li key={feature.key}><strong>{feature.title}</strong><span>{feature.enabled?'مفعّلة':'معطلة'} · {feature.requires_premium?`مدفوعة · ${formatPrice(feature)}`:'مجانية'}</span><button type="button" className="soft-btn" aria-label={`تعديل ${feature.title}`} onClick={()=>editFeature(feature)}>تعديل</button></li>)}</ul>}
    <form ref={editorRef} className="teacher-review-form" onSubmit={event=>void saveFeature(event)}>
      <h3>اختيار ميزة موجودة وتعديلها</h3>
      <label>الميزة<select required value={form.key} onChange={event=>{const selected=features.find(feature=>feature.key===event.target.value);if(selected)setForm(selected)}}><option value="" disabled>اختر ميزة من المنصة</option>{features.map(feature=><option key={feature.key} value={feature.key}>{feature.title}</option>)}</select></label>
      <label>الاسم<input required maxLength={120} value={form.title} onChange={event=>setForm(current=>({...current,title:event.target.value}))}/></label>
      <label>الوصف<textarea maxLength={500} value={form.description} onChange={event=>setForm(current=>({...current,description:event.target.value}))}/></label>
      <label className="feature-checkbox"><input type="checkbox" checked={form.enabled} onChange={event=>setForm(current=>({...current,enabled:event.target.checked}))}/> مفعّلة</label>
      <label className="feature-checkbox"><input type="checkbox" checked={form.requires_premium} onChange={event=>setForm(current=>({...current,requires_premium:event.target.checked,price_amount:event.target.checked?current.price_amount:null,currency_code:event.target.checked?current.currency_code:null,billing_interval:event.target.checked?current.billing_interval:null}))}/> مدفوعة وتتطلب استحقاقًا</label>
      {form.requires_premium&&<div className="platform-price-fields"><label>السعر<input type="number" min="0.001" max="999999999.999" step="0.001" value={form.price_amount??''} onChange={event=>setForm(current=>({...current,price_amount:event.target.value===''?null:Number(event.target.value)}))} placeholder="اتركه فارغًا حتى اعتماد التسعير"/></label><label>العملة (رمز ISO)<input maxLength={3} minLength={3} pattern="[A-Za-z]{3}" value={form.currency_code??''} onChange={event=>setForm(current=>({...current,currency_code:event.target.value.toUpperCase()}))} placeholder="مثل USD أو SAR"/></label><label>فترة الاشتراك<select value={form.billing_interval??''} onChange={event=>setForm(current=>({...current,billing_interval:event.target.value||null}))}><option value="">اختر الفترة</option><option value="monthly">شهري</option><option value="yearly">سنوي</option></select></label></div>}
      <button className="primary" disabled={busy||!form.key} type="submit">حفظ الميزة</button>
    </form>
    <details className="teacher-review-form"><summary>سجل تغييرات المزايا والأسعار ({featureEvents.length})</summary>{featureEvents.length?<ul className="platform-audit-list">{featureEvents.map(event=><li key={event.id}><strong>{event.after_state.title as string} · {event.after_state.requires_premium?'مدفوعة':'مجانية'}</strong><span>{event.after_state.price_amount?`${event.after_state.price_amount} ${event.after_state.currency_code} · ${intervalName(event.after_state.billing_interval as string)}`:'بلا سعر محدد'}</span><small>{event.changed_by_email||'مشرف'} · {formatDate(event.changed_at)}</small></li>)}</ul>:<p className="muted">لا توجد تغييرات مسجلة بعد.</p>}</details>
    <div className="teacher-review-form">
      <h3>مميزات عضو</h3>
      <label>بريد العضو<input type="email" value={email} onChange={event=>{setEmail(event.target.value);setOverrides([]);setPermissionEvents([]);setInspected(false)}}/></label>
      <label>الميزة<select value={selectedKey} onChange={event=>setSelectedKey(event.target.value)}>{features.map(feature=><option key={feature.key} value={feature.key}>{feature.title}</option>)}</select></label>
      <div className="teacher-review-actions"><button className="soft-btn" disabled={busy||!email.trim()} onClick={()=>void inspectMember()}>عرض التخصيصات</button><button className="primary" disabled={busy||!email.trim()} onClick={()=>void setMember(true)}>منح</button><button className="soft-btn" disabled={busy||!email.trim()} onClick={()=>void setMember(false)}>سحب</button><button className="soft-btn" disabled={busy||!email.trim()} onClick={()=>void setMember(null)}>إعادة إلى القاعدة العامة</button></div>
      {inspected&&(overrides.length>0?<ul>{overrides.map(row=><li key={row.feature_key}>{row.feature_key}: {row.allowed?'ممنوحة':'مسحوبة'}</li>)}</ul>:<p className="muted" role="status">لا توجد تخصيصات محفوظة لهذا البريد؛ قد يكون الحساب غير موجود.</p>)}
      {inspected&&<div><h4>سجل الصلاحيات</h4>{permissionEvents.length?<ul className="platform-audit-list">{permissionEvents.map(event=><li key={event.id}><strong>{event.feature_title}</strong><span>{event.allowed===null?'إعادة للقاعدة العامة':event.allowed?'منح':'سحب'}</span><small>{event.changed_by_email||'مشرف'} · {formatDate(event.changed_at)}</small></li>)}</ul>:<p className="muted">لا توجد تغييرات مسجلة لهذا الحساب.</p>}</div>}
    </div>
  </section>;
}
