// Runs schema.sql inside PGlite (real Postgres in WASM) with minimal
// Supabase stubs, then exercises the security rules as different users.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(path.join(here, '..', 'schema.sql'), 'utf8');

const db = new PGlite();

const stubs = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
create function storage.foldername(name text) returns text[] language sql immutable as
  $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant all on storage.objects to authenticated;
grant execute on function storage.foldername(text) to authenticated;
create publication supabase_realtime;
grant usage on schema public to authenticated, anon;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
`;

let failures = 0;
const ok = (label) => console.log('  PASS', label);
const bad = (label, e) => { failures++; console.log('  FAIL', label, e ? '-> ' + e : ''); };

async function as(uid, sql, params) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  await db.exec(uid ? 'set role authenticated' : 'set role anon');
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
}
async function expectOk(label, uid, sql, params) {
  try { const r = await as(uid, sql, params); ok(label); return r; } catch (e) { bad(label, e.message); }
}
async function expectFail(label, uid, sql, params) {
  try { await as(uid, sql, params); bad(label, 'expected an error'); } catch (e) { ok(label + ' (blocked: ' + e.message.slice(0, 60) + ')'); }
}

await db.exec(stubs);
await db.exec(schema);
console.log('Schema applied cleanly.');

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';
await db.exec(`
  insert into auth.users (id, email, raw_user_meta_data) values
  ('${A}', 'alice@example.com', '{"display_name":"Alice Moreno"}'),
  ('${B}', 'bob@example.com', '{}'),
  ('${C}', 'cara@example.com', '{"display_name":"Cara"}');
`);

console.log('\nProfiles');
const p = await expectOk('signed-in user sees all profiles', A, 'select display_name from profiles order by display_name');
if (p && p.rows.length === 3 && p.rows.some((r) => r.display_name === 'bob')) ok('signup trigger made profiles (bob from email)'); else bad('signup trigger', JSON.stringify(p?.rows));
const anonP = await as(null, 'select count(*)::int n from profiles').catch((e) => ({ err: e.message }));
if (anonP.err) ok('signed-out visitor cannot read profiles'); else bad('anon profiles', JSON.stringify(anonP.rows));
await expectOk('edit own description', A, `update profiles set description = 'Hi there' where id = '${A}'`);
const sneaky = await as(B, `update profiles set description = 'hacked' where id = '${A}' returning id`).catch((e) => ({ rows: [], err: e.message }));
if (sneaky.rows.length === 0) ok('cannot edit someone else profile'); else bad('edited other profile');
await expectOk('add own gallery photo', A, `insert into profile_photos (user_id, storage_path, url) values ('${A}', 'users/${A}/1.jpg', 'http://x/1.jpg')`);
await expectFail('cannot add photo to another profile', B, `insert into profile_photos (user_id, storage_path, url) values ('${A}', 'x', 'y')`);
const set = await as(B, 'select count(*)::int n from user_settings');
if (set.rows[0].n === 1) ok('settings are private (only own row visible)'); else bad('settings visibility', set.rows[0].n);

console.log('\nDirect messages');
const dm = await expectOk('Alice opens DM with Bob', A, `select get_or_create_direct('${B}') id`);
const dmId = dm.rows[0].id;
const dm2 = await as(B, `select get_or_create_direct('${A}') id`);
if (dm2.rows[0].id === dmId) ok('Bob gets the same DM (no duplicates)'); else bad('duplicate DM');
await expectOk('Alice sends a message', A, `insert into messages (conversation_id, sender_id, body) values ('${dmId}', '${A}', 'Hello Bob')`);
const cRead = await as(C, `select count(*)::int n from messages where conversation_id = '${dmId}'`);
if (cRead.rows[0].n === 0) ok('outsider Cara cannot read the DM'); else bad('Cara read DM');
await expectFail('Cara cannot post into the DM', C, `insert into messages (conversation_id, sender_id, body) values ('${dmId}', '${C}', 'hi')`);
await expectFail('cannot send as someone else', B, `insert into messages (conversation_id, sender_id, body) values ('${dmId}', '${A}', 'fake')`);
const list = await expectOk('Bob conversation list works', B, 'select * from get_my_conversations()');
if (list && list.rows[0]?.unread_count == 1 && list.rows[0].other_display_name === 'Alice Moreno') ok('unread count and other person correct'); else bad('conversation list', JSON.stringify(list?.rows));
await expectOk('Bob marks as read', B, `update conversation_members set last_read_at = now() where conversation_id = '${dmId}' and user_id = '${B}'`);
await expectFail('Bob cannot make himself owner', B, `update conversation_members set role = 'owner' where conversation_id = '${dmId}' and user_id = '${B}'`);

console.log('\nEdit, delete, block');
const mid = (await as(A, `select id from messages where conversation_id = '${dmId}' limit 1`)).rows[0].id;
await expectOk('Alice edits her message', A, `update messages set body = 'Hello Bob!' where id = '${mid}'`);
const ed = await as(A, `select edited_at from messages where id = '${mid}'`);
if (ed.rows[0].edited_at) ok('edited timestamp set'); else bad('edited_at');
const bEdit = await as(B, `update messages set body = 'changed' where id = '${mid}' returning id`).catch(() => ({ rows: [] }));
if (bEdit.rows.length === 0) ok('Bob cannot edit Alice message'); else bad('Bob edited');
await expectOk('Alice deletes her message', A, `update messages set deleted_at = now() where id = '${mid}'`);
const del = await as(B, `select body from messages where id = '${mid}'`);
if (del.rows[0].body === '') ok('deleted message content wiped'); else bad('content not wiped');
await expectOk('Bob blocks Alice', B, `insert into blocks (blocker_id, blocked_id) values ('${B}', '${A}')`);
await expectFail('Alice cannot message Bob after block', A, `insert into messages (conversation_id, sender_id, body) values ('${dmId}', '${A}', 'still there?')`);
await expectFail('Alice cannot open a new DM path either', A, `select get_or_create_direct('${B}')`);
const seeBlocks = await as(A, 'select count(*)::int n from blocks');
if (seeBlocks.rows[0].n === 0) ok('Alice cannot see that Bob blocked her'); else bad('block visible');
await expectOk('Bob unblocks Alice', B, `delete from blocks where blocker_id = '${B}' and blocked_id = '${A}'`);

console.log('\nPrivacy: not accepting messages');
await expectOk('Cara turns off new messages', C, `update profiles set allow_messages_from = 'nobody' where id = '${C}'`);
await expectFail('Alice cannot start a DM with Cara', A, `select get_or_create_direct('${C}')`);

console.log('\nGroups');
const g = await expectOk('Alice creates a group with Bob', A, `select create_group('Weekend Hikers', 'Trail plans', array['${B}']::uuid[]) id`);
const gid = g.rows[0].id;
await expectOk('Bob posts in the group', B, `insert into messages (conversation_id, sender_id, body) values ('${gid}', '${B}', 'Saturday?')`);
await expectFail('Bob (member) cannot add people', B, `select add_group_members('${gid}', array['${C}']::uuid[])`);
const bRename = await as(B, `update conversations set name = 'Bob group' where id = '${gid}' returning id`).catch(() => ({ rows: [] }));
if (bRename.rows.length === 0) ok('member cannot rename group'); else bad('member renamed');
await expectOk('Alice (owner) adds Cara', A, `select add_group_members('${gid}', array['${C}']::uuid[])`);
await expectOk('Alice renames the group', A, `update conversations set name = 'Hiking Crew' where id = '${gid}'`);
await expectOk('Alice promotes Bob to admin', A, `select set_member_role('${gid}', '${B}', 'admin')`);
await expectFail('Bob (admin) cannot remove the owner', B, `select remove_group_member('${gid}', '${A}')`);
await expectOk('Bob (admin) removes Cara', B, `select remove_group_member('${gid}', '${C}')`);
await expectOk('Alice leaves; ownership passes on', A, `select leave_group('${gid}')`);
const own = await as(B, `select role from conversation_members where conversation_id = '${gid}' and user_id = '${B}'`);
if (own.rows[0]?.role === 'owner') ok('Bob is now the owner'); else bad('ownership transfer', JSON.stringify(own.rows));

console.log('\nStorage rules');
await expectOk('upload to own media folder', A, `insert into storage.objects (bucket_id, name) values ('media', 'users/${A}/avatar.jpg')`);
await expectFail('cannot upload into another user folder', A, `insert into storage.objects (bucket_id, name) values ('media', 'users/${B}/avatar.jpg')`);
await expectOk('member uploads chat image', B, `insert into storage.objects (bucket_id, name) values ('chat-images', '${gid}/pic.jpg')`);
await expectFail('non-member cannot upload chat image', C, `insert into storage.objects (bucket_id, name) values ('chat-images', '${gid}/pic2.jpg')`);
const cImg = await as(C, `select count(*)::int n from storage.objects where bucket_id = 'chat-images'`);
if (cImg.rows[0].n === 0) ok('non-member cannot see chat images'); else bad('chat image leak');

console.log('\nAccount deletion');
await expectOk('Bob deletes his account', B, 'select delete_my_account()');
const gone = await db.query(`select count(*)::int n from conversations where id = '${gid}'`);
if (gone.rows[0].n === 0) ok('his now-empty group was cleaned up'); else bad('group left behind');

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
