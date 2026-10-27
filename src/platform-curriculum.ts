import type {Curriculum} from './curriculum';
import {authClient} from './auth';

export async function fetchPlatformCurriculum():Promise<Curriculum|null>{
  if(!authClient)throw new Error('خدمة الحسابات غير مفعّلة.');
  const {data,error}=await authClient.from('platform_curriculum').select('payload').eq('id','main').maybeSingle();
  if(error)throw error;
  return data?.payload as Curriculum|null;
}

export async function savePlatformCurriculum(value:Curriculum,userId:string):Promise<void>{
  if(!authClient)throw new Error('خدمة الحسابات غير مفعّلة.');
  const payload={...value,progress:{}};
  const {error}=await authClient.from('platform_curriculum').upsert({id:'main',payload,updated_at:new Date().toISOString(),updated_by:userId},{onConflict:'id'});
  if(error)throw error;
}
