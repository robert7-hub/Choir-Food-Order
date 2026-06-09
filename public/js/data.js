// Data + auth layer — the only file that talks to Supabase.
import { supabase, isSupabaseConfigured } from './supabase-client.js';

const CONFIG_ERROR = 'supabase-not-configured';
const ADMIN_USERNAME_DOMAIN = 'example.com';
const MEMBER_USERNAME_DOMAIN = 'members.example.com';

export const MEMBER_AUTH_ERRORS = Object.freeze({
  INVALID_NAME: 'member-invalid-name',
  INVALID_PASSWORD: 'member-invalid-password',
  INVALID_CREDENTIALS: 'member-invalid-credentials',
  EMAIL_CONFIRMATION_REQUIRED: 'member-email-confirmation-required'
});

function normaliseMemberName(name){
  return String(name||'')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.{2,}/g, '.')
    .slice(0, 48);
}
function memberNameToEmail(name){
  const key = normaliseMemberName(name);
  if(!key) return '';
  return `${key}@${MEMBER_USERNAME_DOMAIN}`;
}
function isInvalidLoginMessage(msg){
  return msg.includes('invalid login credentials') || msg.includes('invalid credentials');
}
function isAlreadyRegisteredMessage(msg){
  return msg.includes('already registered') || msg.includes('already been registered');
}

function normaliseAdminLogin(login){
  return String(login||'').trim().toLowerCase();
}
function adminLoginToEmail(login){
  const clean = normaliseAdminLogin(login);
  if(!clean) return '';
  return clean.includes('@') ? clean : `${clean}@${ADMIN_USERNAME_DOMAIN}`;
}

function getClient(){
  if(!isSupabaseConfigured || !supabase){
    throw new Error(CONFIG_ERROR);
  }
  return supabase;
}

export function isConfigured(){
  return isSupabaseConfigured;
}

export function memberNameFromUser(user){
  const display = String(user?.user_metadata?.display_name||'').trim();
  if(display) return display;
  const email = String(user?.email||'').trim().toLowerCase();
  const suffix = `@${MEMBER_USERNAME_DOMAIN}`;
  if(email.endsWith(suffix)){
    return email.slice(0, -suffix.length).replace(/\./g, ' ').trim();
  }
  return '';
}

/* ---------------- AUTH ---------------- */
// Members sign in with name + password.
// We derive a stable synthetic email from the member name.
export async function signInMember(name, password){
  const client = getClient();
  const displayName = String(name||'').trim();
  const pass = String(password||'');
  const email = memberNameToEmail(displayName);

  if(!email) throw new Error(MEMBER_AUTH_ERRORS.INVALID_NAME);
  if(pass.length < 6) throw new Error(MEMBER_AUTH_ERRORS.INVALID_PASSWORD);

  const { data: signInData, error: signInError } = await client.auth.signInWithPassword({ email, password: pass });
  if(!signInError && signInData?.user){
    const currentName = String(signInData.user.user_metadata?.display_name||'').trim();
    if(displayName && currentName !== displayName){
      await client.auth.updateUser({ data: { display_name: displayName } });
    }
    return signInData.user;
  }

  const signInMsg = String(signInError?.message||'').toLowerCase();
  if(signInMsg.includes('email not confirmed')) throw new Error(MEMBER_AUTH_ERRORS.EMAIL_CONFIRMATION_REQUIRED);
  if(!isInvalidLoginMessage(signInMsg)) throw signInError;

  const { data: signUpData, error: signUpError } = await client.auth.signUp({
    email,
    password: pass,
    options: { data: { display_name: displayName } }
  });
  if(signUpError){
    const signUpMsg = String(signUpError.message||'').toLowerCase();
    if(isAlreadyRegisteredMessage(signUpMsg) || isInvalidLoginMessage(signUpMsg)){
      throw new Error(MEMBER_AUTH_ERRORS.INVALID_CREDENTIALS);
    }
    throw signUpError;
  }
  if(signUpData?.session && signUpData?.user) return signUpData.user;

  throw new Error(MEMBER_AUTH_ERRORS.EMAIL_CONFIRMATION_REQUIRED);
}
// Organiser signs in with username + password.
// If a full email is supplied, that is used directly.
export async function signInAdmin(usernameOrEmail, password){
  const client = getClient();
  const email = adminLoginToEmail(usernameOrEmail);
  if(!email) throw new Error('admin-invalid-credentials');
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if(error) throw error;
  return data.user;
}
export async function signOutAll(){
  if(!isConfigured()) return;
  await getClient().auth.signOut();
}

// Fires once on load with the current session, then on every change.
export function onAuth(cb){
  if(!isConfigured()){
    cb(null);
    return ()=>{};
  }
  const client = getClient();
  client.auth.getSession()
    .then(({ data })=> cb(data?.session || null))
    .catch(()=> cb(null));
  const { data } = client.auth.onAuthStateChange((_event, session)=> cb(session));
  return ()=> data?.subscription?.unsubscribe?.();
}

// Is this user an organiser? (row exists in the admins table)
export async function checkAdmin(uid){
  const client = getClient();
  const { data, error } = await client.from('admins').select('uid').eq('uid', uid).maybeSingle();
  if(error) throw error;
  return !!data;
}

/* ---------------- MENU (restaurants) ---------------- */
export async function loadMenu(){
  const client = getClient();
  const { data, error } = await client
    .from('restaurants').select('*').order('date', { ascending: true });
  if(error){ console.error(error); return []; }
  return (data||[]).map(r=>({
    id:r.id, name:r.name, place:r.place||'', date:r.date||'',
    info:r.info||'', food:r.food||[], drinks:r.drinks||[]
  }));
}
export async function upsertRestaurant(r){
  const client = getClient();
  const row = {
    id:r.id, name:r.name, place:r.place||null, date:r.date||null,
    info:r.info||null, food:r.food||[], drinks:r.drinks||[]
  };
  const { error } = await client.from('restaurants').upsert(row);
  if(error) throw error;
}
export async function deleteRestaurant(id){
  const client = getClient();
  const { error } = await client.from('restaurants').delete().eq('id', id);
  if(error) throw error;
}

/* ---------------- ORDERS ---------------- */
export async function placeOrder(o){
  const client = getClient();
  // insert-only: the database has no update/delete policy, so an order is final.
  const { error } = await client.from('orders').insert({
    member_uid:o.uid, member_name:o.member,
    rest_id:o.restId, rest_name:o.restName, place:o.place||null, date:o.date||null,
    items:o.items, total:o.total, placed_at:o.placedAt || new Date().toISOString()
  });
  if(error) throw error;
}
export async function getMyOrders(uid){
  const client = getClient();
  const { data, error } = await client.from('orders').select('*').eq('member_uid', uid);
  if(error) throw error;
  return (data||[]).map(mapOrder);
}
export async function getAllOrders(){
  const client = getClient();
  const { data, error } = await client.from('orders').select('*');
  if(error) throw error;
  return (data||[]).map(mapOrder);
}
function mapOrder(r){
  return {
    uid:r.member_uid, member:r.member_name, restId:r.rest_id, restName:r.rest_name,
    place:r.place||'', date:r.date||'', items:r.items||[], total:Number(r.total||0), placedAt:r.placed_at
  };
}
