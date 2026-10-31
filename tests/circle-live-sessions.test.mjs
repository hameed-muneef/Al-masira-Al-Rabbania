import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {applyMigrations, readMigrations} from '../scripts/database-migrations.mjs';

test('circle live sessions and announcements: founder manages, members read, others denied', async () => {
  const db = new PGlite({extensions: {pgcrypto}});
  const client = {query: async (sql, params) => params ? db.query(sql, params) : (await db.exec(sql)).at(-1)};
  const founder = '11111111-1111-4111-8111-111111111111';
  const member = '22222222-2222-4222-8222-222222222222';
  const outsider = '33333333-3333-4333-8333-333333333333';
  async function asUser(id, fn) {
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    try { await fn(); } finally { await db.exec('reset role'); }
  }
  const eventBase=Date.now();
  async function recordEvent(eventId,status,expiresInMs,sequence){
    await db.exec('set role service_role');
    try{return (await db.query('select public.record_verified_subscription_event($1,$2,$3,$4,$5,$6,$7) as applied',
      ['test',eventId,'paid-member',member,status,new Date(eventBase+expiresInMs).toISOString(),new Date(eventBase+sequence*1000).toISOString()])).rows[0].applied}
    finally{await db.exec('reset role')}
  }
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema auth, public to anon, authenticated;
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid primary key, bucket_id text, name text);
      alter table storage.objects enable row level security; create extension if not exists pgcrypto;`);
    await db.exec(`insert into auth.users(id,email,email_confirmed_at) values
      ('${founder}','founder@example.test',now()),('${member}','member@example.test',now()),('${outsider}','admin@example.test',now())`);
    await db.exec('begin');
    await applyMigrations(client, await readMigrations());
    await db.exec('commit');
    await db.query('insert into public.admin_accounts(user_id) values($1)',[outsider]);
    await asUser(outsider,async()=>{
      await db.query('select public.save_platform_feature_pricing($1,$2,$3,$4,$5,$6,$7,$8)',
        ['circle_live','جلسات التواصي المباشرة','',true,true,null,null,null]);
    });
    await db.query(`insert into public.study_groups(id, founder_id, name, kind) values ('44444444-4444-4444-8444-444444444444', '${founder}', 'حلقة', 'friends')`);
    await db.query(`insert into public.group_members(group_id,user_id,role) values ('44444444-4444-4444-8444-444444444444','${founder}','founder'), ('44444444-4444-4444-8444-444444444444','${member}','member')`);
    const circleId = '44444444-4444-4444-8444-444444444444';

    // 1) founder creates session + announcement.
    let sessionId = '';
    await asUser(founder, async () => {
      sessionId = (await db.query('select public.create_circle_session($1,$2,$3,$4,$5,$6) as id',
        [circleId, 'جلسة Meet', '2026-12-02T10:00:00Z', '2026-12-02T11:00:00Z', 'https://meet.google.com/x', 'ملاحظات'])).rows[0].id;
      assert.match(sessionId, /^[0-9a-f-]{36}$/i);
      const annId = (await db.query('select public.create_circle_announcement($1,$2,$3)', [circleId, 'إعلان', 'نص'])).rows[0].create_circle_announcement;
      assert.match(annId, /^[0-9a-f-]{36}$/i);
      // invalid dates → 22023
      await assert.rejects(db.query('select public.create_circle_session($1,$2,$3,$4)', [circleId, 'x', '2026-12-02T10:00:00Z', '2026-12-02T09:00:00Z']), e => e.code === '22023');
    });

    // 2) member reads session + announcement.
    await asUser(member, async () => {
      await assert.rejects(db.query('select meeting_url from public.circle_live_sessions where circle_id=$1', [circleId]), e => e.code === '42501');
      const sessions = (await db.query('select * from public.list_circle_sessions($1)', [circleId])).rows;
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].has_meeting_link, true);
      assert.equal('meeting_url' in sessions[0], false);
      assert.equal((await db.query("select public.has_feature_access('circle_live') as allowed")).rows[0].allowed,false);
      await assert.rejects(db.query('select public.reveal_circle_meeting_url($1)',[sessionId]),e=>e.code==='42501');
      await assert.rejects(db.query('select public.record_verified_subscription_event($1,$2,$3,$4,$5,$6,$7)',
        ['test','forged','forged',member,'active',new Date(eventBase+86400000).toISOString(),new Date(eventBase).toISOString()]),e=>e.code==='42501');
      await assert.rejects(db.query('select public.set_member_feature($1,$2,$3)',['member@example.test','circle_live',true]),e=>e.code==='42501');
    });
    assert.equal(await recordEvent('paid-1','active',86400000,1),true);
    assert.equal(await recordEvent('paid-1','active',86400000,1),false);
    await db.exec('set role service_role');
    await assert.rejects(db.query('select public.record_verified_subscription_event($1,$2,$3,$4,$5,$6,$7)',
      ['test','wrong-account','paid-member',outsider,'active',new Date(eventBase+86400000).toISOString(),new Date(eventBase+1500).toISOString()]),e=>e.code==='42501');
    await db.exec('reset role');
    await asUser(member, async () => {
      assert.equal((await db.query("select public.has_feature_access('circle_live') as allowed")).rows[0].allowed,true);
      assert.equal((await db.query('select public.reveal_circle_meeting_url($1) as url', [sessionId])).rows[0].url, 'https://meet.google.com/x');
      const anns = (await db.query('select * from public.circle_announcements where circle_id=$1', [circleId])).rows;
      assert.equal(anns.length, 1);
    });
    assert.equal(await recordEvent('expired-2','active',-60000,2),true);
    await asUser(member, async () => {
      await assert.rejects(db.query('select public.reveal_circle_meeting_url($1)',[sessionId]),e=>e.code==='42501');
    });
    assert.equal(await recordEvent('renewed-3','active',86400000,3),true);

    // 3) outsider cannot read.
    await asUser(outsider, async () => {
      await assert.rejects(db.query('select * from public.list_circle_sessions($1)', [circleId]), e => e.code === '42501');
      await assert.rejects(db.query('select public.reveal_circle_meeting_url($1)', [sessionId]), e => e.code === '42501');
      assert.equal((await db.query('select count(*)::int as n from public.circle_announcements where circle_id=$1', [circleId])).rows[0].n, 0);
    });

    await db.query('delete from public.group_members where group_id=$1 and user_id=$2', [circleId, member]);
    await asUser(member, async () => {
      await assert.rejects(db.query('select public.reveal_circle_meeting_url($1)', [sessionId]), e => e.code === '42501');
    });
    await db.query("insert into public.group_members(group_id,user_id,role) values ($1,$2,'member')", [circleId, member]);
    assert.equal(await recordEvent('refund-4','refunded',86400000,4),true);
    assert.equal(await recordEvent('stale-0','active',86400000,0),true);
    await asUser(member, async () => {
      await assert.rejects(db.query('select public.reveal_circle_meeting_url($1)',[sessionId]),e=>e.code==='42501');
    });
    await asUser(outsider, async () => {
      await db.query('select public.save_platform_feature($1,$2,$3,$4,$5)',['study_circles','المدارسة','وصف',true,true]);
      await db.query('select public.save_platform_feature($1,$2,$3,$4,$5)',['circle_live','جلسات التواصي','',true,false]);
      assert.equal((await db.query("select requires_premium from public.platform_features where key='circle_live'")).rows[0].requires_premium,false);
      await db.query('select public.set_member_feature($1,$2,$3)',['member@example.test','circle_live',true]);
      assert.equal((await db.query('select * from public.list_member_features($1)',['member@example.test'])).rows.length,1);
    });
    await asUser(member, async () => {
      assert.equal((await db.query('select public.reveal_circle_meeting_url($1) as url',[sessionId])).rows[0].url,'https://meet.google.com/x');
    });
    await asUser(outsider, async () => {
      await db.query('select public.set_member_feature($1,$2,$3)',['member@example.test','circle_live',false]);
    });
    await asUser(member, async () => {
      await assert.rejects(db.query('select public.reveal_circle_meeting_url($1)',[sessionId]),e=>e.code==='42501');
    });
    assert.equal(await recordEvent('renewed-5','active',86400000,5),true);
    await asUser(member, async () => {
      await assert.rejects(db.query('select public.reveal_circle_meeting_url($1)',[sessionId]),e=>e.code==='42501');
    });
    await asUser(outsider, async () => {
      await db.query('select public.set_member_feature($1,$2,$3)',['member@example.test','circle_live',null]);
    });
    await asUser(member, async () => {
      assert.equal((await db.query('select public.reveal_circle_meeting_url($1) as url',[sessionId])).rows[0].url,'https://meet.google.com/x');
    });
    assert.equal((await db.query('select count(*)::int as n from public.member_feature_events where user_id=$1',[member])).rows[0].n,3);
    await asUser(member, async () => {
      await assert.rejects(db.query('select * from public.member_feature_events'),e=>e.code==='42501');
    });

    // 4) member cannot create session/announcement.
    await asUser(member, async () => {
      await assert.rejects(db.query('select public.create_circle_session($1,$2,$3,$4)', [circleId, 'x', '2026-12-02T10:00:00Z', '2026-12-02T11:00:00Z']), e => e.code === '42501');
      await assert.rejects(db.query('select public.create_circle_announcement($1,$2)', [circleId, 'x']), e => e.code === '42501');
    });

    // 5) cancel session: founder.
    await asUser(founder, async () => {
      await db.query('select public.cancel_circle_session($1)', [sessionId]);
      const s = (await db.query('select status from public.list_circle_sessions($1) where id=$2', [circleId, sessionId])).rows[0];
      assert.equal(s.status, 'cancelled');
      await db.query('select public.cancel_circle_session($1)', [sessionId]); // idempotent
      await assert.rejects(db.query('select public.reveal_circle_meeting_url($1)', [sessionId]), e => e.code === '42501');
    });

    // 6) non-founder cannot cancel.
    await asUser(member, async () => {
      await assert.rejects(db.query('select public.cancel_circle_session($1)', [sessionId]), e => e.code === '42501');
    });

    // 7) closed circle: no session/announcement.
    await db.query("update public.study_groups set status='closed' where id=$1", [circleId]);
    await asUser(founder, async () => {
      await assert.rejects(db.query('select public.create_circle_session($1,$2,$3,$4)', [circleId, 'x', '2026-12-02T10:00:00Z', '2026-12-02T11:00:00Z']), e => e.code === 'P0001');
      await assert.rejects(db.query('select public.create_circle_announcement($1,$2)', [circleId, 'x']), e => e.code === 'P0001');
    });

    // 8) direct writes denied.
    await asUser(member, async () => {
      await assert.rejects(db.query("insert into public.circle_live_sessions(circle_id,title,starts_at,ends_at,created_by) values($1,'x',now(),now()+interval '1 hour',$2)", [circleId, member]), e => e.code === '42501');
      await assert.rejects(db.query("insert into public.circle_announcements(circle_id,author_id,title) values($1,$2,'x')", [circleId, member]), e => e.code === '42501');
    });
  } finally { await db.close(); }
});
