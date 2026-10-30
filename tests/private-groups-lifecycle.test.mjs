import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {applyMigrations, readMigrations} from '../scripts/database-migrations.mjs';

// TAW-002: إنشاء الحلقة وتعديلها وإغلاقها مهام خادمية محصورة؛ الاختبار يستنسخ
// بيئة tests/private-groups-schema.test.mjs: أدوار Supabase، auth.uid من رأس الطلب،
// وتطبيق الترحيلات كاملة داخل معاملة واحدة.
test('group lifecycle: create, founder-only edit, validation, idempotent close', async () => {
  const db = new PGlite();
  const client = {query: async (sql, params) => params ? db.query(sql, params) : (await db.exec(sql)).at(-1)};
  const founder = '11111111-1111-4111-8111-111111111111';
  const member = '22222222-2222-4222-8222-222222222222';
  const outsider = '33333333-3333-4333-8333-333333333333';
  async function asUser(id, fn) {
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    try { await fn(); } finally { await db.exec('reset role'); }
  }
  const isoDate = value => value instanceof Date ? value.toISOString().slice(0, 10) : value;
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
      alter table storage.objects enable row level security;`);
    await db.exec(`insert into auth.users(id) values ('${founder}'), ('${member}'), ('${outsider}')`);
    await db.exec('begin');
    await applyMigrations(client, await readMigrations());
    await db.exec('commit');

    // 1) الإنشاء: المجموعة صفّ وليافة المؤسس تُدرجان في العبارة نفسها، والهوية من auth.uid().
    let groupId = '';
    await asUser(founder, async () => {
      const result = await db.query(
        'select public.create_group($1,$2,$3,$4,$5,$6,$7,$8) as id',
        ['  حلقة مدارسة  ', 'book', 'وصف', 'هدف', 'قواعد', 5, '2026-11-01', null]);
      groupId = result.rows[0].id;
      assert.match(groupId, /^[0-9a-f-]{36}$/i);
      const group = (await db.query('select * from public.study_groups where id = $1', [groupId])).rows[0];
      assert.equal(group.name, 'حلقة مدارسة'); // بلا فراغات مدّة
      assert.equal(group.status, 'active');
      assert.equal(group.member_limit, 5);
      assert.equal(isoDate(group.starts_on), '2026-11-01');
      assert.equal(isoDate(group.ends_on), null);
      const founderRow = (await db.query(
        "select role from public.group_members where group_id = $1 and user_id = $2",
        [groupId, founder])).rows[0];
      assert.equal(founderRow.role, 'founder');
    });

    // 2) إنشاء المستكشف دائرة خاصة به مسموح، لكنه لا يعدّل ولا يغلق دائرة المؤسس.
    let outsiderGroup = '';
    await asUser(outsider, async () => {
      outsiderGroup = (await db.query('select public.create_group($1,$2) as id',
        ['دائرة الاستكشاف', 'friends'])).rows[0].id;
      await assert.rejects(db.query('select public.update_group($1,$2)', [groupId, 'اسم معدّل عابِر']),
        e => e.code === '42501');
      await assert.rejects(db.query('select public.close_group($1)', [groupId]), e => e.code === '42501');
      // الخصوصية: غير العضو لا يرى الدائرة أصلًا حتى في القراءة.
      const visible = (await db.query('select name from public.study_groups where id = $1', [groupId])).rows;
      assert.equal(visible.length, 0);
      assert.equal((await db.query('select count(*)::int as n from public.group_members')).rows[0].n, 1);
    });

    // 3) الكتابة المباشرة على الجداول ما زالت ممنوعة للمصادق عليهم بالمنح (المنصة عبر RPC فقط).
    await asUser(member, async () => {
      await assert.rejects(db.query(
        `insert into public.study_groups(founder_id, name, kind) values ('${member}', 'مباشر', 'friends')`),
        e => e.code === '42501');
      await assert.rejects(db.query(`update public.study_groups set name='مباشر' where id='${groupId}'`),
        e => e.code === '42501');
      // 4) غير المؤسس لا يحدّث ولا يغلق عبر الوظائف أيضًا.
      await assert.rejects(db.query('select public.update_group($1,$2)', [groupId, 'اسم غير مؤسس']),
        e => e.code === '42501');
      await assert.rejects(db.query('select public.close_group($1)', [groupId]), e => e.code === '42501');
    });

    // 5) التعديل الجزئي: الوسائط الفارغة تعني «أبقِ القيمة المخزنة».
    await asUser(founder, async () => {
      await db.query('select public.update_group($1,$2)', [groupId, 'اسم جديد']);
      const after = (await db.query('select * from public.study_groups where id = $1', [groupId])).rows[0];
      assert.equal(after.name, 'اسم جديد');
      assert.equal(after.kind, 'book');
      assert.equal(after.member_limit, 5);
      assert.equal(isoDate(after.starts_on), '2026-11-01');
      assert.equal(after.description, 'وصف');
    });

    // 6) فحوصات القيم المرفوضة برمز 22023.
    await asUser(founder, async () => {
      await assert.rejects(db.query('select public.update_group($1,$2,$3)', [groupId, null, 'نوع خاطئ']),
        e => e.code === '22023');
      await assert.rejects(db.query('select public.update_group($1,$2,$3,$4,$5,$6,$7)', [groupId, null, null, null, null, null, 1]),
        e => e.code === '22023');
      await assert.rejects(db.query('select public.update_group($1,$2,$3,$4,$5,$6,$7,$8,$9)', [groupId, null, null, null, null, null, null, '2026-01-05', '2026-01-01']),
        e => e.code === '22023');
      await assert.rejects(db.query('select public.update_group($1,$2)', [groupId, 'x'.repeat(121)]),
        e => e.code === '22023');
      await assert.rejects(db.query('select public.update_group($1,$2,$3,$4,$5,$6)', [groupId, null, null, null, null, 'w'.repeat(2001)]),
        e => e.code === '22023');
      await assert.rejects(db.query('select public.create_group($1,$2)', [null, 'friends']), e => e.code === '22023');
      await assert.rejects(db.query('select public.create_group($1,$2)', ['بدون نوع', null]), e => e.code === '22023');
      // التراجع المحتمل لم يحدث: البيانات بعد الفشل ثابتة.
      const after = (await db.query('select name, member_limit from public.study_groups where id = $1', [groupId])).rows[0];
      assert.deepEqual(after, {name: 'اسم جديد', member_limit: 5});
    });

    // 7) الإغلاق من المؤسس: نجاح، ثم عطالة، ثم رفض أي تعديل بعده.
    await asUser(founder, async () => {
      await db.query('select public.close_group($1)', [groupId]);
      assert.equal((await db.query('select status from public.study_groups where id = $1', [groupId])).rows[0].status, 'closed');
      await db.query('select public.close_group($1)', [groupId]); // الإغلاق مرة أخرى بلا خطأ ولا تغيير
      await assert.rejects(db.query('select public.update_group($1,$2)', [groupId, 'محاولة بعد الإغلاق']),
        e => e.code === 'P0001');
      const closed = (await db.query('select name from public.study_groups where id = $1', [groupId])).rows[0];
      assert.equal(closed.name, 'اسم جديد');
    });

    // 8) الإغلاق محلي على الدائرة: دائرة المستكشف باقية نشطة.
    await asUser(outsider, async () => {
      assert.equal((await db.query('select status from public.study_groups where id = $1', [outsiderGroup])).rows[0].status, 'active');
    });

    // 9) البيانات في قيم الافتراض التعاقدية: دائرة المؤسس بقواعد الحد.
    const cols = (await db.query(
      `select count(*)::int as n from information_schema.table_constraints t
        where t.table_name='study_groups' and t.constraint_type='CHECK'
          and t.constraint_name in ('description_len','goal_len','participation_rules_len')`)).rows[0].n;
    assert.equal(cols, 3);
  } finally { await db.close(); }
});
