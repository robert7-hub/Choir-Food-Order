// Data + auth layer — the only file that talks to Supabase.
import { supabase, isSupabaseConfigured } from './supabase-client.js';

const CONFIG_ERROR = 'supabase-not-configured';
const ADMIN_USERNAME_DOMAIN = 'example.com';

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

/* ---------------- AUTH ---------------- */
// Members sign in anonymously (name-only flow from the UI).
export async function signInMember(){
  const client = getClient();
  const { error } = await client.auth.signInAnonymously();
  if(error) throw error;
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
  const { data } = getClient().auth.onAuthStateChange((_event, session)=> cb(session));
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
