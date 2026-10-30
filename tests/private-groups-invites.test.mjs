import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {applyMigrations, readMigrations} from '../scripts/database-migrations.mjs';

// TAW-003: روابط الدعوة العشوائية المقيدة. يُرى الرمز الخام مرة واحدة ويُخزن
// كبصمة SHA-256 فقط، مع انتهاء وسقف استخدام وإلغاء، وحل الرمز برسالة عامة
// غير كاشفة، ولا تلمس الواجهات الجدول مباشرة.
const hashOf = code => createHash('sha256').update(`RBYI-${code}`).digest('hex');

test('invite codes: random hashed tokens with expiry, cap, revoke and limited resolution', async () => {
  const db = new PGlite({extensions: {pgcrypto}});
  const client = {query: async (sql, params) => params ? db.query(sql, params) : (await db.exec(sql)).at(-1)};
  const founder = '11111111-1111-4111-8111-111111111111';
  const outsider = '33333333-3333-4333-8333-333333333333';
  async function asUser(id, fn) {
    if (id) {
      await db.exec('set role authenticated');
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    }
    try { await fn(); } finally { if (id) await db.exec('reset role'); }
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
      alter table storage.objects enable row level security;
      create extension if not exists pgcrypto;`);
    await db.exec(`insert into auth.users(id) values ('${founder}'), ('${outsider}')`);
    await db.exec('begin');
    await applyMigrations(client, await readMigrations());
    await db.exec('commit');

    // 1) الإصدار: المؤسس وحده؛ الرمز عشوائي من أبجدية بلا 0/O/1/I/L، وليلات مختلفة.
    let groupId = '';
    let codeA = '';
    let codeB = '';
    await asUser(founder, async () => {
      groupId = (await db.query('select public.create_group($1,$2) as id', ['حلقة الدعوات', 'quran'])).rows[0].id;
      codeA = (await db.query('select public.create_group_invite($1,$2,$3) as code', [groupId, 24, 5])).rows[0].code;
      codeB = (await db.query('select public.create_group_invite($1) as code', [groupId])).rows[0].code;
      assert.match(codeA, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{20}$/);
      assert.notEqual(codeA, codeB);
      const listed = (await db.query('select * from public.list_group_invites($1)', [groupId])).rows;
      assert.equal(listed.length, 2);
      assert.equal(listed[0].invite_status, 'active');
      assert.equal(listed[0].invite_max_uses, 10);
    });

    // 2) التخزين بصمة فقط، والجدول TypeScript محجوب كتابة وقراءة حتى للمصادقين.
    const rows = (await db.query('select token_hash, status, uses_count from public.group_invites where group_id = $1', [groupId])).rows;
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(r => r.token_hash).sort(), [hashOf(codeA), hashOf(codeB)].sort());
    await asUser(founder, async () => {
      await assert.rejects(db.query('select count(*)::int as n from public.group_invites'), e => e.code === '42501');
    });

    // 3) غير المؤسس: لا إصدار ولا إلغاء، والسرد يعود فارغًا (لا تسريب).
    await asUser(outsider, async () => {
      await assert.rejects(db.query('select public.create_group_invite($1)', [groupId]), e => e.code === '42501');
      await assert.rejects(db.query("select public.revoke_group_invite('00000000-0000-0000-0000-000000000000')"), e => e.code === '42501');
      assert.equal((await db.query('select * from public.list_group_invites($1)', [groupId])).rows.length, 0);
    });

    // 4) الحل المحدود لغير العضو: بيانات صفحة الدعوة فقط، لا هوية الأعضاء ولا قواعدهم.
    await asUser(outsider, async () => {
      const data = (await db.query('select public.resolve_group_invite($1) as data', [codeA])).rows[0].data;
      assert.equal(data.status, 'valid');
      assert.equal(data.group.name, 'حلقة الدعوات');
      assert.equal(data.group.kind, 'quran');
      assert.equal(data.group.member_count, 1);
      assert.equal(data.group.member_limit, 12);
      assert.equal(data.group.members, undefined);
      assert.equal(data.group.founder_id, undefined);
      assert.equal(data.group.participation_rules, undefined);
      // تخمين: رمز مشوه أو مبدّل حرف ممنوع يفشل برسالة واحدة عامة.
      for (const guess of [codeA + 'A', 'I' + codeA.slice(1), 'x'.repeat(20), '', 'ر'.repeat(20)]) {
        const bad = (await db.query('select public.resolve_group_invite($1) as data', [guess])).rows[0].data;
        assert.equal(bad.status, 'invalid');
      }
    });

    // 5) الإلغاء: الرمز الملغى يصير عديم القيمة، والآخر يبقى صالحًا، والإلغاء المتكرر آمن.
    const inviteA = (await db.query('select id from public.group_invites where token_hash = $1', [hashOf(codeA)])).rows[0].id;
    await asUser(founder, async () => {
      await db.query('select public.revoke_group_invite($1)', [inviteA]);
      await db.query('select public.revoke_group_invite($1)', [inviteA]);
      const revoked = (await db.query('select * from public.list_group_invites($1)', [groupId])).rows.find(row => row.invite_id === inviteA);
      assert.equal(revoked.invite_status, 'revoked');
    });
    await asUser(outsider, async () => {
      assert.equal((await db.query('select public.resolve_group_invite($1) as data', [codeA])).rows[0].data.status, 'invalid');
      assert.equal((await db.query('select public.resolve_group_invite($1) as data', [codeB])).rows[0].data.status, 'valid');
    });

    // 6) الانتهاء ونفاد السقف: الرابط عديم القيمة في الحالين.
    const inviteB = (await db.query('select id from public.group_invites where token_hash = $1', [hashOf(codeB)])).rows[0].id;
    await db.exec(`update public.group_invites set expires_at = now() - interval '10 minutes' where id = '${inviteB}'`);
    await asUser(outsider, async () => {
      assert.equal((await db.query('select public.resolve_group_invite($1) as data', [codeB])).rows[0].data.status, 'invalid');
    });
    await db.exec(`update public.group_invites set expires_at = now() + interval '2 hours', uses_count = max_uses where id = '${inviteB}'`);
    await asUser(outsider, async () => {
      assert.equal((await db.query('select public.resolve_group_invite($1) as data', [codeB])).rows[0].data.status, 'invalid');
    });

    // 7) الدائرة المغلقة لا تصدر دعوات، وفحص قيم المدة والسعة 22023.
    let closedGroup = '';
    await asUser(founder, async () => {
      closedGroup = (await db.query('select public.create_group($1,$2) as id', ['حلقة مغلقة', 'book'])).rows[0].id;
      await db.query('select public.close_group($1)', [closedGroup]);
      await assert.rejects(db.query('select public.create_group_invite($1)', [closedGroup]), e => e.code === 'P0001');
      await assert.rejects(db.query('select public.create_group_invite($1,$2)', [groupId, 0]), e => e.code === '22023');
      await assert.rejects(db.query('select public.create_group_invite($1,$2,$3)', [groupId, 24, 51]), e => e.code === '22023');
    });
  } finally { await db.close(); }
});
