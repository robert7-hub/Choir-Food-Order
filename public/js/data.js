// Data + auth layer — the only file that talks to Supabase.
import { supabase, isSupabaseConfigured } from './supabase-client.js';

const CONFIG_ERROR = 'supabase-not-configured';
const ADMIN_USERNAME_DOMAIN = 'example.com';
const MEMBER_USERNAME_DOMAIN = 'members.example.com';
const MEMBER_RESET_RPC = 'admin_reset_member_password';

export const MEMBER_AUTH_ERRORS = Object.freeze({
  INVALID_NAME: 'member-invalid-name',
  INVALID_CODE: 'member-invalid-code',
  INVALID_PASSWORD: 'member-invalid-password',
  INVALID_CREDENTIALS: 'member-invalid-credentials',
  ACCOUNT_EXISTS: 'member-account-exists',
  EMAIL_CONFIRMATION_REQUIRED: 'member-email-confirmation-required',
  CODE_NOT_ALLOWED: 'member-code-not-allowed',
  CODE_ALREADY_CLAIMED: 'member-code-already-claimed'
});

export const MEMBER_RESET_ERRORS = Object.freeze({
  MEMBER_NOT_FOUND: 'member-reset-member-not-found',
  NOT_AUTHORIZED: 'member-reset-not-authorized',
  RESET_NOT_AVAILABLE: 'member-reset-not-available'
});

function normaliseMemberCode(code){
  return String(code||'')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.{2,}/g, '.')
    .slice(0, 48);
}
function memberCodeToEmail(code){
  const key = normaliseMemberCode(code);
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

export function memberCodeFromUser(user){
  const metaCode = normaliseMemberCode(user?.user_metadata?.member_code||'');
  if(metaCode) return metaCode;
  const email = String(user?.email||'').trim().toLowerCase();
  const suffix = `@${MEMBER_USERNAME_DOMAIN}`;
  if(email.endsWith(suffix)) return email.slice(0, -suffix.length);
  return '';
}

async function syncMemberProfile(user, displayName, memberCode){
  if(!user?.id || !memberCode) return;
  const client = getClient();
  const payload = {
    uid: user.id,
    member_code: memberCode,
    display_name: displayName || memberNameFromUser(user) || memberCode
  };
  const { error } = await client.from('member_profiles').upsert(payload);
  // Keep auth working even if the optional profile table is not deployed yet.
  if(error && error.code !== 'PGRST205') console.error(error);
}

/* ---------------- AUTH ---------------- */
// Members sign in with name + member code + password.
// The member code is the unique login identity.
export async function signInMember(name, memberCode, password){
  const client = getClient();
  const displayName = String(name||'').trim();
  const code = normaliseMemberCode(memberCode);
  const pass = String(password||'');
  const email = memberCodeToEmail(code);

  if(!displayName) throw new Error(MEMBER_AUTH_ERRORS.INVALID_NAME);
  if(!email) throw new Error(MEMBER_AUTH_ERRORS.INVALID_CODE);
  if(pass.length < 6) throw new Error(MEMBER_AUTH_ERRORS.INVALID_PASSWORD);

  const { data: signInData, error: signInError } = await client.auth.signInWithPassword({ email, password: pass });
  if(!signInError && signInData?.user){
    // Name and code are fixed at registration — never overwrite them on login.
    return signInData.user;
  }

  const signInMsg = String(signInError?.message||'').toLowerCase();
  if(signInMsg.includes('email not confirmed')) throw new Error(MEMBER_AUTH_ERRORS.EMAIL_CONFIRMATION_REQUIRED);
  if(isInvalidLoginMessage(signInMsg)) throw new Error(MEMBER_AUTH_ERRORS.INVALID_CREDENTIALS);
  throw signInError;
}

export async function createMemberAccount(name, memberCode, password){
  const client = getClient();
  const displayName = String(name||'').trim();
  const code = normaliseMemberCode(memberCode);
  const pass = String(password||'');
  const email = memberCodeToEmail(code);

  if(!displayName) throw new Error(MEMBER_AUTH_ERRORS.INVALID_NAME);
  if(!email) throw new Error(MEMBER_AUTH_ERRORS.INVALID_CODE);
  if(pass.length < 6) throw new Error(MEMBER_AUTH_ERRORS.INVALID_PASSWORD);

  // Check the code is on the pre-approved list before creating an auth user.
  // If the function doesn't exist yet (migration not run) we skip the check.
  const { data: codeStatus, error: codeCheckError } = await client.rpc('check_member_code_allowed', { p_code: code });
  if(codeCheckError && codeCheckError.code !== 'PGRST202'){
    throw codeCheckError;
  }
  if(codeStatus === 'not-found') throw new Error(MEMBER_AUTH_ERRORS.CODE_NOT_ALLOWED);
  if(codeStatus === 'already-claimed') throw new Error(MEMBER_AUTH_ERRORS.CODE_ALREADY_CLAIMED);

  const { data: signUpData, error: signUpError } = await client.auth.signUp({
    email,
    password: pass,
    options: { data: { display_name: displayName, member_code: code } }
  });
  if(signUpError){
    const signUpMsg = String(signUpError.message||'').toLowerCase();
    if(isAlreadyRegisteredMessage(signUpMsg)){
      throw new Error(MEMBER_AUTH_ERRORS.ACCOUNT_EXISTS);
    }
    throw signUpError;
  }
  if(signUpData?.session && signUpData?.user){
    await syncMemberProfile(signUpData.user, displayName, code);
    // Mark the code as claimed. Non-fatal if this fails — the auth account exists
    // and the member can log in; the organiser can remove stale codes manually.
    const { error: claimError } = await client.rpc('claim_member_code', { p_code: code, p_uid: signUpData.user.id });
    if(claimError) console.error('claim_member_code failed:', claimError);
    return signUpData.user;
  }

  throw new Error(MEMBER_AUTH_ERRORS.EMAIL_CONFIRMATION_REQUIRED);
}

export async function resetMemberPassword(memberCode, newPassword){
  const client = getClient();
  const code = normaliseMemberCode(memberCode);
  const pass = String(newPassword||'');
  const email = memberCodeToEmail(code);

  if(!email) throw new Error(MEMBER_AUTH_ERRORS.INVALID_CODE);
  if(pass.length < 6) throw new Error(MEMBER_AUTH_ERRORS.INVALID_PASSWORD);

  const { error } = await client.rpc(MEMBER_RESET_RPC, {
    p_member_code: code,
    p_new_password: pass
  });
  if(!error) return;

  const msg = String(error.message||'').toLowerCase();
  if(msg.includes('member-not-found')) throw new Error(MEMBER_RESET_ERRORS.MEMBER_NOT_FOUND);
  if(msg.includes('not-authorized')) throw new Error(MEMBER_RESET_ERRORS.NOT_AUTHORIZED);
  if(msg.includes('member-code-invalid')) throw new Error(MEMBER_AUTH_ERRORS.INVALID_CODE);
  if(msg.includes('password-too-short')) throw new Error(MEMBER_AUTH_ERRORS.INVALID_PASSWORD);
  if(error.code === 'PGRST202' || msg.includes(MEMBER_RESET_RPC)){
    throw new Error(MEMBER_RESET_ERRORS.RESET_NOT_AVAILABLE);
  }
  throw error;
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
    member_uid:o.uid, member_name:o.member, member_code:o.memberCode||null,
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
    uid:r.member_uid, member:r.member_name, memberCode:r.member_code||'', restId:r.rest_id, restName:r.rest_name,
    place:r.place||'', date:r.date||'', items:r.items||[], total:Number(r.total||0), placedAt:r.placed_at
  };
}

/* ---------------- ALLOWED MEMBER CODES (admin) ---------------- */
export async function getAllowedCodes(){
  const client = getClient();
  const { data, error } = await client
    .from('allowed_member_codes')
    .select('code, claimed_uid, added_at')
    .order('added_at', { ascending: true });
  if(error) throw error;
  return (data||[]).map(r=>({ code: r.code, claimed: !!r.claimed_uid, addedAt: r.added_at }));
}
export async function addAllowedCode(code){
  const client = getClient();
  const normalised = normaliseMemberCode(code);
  if(!normalised) throw new Error('invalid-code');
  const { error } = await client.from('allowed_member_codes').insert({ code: normalised });
  if(error) throw error;
  return normalised;
}
export async function removeAllowedCode(code){
  const client = getClient();
  const { error } = await client.from('allowed_member_codes').delete().eq('code', code);
  if(error) throw error;
}
