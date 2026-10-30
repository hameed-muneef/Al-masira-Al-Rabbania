import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {applyMigrations, readMigrations} from '../scripts/database-migrations.mjs';

// TAW-010: تغطية خصوصية وصلاحيات التواصي: لا دليل عام، ولا رؤية لغير الأعضاء،
// ولا كتابة مباشرة، وسحب وصول العضو المُزال، وحدود الأدوار.
test('taw privacy: no public directory, member-only reads, role limits, access revocation', async () => {
  const db = new PGlite({extensions: {pgcrypto}});
  const client = {query: async (sql, params) => params ? db.query(sql, params) : (await db.exec(sql)).at(-1)};
  const founder = '11111111-1111-4111-8111-111111111111';
  const manager = '22222222-2222-4222-8222-222222222222';
  const member = '33333333-3333-4333-8333-333333333333';
  const outsider = '44444444-4444-4444-8444-444444444444';
  async function asUser(id, fn) {
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    try { await fn(); } finally { await db.exec('reset role'); }
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
    await db.exec(`insert into auth.users(id) values ('${founder}'),('${manager}'),('${member}'),('${outsider}')`);
    await db.exec('begin');
    await applyMigrations(client, await readMigrations());
    await db.exec('commit');

    // حلقة بمؤسس ومسؤول وعضو.
    let groupId = '';
    await asUser(founder, async () => {
      groupId = (await db.query('select public.create_group($1,$2) as id', ['حلقة الخصوصية', 'quran'])).rows[0].id;
    });
    await db.query(`insert into public.group_members(group_id,user_id,role) values
      ($1,$2,'manager'),($1,$3,'member')`, [groupId, manager, member]);

    // 1) لا دليل عام: الجداول لا تُكشف لغير الأعضاء ولا للمجهول.
    await db.exec('set role anon');
    await assert.rejects(db.query('select count(*)::int as n from public.study_groups'), e => e.code === '42501');
    await assert.rejects(db.query('select count(*)::int as n from public.group_members'), e => e.code === '42501');
    await db.exec('reset role');
    await asUser(outsider, async () => {
      assert.equal((await db.query('select count(*)::int as n from public.study_groups')).rows[0].n, 0);
      assert.equal((await db.query('select count(*)::int as n from public.group_members')).rows[0].n, 0);
    });

    // 2) العضو يرى الحلقة فقط، لا غيرها.
    await asUser(member, async () => {
      const visible = (await db.query('select id from public.study_groups')).rows.map((r) => r.id);
      assert.deepEqual(visible, [groupId]);
    });

    // 3) حدود الأدوار: العضو لا يرقّي نفسه ولا يدير الحلقة.
    await asUser(member, async () => {
      await assert.rejects(db.query("update public.group_members set role='founder' where group_id=$1 and user_id=$2", [groupId, member]), e => e.code === '42501');
      await assert.rejects(db.query('select public.update_group($1,$2)', [groupId, 'اسم']), e => e.code === '42501');
      await assert.rejects(db.query('select public.close_group($1)', [groupId]), e => e.code === '42501');
      await assert.rejects(db.query('select public.create_group_invite($1)', [groupId]), e => e.code === '42501');
    });

    // 4) المسؤول لا يرقّي نفسه إلى مؤسس، لكنه يدير طلبات الانضمام.
    await asUser(manager, async () => {
      await assert.rejects(db.query("update public.group_members set role='founder' where group_id=$1 and user_id=$2", [groupId, manager]), e => e.code === '42501');
      await assert.rejects(db.query('select public.update_group($1,$2)', [groupId, 'اسم']), e => e.code === '42501');
    });

    // 5) الكتابة المباشرة على الجداول ممنوعة لكل الأدوار (البوابات وحدها تكتب).
    await asUser(founder, async () => {
      await assert.rejects(db.query("insert into public.study_groups(founder_id,name,kind) values($1,'مباشر','friends')", [founder]), e => e.code === '42501');
      await assert.rejects(db.query("insert into public.group_members(group_id,user_id,role) values($1,$2,'member')", [groupId, outsider]), e => e.code === '42501');
      await assert.rejects(db.query("update public.study_groups set name='مباشر' where id=$1", [groupId]), e => e.code === '42501');
    });

    // 6) دعوة: الرمز يُحل بلا عضوية (رمز دعوة) لكن لا يمنح عضوية تلقائية.
    let inviteCode = '';
    await asUser(founder, async () => {
      inviteCode = (await db.query('select public.create_group_invite($1) as code', [groupId])).rows[0].code;
      assert.match(inviteCode, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{20}$/);
    });
    await asUser(outsider, async () => {
      const resolved = (await db.query('select public.resolve_group_invite($1) as data', [inviteCode])).rows[0].data;
      assert.equal(resolved.status, 'valid');
      // فتح الدعوة لا ينشئ عضوية.
      assert.equal((await db.query('select count(*)::int as n from public.group_members where group_id=$1 and user_id=$2', [groupId, outsider])).rows[0].n, 0);
    });

    // 7) طلب الانضمام: القرار للمؤسس/المسؤول، والعضوية لا تُمنح بمجرد الرابط.
    let requestId = '';
    await asUser(outsider, async () => {
      requestId = (await db.query('select public.request_group_join($1) as id', [inviteCode])).rows[0].id;
      assert.match(requestId, /^[0-9a-f-]{36}$/i);
    });
    await asUser(outsider, async () => {
      const requests = (await db.query('select count(*)::int as n from public.group_join_requests where group_id=$1', [groupId])).rows[0].n;
      assert.equal(requests, 1);
      assert.equal((await db.query('select count(*)::int as n from public.group_members where group_id=$1 and user_id=$2', [groupId, outsider])).rows[0].n, 0);
    });
    await asUser(manager, async () => {
      await db.query('select public.decide_group_join_request($1,$2)', [requestId, true]);
    });
    await asUser(outsider, async () => {
      assert.equal((await db.query('select count(*)::int as n from public.group_members where group_id=$1 and user_id=$2', [groupId, outsider])).rows[0].n, 1);
    });

    // 8) سحب وصول العضو المُزال: يفقد قراءة الحلقة فورًا.
    await db.exec(`delete from public.group_members where group_id='${groupId}' and user_id='${outsider}'`);
    await asUser(outsider, async () => {
      assert.equal((await db.query('select count(*)::int as n from public.study_groups where id=$1', [groupId])).rows[0].n, 0);
    });

    // 9) الانضمام التلقائي بالرابط ممنوع: لا عضوية بلا طلب.
    await asUser(outsider, async () => {
      assert.equal((await db.query('select count(*)::int as n from public.group_members where group_id=$1 and user_id=$2', [groupId, outsider])).rows[0].n, 0);
    });

    // 10) بلا حساب: لا إدارة للحلقة، لكن قراءة صفحة الدعوة برمزها متاحة (لا عضوية).
    await db.exec('set role anon');
    await assert.rejects(db.query('select public.create_group($1,$2)', ['س', 'friends']), e => e.code === '42501');
    await assert.rejects(db.query('select public.create_group_invite($1)', [groupId]), e => e.code === '42501');
    const anonView = (await db.query('select public.resolve_group_invite($1) as data', [inviteCode])).rows[0].data;
    assert.equal(anonView.status, 'valid');
    await db.exec('reset role');
  } finally { await db.close(); }
});
