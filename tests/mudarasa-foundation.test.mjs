import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {applyMigrations, readMigrations} from '../scripts/database-migrations.mjs';

// AL_MUDARASA Phase 1 acceptance: create, members, invites, join requests,
// materials/parts, plan, progress, RLS, roles. Covers criteria 1-6 and 15.
test('mudarasa foundation: create, membership, invites, join, materials, plan, progress, RLS', async () => {
  const db = new PGlite({extensions: {pgcrypto}});
  const client = {query: async (sql, params) => params ? db.query(sql, params) : (await db.exec(sql)).at(-1)};
  const creator = '11111111-1111-4111-8111-111111111111';
  const supervisor = '22222222-2222-4222-8222-222222222222';
  const teacher = '33333333-3333-4333-8333-333333333333';
  const member = '44444444-4444-4444-8444-444444444444';
  const outsider = '55555555-5555-4555-8555-555555555555';
  const admin = '66666666-6666-4666-8666-666666666666';
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
    await db.exec(`insert into auth.users(id) values ('${creator}'),('${supervisor}'),('${teacher}'),('${member}'),('${outsider}'),('${admin}')`);
    await db.exec('begin');
    await applyMigrations(client, await readMigrations());
    await db.exec('commit');
    await db.query('insert into public.admin_accounts(user_id) values($1)', [admin]);
    // approve the teacher (so is_approved_teacher() returns true)
    await asUser(teacher, async () => {
      await db.query('select public.submit_teacher_application($1,$2,$3,$4,$5)', ['شيخ مدارسة', 'نبذة', 'فقه', 'مؤهلات', 'تزكية']);
    });
    await asUser(admin, async () => {
      await db.query('select public.review_teacher_application($1,$2,$3,$4,$5)', [teacher, 'approved', 'approved', 'approved', 'تم']);
    });

    // 1) إنشاء مدارسة (النوع: كتاب، متزامنة، طلب انضمام).
    let circleId = '';
    await asUser(creator, async () => {
      circleId = (await db.query('select public.create_study_circle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as id',
        ['مدارسة التوحيد', 'book', 'aqeedah', 'sync', 'وصف', 'هدف', 'approval',
         '2026-11-01', '2026-11-30', 10, 'pages', 'daily'])).rows[0].id;
      assert.match(circleId, /^[0-9a-f-]{36}$/i);
      const row = (await db.query('select * from public.study_circles where id=$1', [circleId])).rows[0];
      assert.equal(row.title, 'مدارسة التوحيد');
      assert.equal(row.kind, 'book');
      assert.equal(row.mode, 'sync');
      assert.equal(row.status, 'active');
      assert.equal(row.creator_id, creator);
      const creatorMember = (await db.query("select role from public.study_circle_members where circle_id=$1 and user_id=$2", [circleId, creator])).rows[0];
      assert.equal(creatorMember.role, 'creator');
      // تعديل
      await db.query('select public.update_study_circle($1,$2,$3)', [circleId, 'مدارسة التوحيد (محدّث)', 'وصف محدّث']);
      assert.equal((await db.query('select title,description from public.study_circles where id=$1', [circleId])).rows[0].title, 'مدارسة التوحيد (محدّث)');
      // غير المؤسس لا يعدل
      await asUser(supervisor, async () => {
        await assert.rejects(db.query('select public.update_study_circle($1,$2,$3)', [circleId, 'x', null]), e => e.code === '42501');
      });
    });

    // 2) إنشاء دعوة ( creator ) وحلها (public) without membership.
    let inviteCode = '';
    await asUser(creator, async () => {
      inviteCode = (await db.query('select public.create_study_invite($1,$2,$3) as code', [circleId, 24, 5])).rows[0].code;
      assert.match(inviteCode, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{17,20}$/);
    });
    await asUser(outsider, async () => {
      const inviteRow = (await db.query('select status, expires_at, max_uses, uses_count from public.study_circle_invites where circle_id=$1', [circleId])).rows[0];
      assert.equal(inviteRow, undefined);
      const resolved = (await db.query('select public.resolve_study_invite($1) as data', [inviteCode])).rows[0].data;
      assert.equal(resolved.status, 'valid');
      assert.equal(resolved.circle.title, 'مدارسة التوحيد (محدّث)');
      assert.equal(resolved.circle.member_count, 1);
      // لا أعضاء، لا مواد، لا روابط
      assert.equal(resolved.circle.members, undefined);
      assert.equal((await db.query('select count(*)::int as n from public.study_circle_members where circle_id=$1 and user_id=$2', [circleId, outsider])).rows[0].n, 0);
    });

    // 3) طلب الانضمام (outsider) → pending؛ لا عضوية تلقائية.
    let requestId = '';
    await asUser(outsider, async () => {
      requestId = (await db.query('select public.request_study_join($1,$2) as id', [inviteCode, 'أريد الانضمام'])).rows[0].id;
      assert.match(requestId, /^[0-9a-f-]{36}$/i);
      assert.equal((await db.query('select count(*)::int as n from public.study_circle_members where circle_id=$1 and user_id=$2', [circleId, outsider])).rows[0].n, 0);
    });

    // 4) غير المخوّل (member) لا يبتّ في الطلب.
    await db.query(`insert into public.study_circle_members(circle_id,user_id,role) values($1,$2,'member')`, [circleId, member]);
    await asUser(member, async () => {
      await assert.rejects(db.query('select public.decide_study_join_request($1,$2)', [requestId, true]), e => e.code === '42501');
    });

    // 5) المنشئ يقبل → عضوية تُنشأ، استخدام يُحسب، إشعار يُرسل.
    await asUser(creator, async () => {
      await db.query('select public.decide_study_join_request($1,$2)', [requestId, true]);
      const req = (await db.query('select status from public.study_circle_join_requests where id=$1', [requestId])).rows[0];
      assert.equal(req.status, 'accepted');
    });
    await asUser(outsider, async () => {
      assert.equal((await db.query('select count(*)::int as n from public.study_circle_members where circle_id=$1 and user_id=$2', [circleId, outsider])).rows[0].n, 1);
    });
    const usesCount = (await db.query('select uses_count from public.study_circle_invites where circle_id=$1', [circleId])).rows[0].uses_count;
    assert.equal(usesCount, 1);
    const notifs = (await db.query("select count(*)::int as n from public.notifications where recipient_id=$1 and kind='mudarasa'", [outsider])).rows[0].n;
    assert.equal(notifs, 1);

    // 6) رفض طلب لاحق.
    await db.exec(`insert into auth.users(id) values ('77777777-7777-4777-8777-777777777777')`);
    const other2 = '77777777-7777-4777-8777-777777777777';
    await asUser(other2, async () => {
      const code = (await db.query('select public.resolve_study_invite($1) as data', [inviteCode])).rows[0].data;
      assert.equal(code.status, 'valid');
      await db.query('select public.request_study_join($1)', [inviteCode]);
    });
    const rejReq = (await db.query("select id from public.study_circle_join_requests where user_id=$1 and status='pending'", [other2])).rows[0].id;
    await asUser(creator, async () => {
      await db.query('select public.decide_study_join_request($1,$2)', [rejReq, false]);
    });
    assert.equal((await db.query("select status from public.study_circle_join_requests where id=$1", [rejReq])).rows[0].status, 'rejected');
    await asUser(other2, async () => {
      assert.equal((await db.query('select count(*)::int as n from public.study_circle_members where circle_id=$1 and user_id=$2', [circleId, other2])).rows[0].n, 0);
    });

    // 7) الأدوار: المنشئ يُسند supervisor و member (teacher يتطلب اعتماد).
    await asUser(creator, async () => {
      await db.query('select public.assign_study_role($1,$2,$3)', [circleId, member, 'supervisor']);
      assert.equal((await db.query("select role from public.study_circle_members where circle_id=$1 and user_id=$2", [circleId, member])).rows[0].role, 'supervisor');
      // teacher لغير معتمد → 42501
      await assert.rejects(db.query('select public.assign_study_role($1,$2,$3)', [circleId, member, 'teacher']), e => e.code === '42501');
      // teacher لمعتمد → ok
      await db.query('select public.assign_study_role($1,$2,$3)', [circleId, teacher, 'teacher']);
      assert.equal((await db.query("select role from public.study_circle_members where circle_id=$1 and user_id=$2", [circleId, teacher])).rows[0].role, 'teacher');
      await db.query('select public.assign_study_role($1,$2,$3)', [circleId, outsider, 'member']);
      assert.equal((await db.query("select role from public.study_circle_members where circle_id=$1 and user_id=$2", [circleId, outsider])).rows[0].role, 'member');
      // دور غير صالح → 22023
      await assert.rejects(db.query('select public.assign_study_role($1,$2,$3)', [circleId, member, 'nope']), e => e.code === '22023');
    });
    await asUser(member, async () => {
      await assert.rejects(db.query('select public.assign_study_role($1,$2,$3)', [circleId, outsider, 'supervisor']), e => e.code === '42501');
    });

    // 8) إسناد دور لغير عضو → 42501.
    await asUser(creator, async () => {
      await assert.rejects(db.query('select public.assign_study_role($1,$2,$3)', [circleId, other2, 'member']), e => e.code === '42501');
    });

    // 10) المواد: إضافة (منشئ/مشرف/معلم)، قراءة (أعضاء)، إلغاء (منشئ/مشرف/معلم).
    let materialId = '';
    let partId = '';
    await asUser(creator, async () => {
      materialId = (await db.query('select public.add_study_material($1,$2,$3,$4,$5,$6) as id',
        [circleId, 'book', 'كتاب التوحيد', 'الAuthor', '', 'وصف'])).rows[0].id;
      assert.match(materialId, /^[0-9a-f-]{36}$/i);
      partId = (await db.query('select public.add_study_part($1,$2,$3,$4,$5,$6) as id',
        [materialId, 'باب 1', 1, 20, '', true])).rows[0].id;
      assert.match(partId, /^[0-9a-f-]{36}$/i);
      // member (not supervisor/teacher) cannot add material
    });
    await db.query("insert into public.study_circle_members(circle_id,user_id,role) values($1,$2,'member')", [circleId, other2]);
    await asUser(other2, async () => {
      await assert.rejects(db.query('select public.add_study_material($1,$2,$3)', [circleId, 'book', 'x']), e => e.code === '42501');
      await assert.rejects(db.query('select public.add_study_part($1,$2,$3,$4,$5,$6)', [materialId, 'x', 1, 2, '', true]), e => e.code === '42501');
      // but reads
      const mats = (await db.query('select count(*)::int as n from public.study_materials where circle_id=$1', [circleId])).rows[0].n;
      assert.equal(mats, 1);
    });
    await asUser(teacher, async () => {
      await db.query('select public.add_study_material($1,$2,$3)', [circleId, 'video', 'درس']);
    });
    await asUser(member, async () => {
      await db.query('select public.remove_study_material($1)', [materialId]);
    });

    await asUser(creator, async () => {
      // re-add a material for plan tasks
      const m2 = (await db.query('select public.add_study_material($1,$2,$3) as id', [circleId, 'book', 'كتاب 2'])).rows[0].id;
      const p2 = (await db.query('select public.add_study_part($1,$2,$3,$4,$5,$6)', [m2, 'باب 1', 1, 10, '', true])).rows[0].id;
      const res = await db.query('select public.set_study_plan($1,$2)', [circleId, JSON.stringify([
        {title: 'قراءة 10 صفحات', material_id: m2, part_id: p2, target_date: '2026-11-05'},
        {title: 'ملاحظات', target_date: null},
      ])]);
      const n = res.rows[0].set_study_plan;
      assert.equal(n, 2);
      // تعديل: تغيير عنوان المهمة 1، إضافة 3
      const res2 = await db.query('select public.set_study_plan($1,$2)', [circleId, JSON.stringify([
        {title: 'قراءة 10 صفحات (محدّث)', material_id: m2, part_id: p2, target_date: '2026-11-05'},
        {title: 'ملاحظات'},
        {title: 'مراجعة'},
      ])]);
      const n2 = res2.rows[0].set_study_plan;
      assert.equal(n2, 3);
      const tasks = (await db.query('select position,title from public.study_plan_tasks where circle_id=$1 order by position', [circleId])).rows;
      assert.equal(tasks.length, 3);
      assert.equal(tasks[0].title, 'قراءة 10 صفحات (محدّث)');
      assert.equal(tasks[2].title, 'مراجعة');
    });

    // 12) الإنجاز: عضو يُسجّل ويُلغي، والآخر لا يرى إنجازه.
    const taskId = (await db.query('select id from public.study_plan_tasks where circle_id=$1 order by position limit 1', [circleId])).rows[0].id;
    await asUser(member, async () => {
      await db.query('select public.mark_study_task($1,$2)', [taskId, true]);
      const own = (await db.query('select count(*)::int as n from public.study_task_progress where task_id=$1 and user_id=$2', [taskId, member])).rows[0].n;
      assert.equal(own, 1);
      await db.query('select public.mark_study_task($1,$2)', [taskId, false]);
      assert.equal((await db.query('select count(*)::int as n from public.study_task_progress where task_id=$1 and user_id=$2', [taskId, member])).rows[0].n, 0);
    });
    await asUser(member, async () => {
      await db.query('select public.mark_study_task($1,$2)', [taskId, true]);
    });
    await asUser(supervisor, async () => {
      // supervisor لا يرى إنجاز member (RLS owner-only)
      assert.equal((await db.query('select count(*)::int as n from public.study_task_progress where task_id=$1', [taskId])).rows[0].n, 0);
    });

    // 13) ملخص التقدم: إنجازي + إجمالي جماعي بلا أسماء.
    await asUser(member, async () => {
      const summary = (await db.query('select * from public.study_progress_summary($1)', [circleId])).rows[0];
      assert.equal(Number(summary.total_tasks), 3);
      assert.equal(Number(summary.my_completed), 1);
      assert.equal(Number(summary.members_count), 5); // creator+supervisor+teacher+member+plain member
      assert.equal(Number(summary.group_completed), 1);
    });

    // 14) غير عضو: لا يقرأ ولا يُسجّل.
    await asUser(supervisor, async () => {
      assert.equal((await db.query('select * from public.study_progress_summary($1)', [circleId])).rows.length, 0);
      await assert.rejects(db.query('select public.mark_study_task($1,$2)', [taskId, true]), e => e.code === '42501');
      assert.equal((await db.query('select count(*)::int as n from public.study_circles where id=$1', [circleId])).rows[0].n, 0);
    });

    // 15) إلغاء دعوة: رمز ملغى → resolve invalid.
    let revokedCode = '';
    await asUser(creator, async () => {
      revokedCode = (await db.query('select public.create_study_invite($1) as code', [circleId])).rows[0].code;
      const inviteId = (await db.query('select id from public.study_circle_invites where circle_id=$1 order by created_at desc limit 1', [circleId])).rows[0].id;
      const before = (await db.query('select public.resolve_study_invite($1) as data', [revokedCode])).rows[0].data;
      assert.equal(before.status, 'valid');
      await db.query('select public.revoke_study_invite($1)', [inviteId]);
    });
    await asUser(outsider, async () => {
      const after = (await db.query('select public.resolve_study_invite($1) as data', [revokedCode])).rows[0].data;
      assert.equal(after.status, 'invalid');
    });

    // 16) إيقاف المدارسة: لا مواد/دعوات/طلبات جديدة.
    await asUser(creator, async () => {
      await db.query('select public.set_study_circle_status($1,$2)', [circleId, 'paused']);
      await assert.rejects(db.query('select public.add_study_material($1,$2,$3)', [circleId, 'book', 'x']), e => e.code === 'P0001');
      await assert.rejects(db.query('select public.create_study_invite($1)', [circleId]), e => e.code === 'P0001');
      await db.query('select public.set_study_circle_status($1,$2)', [circleId, 'active']);
    });

    // 17) إكمال المدارسة: إشعار يُرسل للأعضاء.
    await asUser(creator, async () => {
      await db.query('select public.set_study_circle_status($1,$2)', [circleId, 'completed']);
    });
    const doneNotifs = (await db.query("select count(*)::int as n from public.notifications where kind='mudarasa' and title like 'اكتملت مدارسة%'")).rows[0].n;
    assert.ok(doneNotifs >= 1);

    // 18) كتابة مباشرة ممنوعة على كل الجداول.
    await asUser(member, async () => {
      await assert.rejects(db.query("insert into public.study_circles(creator_id,title,kind,category,mode) values($1,'x','book','aqeedah','sync')", [member]), e => e.code === '42501');
      await assert.rejects(db.query("insert into public.study_circle_members(circle_id,user_id,role) values($1,$2,'member')", [circleId, outsider]), e => e.code === '42501');
      await assert.rejects(db.query("insert into public.study_materials(circle_id,kind,title,added_by) values($1,'book','x',$2)", [circleId, member]), e => e.code === '42501');
      await assert.rejects(db.query("insert into public.study_plan_tasks(circle_id,position,title) values($1,99,'x')", [circleId]), e => e.code === '42501');
      await assert.rejects(db.query("insert into public.study_task_progress(task_id,circle_id,user_id) values($1,$2,$3)", [taskId, circleId, member]), e => e.code === '42501');
    });

    // 19) المدارسة الملغاة/الملغاة: إلغاء → cancelled → لا إضافة.
    await asUser(creator, async () => {
      await db.query('select public.set_study_circle_status($1,$2)', [circleId, 'cancelled']);
      await assert.rejects(db.query('select public.add_study_material($1,$2,$3)', [circleId, 'book', 'x']), e => e.code === 'P0001');
    });
  } catch (e) { console.error('FAILED:', e && e.code, e && e.message); if (e && e.query) console.error('QUERY:', e.query); throw e; } finally { await db.close(); }
});
