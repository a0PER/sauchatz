// Runs schema.sql inside PGlite (real Postgres in WASM) with minimal
// Supabase stubs, then exercises the security rules as different users.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(path.join(here, '..', 'schema.sql'), 'utf8');

const db = new PGlite({ extensions: { pgcrypto } });

const stubs = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', encrypted_password text, email_confirmed_at timestamptz, created_at timestamptz default now(), updated_at timestamptz, last_sign_in_at timestamptz);
create schema extensions;
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant execute on function auth.jwt() to authenticated, anon;
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

let freshAuth = false;
async function as(uid, sql, params) {
  const claims = JSON.stringify({ sub: uid, amr: freshAuth ? [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }] : [] });
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); select set_config('request.jwt.claims', '${claims}', false);`);
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
  ('${A}', 'alice@example.com', '{"display_name":"Alice Moreno","phone":"(423) 555-0134"}'),
  ('${B}', 'bob@example.com', '{}'),
  ('${C}', 'cara@example.com', '{"display_name":"Cara"}');
`);

console.log('\nProfiles');
const p = await expectOk('signed-in user sees all profiles', A, 'select display_name from profiles order by display_name');
if (p && p.rows.length === 3 && p.rows.some((r) => r.display_name === 'New member') && !p.rows.some((r) => /bob/i.test(r.display_name))) ok('signup trigger made profiles; email never used as name'); else bad('signup trigger', JSON.stringify(p?.rows));
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


console.log('\nOptional private phone');
const myPhone = await as(A, `select phone from user_settings`);
if (myPhone.rows[0]?.phone === '14235550134' || myPhone.rows[0]?.phone === '4235550134') ok('phone saved from sign-up'); else bad('phone', JSON.stringify(myPhone.rows));
const otherPhone = await as(B, `select count(*)::int n from user_settings where phone is not null`);
if (otherPhone.rows[0].n === 0) ok('nobody else can read the phone number'); else bad('phone leak');
await expectOk('change own phone', A, `update user_settings set phone = '14235550199' where user_id = '${A}'`);
await expectFail('invalid phone rejected', A, `update user_settings set phone = 'abc' where user_id = '${A}'`);

console.log('\nPrivate profiles');
await expectOk('Cara writes profile details', C, `update profile_details set major = 'Nursing', interests = array['Hiking'] where user_id = '${C}'`);
await expectOk('Cara adds a photo', C, `insert into profile_photos (user_id, storage_path, url) values ('${C}', 'x', 'y')`);
await expectOk('Cara makes her profile private', C, `update profiles set is_public = false where id = '${C}'`);
const cd = await as(A, `select count(*)::int n from get_profile_details('${C}')`);
const cp = await as(A, `select count(*)::int n from profile_photos where user_id = '${C}'`);
if (cd.rows[0].n === 0 && cp.rows[0].n === 0) ok('stranger cannot see a private profile details or photos'); else bad('private profile leak');
const ad = await as(A, `select count(*)::int n from profile_details where user_id = '${A}'`);
if (ad.rows[0].n === 1) ok('owner sees own details'); else bad('owner details');
await expectFail('under 18 birthday rejected', A, `update profile_details set birth_date = current_date - interval '16 years' where user_id = '${A}'`);
await expectOk('18+ birthday accepted', A, `update profile_details set birth_date = '2004-05-01' where user_id = '${A}'`);
const bEditD = await as(B, `update profile_details set major = 'x' where user_id = '${A}' returning user_id`).catch(() => ({ rows: [] }));
if (bEditD.rows.length === 0) ok('details edits limited to owner'); else bad('edited other details');

console.log('\nPer-item privacy');
await expectOk('Alice adds details', A, `update profile_details set major = 'Biology', hometown = 'Dalton, GA' where user_id = '${A}'`);
await expectOk('Alice hides age and hometown', A, `update profile_details set hidden_fields = array['age','hometown'] where user_id = '${A}'`);
const seen = (await as(B, `select * from get_profile_details('${A}')`)).rows[0];
if (seen && seen.age === null && seen.hometown === null && seen.major === 'Biology') ok('hidden items removed, visible items shown'); else bad('per-item privacy', JSON.stringify(seen));
const direct = await as(B, `select count(*)::int n from profile_details where user_id = '${A}'`);
if (direct.rows[0].n === 0) ok('others cannot read the details table (or exact birthday) directly'); else bad('direct read');
await expectFail('unknown privacy item rejected', A, `update profile_details set hidden_fields = array['shoe_size'] where user_id = '${A}'`);
await expectOk('Alice adds a gallery photo', A, `insert into profile_photos (user_id, storage_path, url) values ('${A}', 'p', 'u')`);
await expectOk('Alice hides photos', A, `update profile_details set hidden_fields = array['photos'] where user_id = '${A}'`);
const bp = await as(B, `select count(*)::int n from profile_photos where user_id = '${A}'`);
const ap = await as(A, `select count(*)::int n from profile_photos where user_id = '${A}'`);
if (bp.rows[0].n === 0 && ap.rows[0].n >= 1) ok('hidden photos only visible to the owner'); else bad('photo privacy');
const ageShown = await as(A, `update profile_details set hidden_fields = '{}' where user_id = '${A}'; select age from get_profile_details('${A}')`).catch(() => null);
await as(A, `update profile_details set hidden_fields = '{}' where user_id = '${A}'`);
const age = (await as(B, `select age from get_profile_details('${A}')`)).rows[0].age;
if (age >= 18) ok('age shown (not birthday) when visible'); else bad('age', age);
await expectOk('save layout settings', A, `update user_settings set layout = '{"accent":"teal","density":"compact"}' where user_id = '${A}'`);

console.log('\nChat PIN lock');
const pinDm = (await as(A, `select get_or_create_direct('${B}') id`)).rows[0].id;
await expectFail('cannot lock a chat before setting a PIN', A, `select set_chat_locked('${pinDm}', true)`);
await expectFail('PIN must be digits', A, `select set_chat_pin('abcd')`);
const s1 = await as(A, `select set_chat_pin('1234') ok`);
if (s1.rows[0].ok) ok('set a PIN'); else bad('set pin');
const hashRead = await as(A, `select chat_pin_hash from user_settings`).catch(() => 'blocked');
if (hashRead === 'blocked') ok('PIN hash is not readable from the website'); else bad('hash readable');
const st = await as(A, `select * from pin_status()`);
if (st.rows[0].has_pin) ok('pin_status reports a PIN'); else bad('pin status');
await expectOk('lock the chat', A, `select set_chat_locked('${pinDm}', true)`);
const lockedList = (await as(A, `select locked, last_body from get_my_conversations() where id = '${pinDm}'`)).rows[0];
if (lockedList.locked && lockedList.last_body === null) ok('locked chat hides its preview'); else bad('locked preview', JSON.stringify(lockedList));
const wrong = await as(A, `select set_chat_locked('${pinDm}', false, '0000') ok`);
if (!wrong.rows[0].ok) ok('wrong PIN cannot unlock'); else bad('unlocked with wrong pin');
const change = await as(A, `select set_chat_pin('5678', '9999') ok`);
if (!change.rows[0].ok) ok('cannot change PIN without the current PIN'); else bad('pin changed');
await expectFail('cannot flip lock directly', A, `update conversation_members set locked = false where conversation_id = '${pinDm}' and user_id = '${A}'`);
for (let i = 0; i < 4; i++) await as(A, `select verify_chat_pin('0000')`);
const frozen = await as(A, `select verify_chat_pin('1234') ok`);
if (!frozen.rows[0].ok) ok('PIN freezes after 5 wrong tries'); else bad('no lockout');
await db.exec(`update user_settings set pin_locked_until = null where user_id = '${A}'`);
const right = await as(A, `select set_chat_locked('${pinDm}', false, '1234') ok`);
if (right.rows[0].ok) ok('correct PIN unlocks'); else bad('correct pin failed');
await expectFail('PIN reset needs a fresh password sign-in', A, `select reset_chat_pin()`);
freshAuth = true;
await expectOk('PIN reset after password re-entry', A, `select reset_chat_pin()`);
freshAuth = false;

console.log('\nAdmin tools');
await expectFail('non-admin cannot list users', A, `select * from admin_list_users()`);
await expectFail('non-admin cannot delete users', A, `select admin_delete_user('${C}')`);
await db.exec(`insert into admins (user_id) values ('${A}')`);
const users = await expectOk('admin lists users', A, `select * from admin_list_users()`);
if (users && users.rows.length >= 3 && users.rows.some((u) => u.login === 'cara@example.com') && users.rows.some((u) => u.phone) && !('encrypted_password' in users.rows[0])) ok('admin sees logins but never passwords'); else bad('admin list', JSON.stringify(users?.rows[0]));
await expectOk('admin sets a new password', A, `select admin_set_password('${C}', 'newpassword1')`);
const pw = await db.query(`select encrypted_password like '$2%' ok from auth.users where id = '${C}'`);
if (pw.rows[0].ok) ok('new password stored hashed'); else bad('password not hashed');
await expectOk('Bob reports Cara', B, `insert into reports (reporter_id, reported_user_id, reason) values ('${B}', '${C}', 'spam')`);
const reps = await expectOk('admin sees reports', A, `select * from admin_list_reports()`);
if (reps && reps.rows.length === 1) ok('report listed'); else bad('reports');
await expectFail('non-admin cannot see reports', B, `select * from admin_list_reports()`);
await expectOk('admin deletes Cara', A, `select admin_delete_user('${C}')`);
const cGone = await db.query(`select count(*)::int n from auth.users where id = '${C}'`);
if (cGone.rows[0].n === 0) ok('account removed'); else bad('not deleted');

console.log('\nInvites and private contacts');
const D = '00000000-0000-0000-0000-0000000000dd';
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${D}', 'dana@example.com', '{"display_name":"Dana"}')`);
await db.exec(`update profiles set is_public = false where id = '${D}'`);
const ig = (await as(A, `select create_group('Invite test', '', array['${D}']::uuid[]) id`)).rows[0].id;
const notAdded = await db.query(`select count(*)::int n from conversation_members where conversation_id = '${ig}' and user_id = '${D}'`);
if (notAdded.rows[0].n === 0) ok('cannot add a private stranger to a group'); else bad('private stranger added');
const dDm = (await as(D, `select get_or_create_direct('${A}') id`)).rows[0].id;
const pc = await as(A, `select display_name from my_private_contacts('')`);
if (pc.rows.some((r) => r.display_name === 'Dana')) ok('private person who messaged me shows up as a contact'); else bad('contacts', JSON.stringify(pc.rows));
await expectOk('add the private contact to the group', A, `select add_group_members('${ig}', array['${D}']::uuid[])`);
const added = await db.query(`select count(*)::int n from conversation_members where conversation_id = '${ig}' and user_id = '${D}'`);
if (added.rows[0].n === 1) ok('private contact added'); else bad('not added');
const code = (await as(A, `select get_group_invite('${ig}') c`)).rows[0].c;
if (code && code.length >= 12) ok('invite link created'); else bad('no code');
await expectFail('regular members cannot make invite links', D, `select get_group_invite('${ig}')`);
const info = (await as(B, `select * from get_invite_info('${code}')`)).rows[0];
if (info?.name === 'Invite test' && !info.already_member) ok('invite preview works'); else bad('preview', JSON.stringify(info));
await expectOk('join with the link', B, `select join_group_with_invite('${code}')`);
const bIn = await db.query(`select count(*)::int n from conversation_members where conversation_id = '${ig}' and user_id = '${B}'`);
if (bIn.rows[0].n === 1) ok('joined the group'); else bad('join failed');
const newCode = (await as(A, `select reset_group_invite('${ig}') c`)).rows[0].c;
await expectFail('old link stops working after reset', C, `select join_group_with_invite('${code}')`);
if (newCode !== code) ok('reset makes a new link'); else bad('same code');
const anonInfo = await as(null, `select * from get_invite_info('${newCode}')`).catch(() => 'blocked');
if (anonInfo === 'blocked') ok('signed-out visitors cannot look up groups'); else bad('anon lookup');

console.log('\nTest account admin tools');
const T = '00000000-0000-0000-0000-0000000000ee';
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${T}', 'testguy1@test.sauchatz.app', '{"display_name":"Test Guy 1"}')`);
const tp = await db.query(`select is_test from profiles where id = '${T}'`);
if (tp.rows[0].is_test) ok('test account is flagged automatically'); else bad('not flagged');
const g2 = (await as(A, `select create_group('Testers', '', array['${T}']::uuid[]) id`)).rows[0].id;
await db.exec(`insert into messages (conversation_id, sender_id, body) values ('${g2}', '${T}', 'from test'), ('${g2}', '${A}', 'from a real person')`);
const tm = await expectOk('admin lists test messages', A, `select * from admin_list_test_messages()`);
if (tm && tm.rows.length === 1 && tm.rows[0].body === 'from test') ok('only messages sent by test accounts are shown'); else bad('test messages', JSON.stringify(tm?.rows));
const tmid = tm.rows[0].id;
await expectOk('admin edits a test message', A, `select admin_edit_test_message('${tmid}', 'edited by admin')`);
const realId = (await db.query(`select id from messages where body = 'from a real person'`)).rows[0].id;
await expectFail('admin cannot edit a real person message', A, `select admin_edit_test_message('${realId}', 'hacked')`);
await expectOk('admin edits test profile', A, `select admin_update_test_profile('${T}', 'Guy Renamed', 'bio', true)`);
const tn = await db.query(`select display_name from profiles where id = '${T}'`);
if (tn.rows[0].display_name === 'Test Guy Renamed') ok('test names always keep the Test prefix'); else bad('prefix', tn.rows[0].display_name);
await expectFail('admin cannot edit a real profile with test tools', A, `select admin_update_test_profile('${B}', 'x', 'y', true)`);
await expectFail('non-admin cannot use test tools', B, `select * from admin_list_test_messages()`);
const flagHack = await as(B, `update profiles set is_test = true where id = '${B}' returning id`).catch(() => 'blocked');
if (flagHack === 'blocked') ok('people cannot mark themselves as test accounts'); else bad('is_test editable');

console.log('\nAccount deletion');
await expectOk('Bob deletes his account', B, 'select delete_my_account()');
const gone = await db.query(`select count(*)::int n from conversations where id = '${gid}'`);
if (gone.rows[0].n === 0) ok('his now-empty group was cleaned up'); else bad('group left behind');

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
