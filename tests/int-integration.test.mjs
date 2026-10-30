import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {applyMigrations, readMigrations} from '../scripts/database-migrations.mjs';

const compile=path=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const asModule=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const programImport=asModule(compile('../src/program-import.ts').replace("'./id'",JSON.stringify(asModule(compile('../src/id.ts')))));
const {buildImportedTasks, importedTaskKeys}=await import(programImport);
const today=()=>new Date().toLocaleDateString('en-CA');
const periodKey=p=>{const d=new Date();if(p==='daily')return today();if(p==='monthly')return `${d.getFullYear()}-${d.getMonth()+1}`;const start=new Date(d.getFullYear(),0,1);return `${d.getFullYear()}-W${Math.ceil((((d.getTime()-start.getTime())/86400000)+start.getDay()+1)/7)}`};
const loadFromRaw=raw=>{try{const x=JSON.parse(raw);return {...x,reflections:x.reflections??[],tasks:x.tasks??[]}}catch{return {tasks:[],reflections:[]}}};

// INT-005: اختبارات تكامل المسار: program's tasks enter the personal planner
// without duplication, personal edits do not touch others, completion stays
// per-period, and private reflection is never exposed by the program.
test('int integration: program import, dedup, personal edits, period anchoring, reflection privacy', async () => {
  const db = new PGlite({extensions: {pgcrypto}});
  const client = {query: async (sql, params) => params ? db.query(sql, params) : (await db.exec(sql)).at(-1)};
  const founder = '11111111-1111-4111-8111-111111111111';
  const member = '22222222-2222-4222-8222-222222222222';
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
    await db.exec(`insert into auth.users(id) values ('${founder}'),('${member}')`);
    await db.exec('begin');
    await applyMigrations(client, await readMigrations());
    await db.exec('commit');

    // 1) حلقة ببرنامج (TAW-007) لعضوين.
    let groupId = '';
    await asUser(founder, async () => {
      groupId = (await db.query('select public.create_group($1,$2) as id', ['حلقة المسار', 'quran'])).rows[0].id;
      await db.query('select public.save_group_program($1,$2,$3,$4)',
        [groupId, 'comprehensive', 'برنامج شامل', JSON.stringify([
          {title: 'خمس صلوات', category: 'prayer', cadence: 'daily'},
          {title: 'قراءة و��دة', category: 'quran', cadence: 'daily'},
          {title: 'درس أسبوعي', category: 'book', cadence: 'weekly'},
        ])]);
    });
    await db.query(`insert into public.group_members(group_id,user_id,role) values($1,$2,'member')`, [groupId, member]);

    // 2) العضو يقرأ برنامج الحلقة (RLS للأعضاء).
    await asUser(member, async () => {
      const program = (await db.query('select current_revision from public.group_programs where group_id=$1', [groupId])).rows[0];
      assert.ok(program);
      const tasks = (await db.query('select position,title,cadence from public.group_program_tasks where group_id=$1 and revision=$2 order by position', [groupId, program.current_revision])).rows;
      assert.equal(tasks.length, 3);
      assert.equal(tasks[0].title, 'خمس صلوات');
      assert.equal(tasks[0].cadence, 'daily');
      assert.equal(tasks[2].cadence, 'weekly');
    });

    // 3) غير العضو لا يقرأ البرنامج.
    await asUser('33333333-3333-4333-8333-333333333333', async () => {
      assert.equal((await db.query('select count(*)::int as n from public.group_program_tasks where group_id=$1', [groupId])).rows[0].n, 0);
    });

    // 4) الاستيراد يمنع الازدواج: نفس المفتاح لا يُضاف مرتين.
    const incoming = [
      {group_id: groupId, revision: 1, position: 1, title: 'خمس صلوات', cadence: 'daily'},
      {group_id: groupId, revision: 1, position: 2, title: 'قراءة و��دة', cadence: 'daily'},
      {group_id: groupId, revision: 1, position: 3, title: 'درس أسبوعي', cadence: 'weekly'},
    ];
    const first = buildImportedTasks([], incoming);
    assert.equal(first.length, 3);
    assert.equal(first[0].period, 'daily');
    assert.equal(first[2].period, 'weekly');
    assert.equal(first[0].done, false);
    assert.equal(first[0].optional, true);
    assert.deepEqual(first[0].source, {groupId, revision: 1, position: 1});
    const second = buildImportedTasks(first, incoming);
    assert.equal(second.length, 0, 'إعادة الاستيراد لا تكرر المهام');
    assert.equal(importedTaskKeys(first).size, 3);

    // 5) تعديل شخصي لا يمس مهام غيره ولا البرنامج المصدر.
    const edited = first.map(task => task.id === first[0].id ? {...task, title: 'خمس صلوات (عدّلتها)'} : task);
    assert.equal(edited[0].title, 'خمس صلوات (عدّلتها)');
    assert.equal(edited[1].title, 'قراءة و��دة');
    assert.equal(edited[2].title, 'درس أسبوعي');
    assert.deepEqual(edited[0].source, {groupId, revision: 1, position: 1});

    // 6) البرنامج المصدر في القاعدة لم يتغيّر بعد التعديل الشخصي.
    await asUser(member, async () => {
      const program = (await db.query('select current_revision from public.group_programs where group_id=$1', [groupId])).rows[0];
      const tasks = (await db.query('select title from public.group_program_tasks where group_id=$1 and revision=$2 and position=1', [groupId, program.current_revision])).rows;
      assert.equal(tasks[0].title, 'خمس صلوات');
    });

    // 7) الإنجاز يبقى مرتبطًا بالفترة: مفتاح إنجاز يومي يتغير كل يوم.
    const dailyKey = periodKey('daily');
    const weeklyKey = periodKey('weekly');
    assert.equal(dailyKey, today());
    assert.notEqual(dailyKey, weeklyKey);
    const tracked = edited.map((task, index) => ({...task, done: index === 0, doneKey: task.period === 'daily' ? dailyKey : weeklyKey}));
    assert.equal(tracked[0].doneKey, dailyKey);
    assert.equal(tracked[2].doneKey, weeklyKey);

    // 8) المحاسبة الخاصة لا تُدمج ولا تُكشف مع مهام البرنامج.
    const state = loadFromRaw(JSON.stringify({
      tasks: tracked,
      goals: [], winds: [], wirds: [], reflections: [{id: 'r1', date: today(), text: 'سرّي'}],
      lessonStep: 0, prayers: {},
    }));
    assert.equal(state.reflections.length, 1);
    assert.equal(state.reflections[0].text, 'سرّي');
    assert.equal(state.tasks.length, 3);
    assert.ok(state.tasks.every(task => task.source !== undefined));

    // 9) حفظ الحالة واستعادتها لا يفقد مصدر المهام (منع ازدواج بعد إعادة التحميل).
    const reloaded = loadFromRaw(JSON.stringify(state));
    assert.equal(reloaded.tasks.length, 3);
    const third = buildImportedTasks(reloaded.tasks, incoming);
    assert.equal(third.length, 0);
  } finally { await db.close(); }
});
