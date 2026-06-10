// Choir Tour Meals — UI. Data + auth come from data.js (Supabase).
import * as DB from './data.js?v=20260610.2';

/* ===========================================================
   CHOIR TOUR MEALS
   Admin sets up restaurants + sees every order.
   Members get two tabs (Menu / My order) and place a final,
   double-confirmed, non-editable order per restaurant.
   =========================================================== */

/* Data + auth live in data.js (Supabase). See imports at top of file. */
/* ---------- small utils ---------- */
const $ = (sel)=>document.querySelector(sel);
const el = (html)=>{ const t=document.createElement('template'); t.innerHTML=html.trim(); return t.content.firstChild; };
const esc = (s)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rid = ()=>Math.random().toString(36).slice(2,8);
function fmtMoney(n){ return 'R' + Number(n||0).toFixed(2); }
function optionDetails(it){
  const parts = [];
  const type = String(it?.type||'').trim();
  const desc = String(it?.desc||'').trim();
  if(type) parts.push(`Type: ${type}`);
  if(desc) parts.push(desc);
  return parts.join(' | ');
}
function orderItemLabel(i){
  const name = String(i?.name||'').trim();
  const itemType = String(i?.itemType||'').trim();
  return itemType ? `${name} (${itemType})` : name;
}
function plainTextLine(s){
  return String(s??'')
    .replace(/\u00a0/g, ' ')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function parseMenuOptionHeader(line){
  const clean = plainTextLine(line).replace(/^[^A-Za-z0-9]+/, '').trim();
  const m = clean.match(/^Option\s*\d+\s*[–—-]\s*(.+?)(?:\s*\((?:R|ZAR)?\s*([\d.,]+)\))?\s*$/i);
  if(!m) return null;
  const priceRaw = String(m[2]||'').replace(/,/g, '');
  const price = priceRaw ? parseFloat(priceRaw) : 0;
  return {
    name:m[1].trim(),
    price:Number.isFinite(price) && price > 0 ? price : 0
  };
}
function parseTypedMenuOptionHeader(line){
  const clean = plainTextLine(line).replace(/^[^A-Za-z0-9]+/, '').trim();
  const m = clean.match(/^(.+?)\s*[–—-]\s*(.+?)(?:\s*\((?:R|ZAR)?\s*([\d.,]+)\))?\s*$/i);
  if(!m) return null;
  const label = m[1].trim();
  const name = m[2].trim();
  const priceRaw = String(m[3]||'').replace(/,/g, '');
  const price = priceRaw ? parseFloat(priceRaw) : 0;
  if(!label || !name) return null;
  return {
    type: label,
    name,
    price:Number.isFinite(price) && price > 0 ? price : 0
  };
}
function parsePastedOptions(raw){
  const items = [];
  let current = null;
  const pushCurrent = ()=>{
    if(!current?.name) return;
    current.type = String(current.type||'').trim();
    current.desc = String(current.desc||'').trim();
    items.push(current);
  };

  String(raw||'').split(/\r?\n/).forEach(line=>{
    const trimmed = String(line||'').trim();
    if(!trimmed) return;
    const plain = plainTextLine(trimmed);
    const header = parseMenuOptionHeader(plain);
    if(header){
      pushCurrent();
      current = { id:rid(), name:header.name, type:'', price:header.price, desc:'' };
      return;
    }
    const typedHeader = parseTypedMenuOptionHeader(plain);
    if(typedHeader){
      pushCurrent();
      current = { id:rid(), name:typedHeader.name, type:typedHeader.type, price:typedHeader.price, desc:'' };
      return;
    }
    if(/^note\s*:/i.test(plain)){
      pushCurrent();
      current = null;
      return;
    }
    if(!current) return;
    const typeMatch = plain.match(/^Type\s*:\s*(.+)$/i);
    if(typeMatch){
      current.type = typeMatch[1].trim();
      return;
    }
    current.desc = current.desc ? `${current.desc} ${plain}` : plain;
  });

  pushCurrent();
  return items;
}
function dayParts(iso){
  if(!iso) return {d:'–',m:''};
  const dt = new Date(iso+'T00:00');
  if(isNaN(dt)) return {d:'–',m:''};
  return { d:String(dt.getDate()), m:dt.toLocaleString('en-ZA',{month:'short'}), full:dt.toLocaleDateString('en-ZA',{weekday:'long',day:'numeric',month:'long'}) };
}
function normaliseMemberCode(code){
  return String(code||'')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.{2,}/g, '.')
    .slice(0, 48);
}
function suggestMemberCode(name){
  return normaliseMemberCode(name);
}
const CONFIG_ERR = 'supabase-not-configured';
const isConfigError = (e)=>String(e?.message||'').includes(CONFIG_ERR);
const isSchemaError = (e)=> e?.code==='PGRST205' || /could not find the table/i.test(String(e?.message||''));
const isMemberAuthError = (e, code)=> String(e?.message||'') === code;

function bindPasswordVisibility(toggleSelector, inputSelectors){
  const toggle = $(toggleSelector);
  const selectors = Array.isArray(inputSelectors) ? inputSelectors : [inputSelectors];
  const targets = selectors.map(sel=>$(sel)).filter(Boolean);
  if(!toggle || !targets.length) return;
  const sync = ()=>{
    const type = toggle.checked ? 'text' : 'password';
    targets.forEach(target=>{ target.type = type; });
  };
  toggle.addEventListener('change', sync);
  sync();
}

/* ---------- app state ---------- */
let me = null;          // {name, slug, role:'member'|'admin'}
let menu = [];          // restaurants
let tab = 'menu';       // current tab
let cart = {};          // restId -> {itemId: qty}
const SVG = {
  menu:'<svg viewBox="0 0 24 24"><path d="M4 5h16M4 10h16M4 15h10"/></svg>',
  orders:'<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M9 12h6M9 16h6"/></svg>',
  setup:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></svg>',
  all:'<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>'
};

/* ===========================================================
   INIT
   =========================================================== */
async function init(){
  // Supabase emits the current session on subscribe, so this also handles
  // returning visitors (their sign-in persists) and fresh visitors.
  renderOnboard();
  DB.onAuth(applySession);
}
async function applySession(session){
  if(!session){ me = null; window.__rest = null; renderOnboard(); return; }
  try{
    const uid = session.user.id;
    const admin = await DB.checkAdmin(uid);
    if(!admin && session.user?.is_anonymous){
      await DB.signOutAll();
      me = null;
      window.__rest = null;
      renderOnboard();
      toast('Please sign in with your name, member code, and password.');
      return;
    }
    const memberName = DB.memberNameFromUser(session.user) || localStorage.getItem('memberName') || 'Member';
    const memberCode = DB.memberCodeFromUser(session.user) || localStorage.getItem('memberCode') || '';
    const name = admin ? 'Organiser' : memberName;
    if(!admin){
      localStorage.setItem('memberName', name);
      if(memberCode) localStorage.setItem('memberCode', memberCode);
    }
    me = { uid, name, memberCode, role: admin ? 'admin' : 'member' };
    menu = await DB.loadMenu();
    if(admin && (tab==='menu' || tab==='orders')) tab = 'setup';
    render();
  }catch(e){
    console.error(e);
    me = null;
    renderOnboard();
    if(isConfigError(e)) showSupabaseSetupHelp();
    else if(isSchemaError(e)) showSchemaSetupHelp();
    else toast('Could not load your session. Please refresh and try again.');
  }
}

/* ===========================================================
   ONBOARDING
   =========================================================== */
function renderOnboard(){
  const app = $('#app');
  app.innerHTML = '';
  const saved = localStorage.getItem('memberName') || '';
  const savedCode = localStorage.getItem('memberCode') || suggestMemberCode(saved);
  const configured = DB.isConfigured();
  const wrap = el(`
    <div class="onboard">
      <div class="obcard">
        <div class="crest">
          <div class="k">Choir Cape Tour</div>
          <div class="t">Tour Meals</div>
          <div class="s">Pre-order your meal &amp; drink for each stop</div>
        </div>
        <label class="fld"><span>Your name and surname</span>
          <input id="ob-name" class="input" placeholder="e.g. Thabo Mokoena" autocomplete="name" value="${esc(saved)}"></label>
        <label class="fld"><span>Member code (your login ID)</span>
          <input id="ob-code" class="input" placeholder="e.g. thabo.mokoena or choir.24" autocomplete="username" value="${esc(savedCode)}"></label>
        <label class="fld"><span>Password</span>
          <input id="ob-pass" class="input" type="password" placeholder="At least 6 characters" autocomplete="current-password"></label>
        <div class="authrow">
          <label class="checkline"><input id="ob-show-pass" type="checkbox"><span>Show password</span></label>
          <button class="linkbtn" id="ob-forgot" type="button">Forgot password?</button>
        </div>
        <div class="authactions">
          <button class="btn brass" id="ob-go">Log in</button>
          <button class="btn ghost" id="ob-create">Create account</button>
        </div>
        <div class="note">First time? Enter your name, choose a unique member code, then tap <b>Create account</b> once. Use <b>Log in</b> afterward.</div>
        <button class="adminlink" id="ob-admin">I'm the organiser — sign in</button>
        ${configured ? '' : '<div class="note">Supabase is not configured yet. Add your project URL and anon key in public/js/supabase-client.js, then refresh this page.</div>'}
      </div>
    </div>`);
  app.appendChild(wrap);

  const nameInput = $('#ob-name');
  const codeInput = $('#ob-code');
  let codeManuallyEdited = !!savedCode;
  if(nameInput && codeInput){
    nameInput.addEventListener('input', ()=>{
      if(!codeManuallyEdited) codeInput.value = suggestMemberCode(nameInput.value);
    });
    codeInput.addEventListener('input', ()=>{
      codeManuallyEdited = true;
    });
  }

  const setAuthBusy = (busy, mode='login')=>{
    const loginBtn = $('#ob-go');
    const createBtn = $('#ob-create');
    if(loginBtn) loginBtn.disabled = busy;
    if(createBtn) createBtn.disabled = busy;
    if(loginBtn) loginBtn.textContent = busy && mode==='login' ? 'Logging in…' : 'Log in';
    if(createBtn) createBtn.textContent = busy && mode==='create' ? 'Creating…' : 'Create account';
  };

  const collectMemberAuthFields = ()=>{
    if(!DB.isConfigured()){ showSupabaseSetupHelp(); return; }
    const name = $('#ob-name').value.trim();
    const memberCode = $('#ob-code').value.trim();
    const password = ($('#ob-pass')||{}).value || '';
    if(!name){ $('#ob-name').focus(); return; }
    if(!memberCode){ $('#ob-code').focus(); return; }
    if(!password){ $('#ob-pass').focus(); return; }
    localStorage.setItem('memberName', name);
    localStorage.setItem('memberCode', normaliseMemberCode(memberCode));
    return { name, memberCode, password };
  };

  $('#ob-go').onclick = async ()=>{
    const fields = collectMemberAuthFields();
    if(!fields) return;
    setAuthBusy(true, 'login');
    try{ await DB.signInMember(fields.name, fields.memberCode, fields.password); }   // applySession() renders on success
    catch(e){
      setAuthBusy(false, 'login');
      if(isConfigError(e)) showSupabaseSetupHelp();
      else if(isMemberAuthError(e, DB.MEMBER_AUTH_ERRORS.INVALID_NAME)){
        $('#ob-name').focus();
      } else if(isMemberAuthError(e, DB.MEMBER_AUTH_ERRORS.INVALID_CODE)){
        $('#ob-code').focus();
        toast('Choose a member code (letters/numbers)');
      } else if(isMemberAuthError(e, DB.MEMBER_AUTH_ERRORS.INVALID_PASSWORD)){
        toast('Password must be at least 6 characters');
      } else if(isMemberAuthError(e, DB.MEMBER_AUTH_ERRORS.INVALID_CREDENTIALS)){
        toast('Wrong member code or password. First time? Tap Create account.');
      } else if(isMemberAuthError(e, DB.MEMBER_AUTH_ERRORS.EMAIL_CONFIRMATION_REQUIRED)){
        toast('Disable "Confirm email" in Supabase Email provider for instant member login');
      } else if(String(e?.message||'').toLowerCase().includes('rate limit')){
        toast('Too many login attempts right now. Wait a few minutes, then try again.');
      } else {
        toast('Could not connect — check your internet');
      }
      console.error(e);
    }
  };

  $('#ob-create').onclick = async ()=>{
    const fields = collectMemberAuthFields();
    if(!fields) return;
    setAuthBusy(true, 'create');
    try{ await DB.createMemberAccount(fields.name, fields.memberCode, fields.password); }   // applySession() renders on success
    catch(e){
      setAuthBusy(false, 'create');
      if(isConfigError(e)) showSupabaseSetupHelp();
      else if(isMemberAuthError(e, DB.MEMBER_AUTH_ERRORS.INVALID_NAME)){
        $('#ob-name').focus();
      } else if(isMemberAuthError(e, DB.MEMBER_AUTH_ERRORS.INVALID_CODE)){
        $('#ob-code').focus();
        toast('Choose a member code (letters/numbers)');
      } else if(isMemberAuthError(e, DB.MEMBER_AUTH_ERRORS.INVALID_PASSWORD)){
        toast('Password must be at least 6 characters');
      } else if(isMemberAuthError(e, DB.MEMBER_AUTH_ERRORS.CODE_NOT_ALLOWED)){
        $('#ob-code').focus();
        toast('That member code isn\'t on the approved list. Ask the organiser to add it.');
      } else if(isMemberAuthError(e, DB.MEMBER_AUTH_ERRORS.CODE_ALREADY_CLAIMED)){
        $('#ob-code').focus();
        toast('That member code is already registered. Use Log in instead.');
      } else if(isMemberAuthError(e, DB.MEMBER_AUTH_ERRORS.ACCOUNT_EXISTS)){
        toast('That member code already exists. Use Log in or reset the password.');
      } else if(isMemberAuthError(e, DB.MEMBER_AUTH_ERRORS.EMAIL_CONFIRMATION_REQUIRED)){
        toast('Disable "Confirm email" in Supabase Email provider for instant member login');
      } else if(String(e?.message||'').toLowerCase().includes('rate limit')){
        toast('Too many account-creation attempts right now. Wait a few minutes, then try Create account once.');
      } else {
        toast('Could not create account right now');
      }
      console.error(e);
    }
  };

  bindPasswordVisibility('#ob-show-pass', '#ob-pass');
  const forgot = $('#ob-forgot');
  if(forgot) forgot.onclick = ()=> showForgotPassword();
  ['#ob-name','#ob-code','#ob-pass'].forEach(sel=>{
    const input = $(sel);
    if(input) input.addEventListener('keydown',e=>{ if(e.key==='Enter') $('#ob-go').click(); });
  });
  $('#ob-admin').onclick = ()=> DB.isConfigured() ? askAdminLogin() : showSupabaseSetupHelp();
}

function showForgotPassword(){
  modal({
    icon:'🛟',
    title:'Forgot your password?',
    text:'For security, only the organiser can reset member passwords.',
    custom:`<div class="note" style="text-align:left;margin:0">
      1. Ask the organiser to sign in.<br>
      2. In admin view, tap <b>Reset member password</b>.<br>
      3. Share your <b>member code</b>, then set a new password.<br>
      4. Log in with your name + member code + new password.
    </div>`,
    actions:[
      {label:'Organiser sign in', cls:'btn brass', fn:()=>{ closeModal(); askAdminLogin(); }},
      {label:'Close', cls:'btn ghost', fn:closeModal}
    ]
  });
}

function showSupabaseSetupHelp(){
  modal({
    icon:'⚙️',
    title:'Finish Supabase setup',
    text:'This app needs your Supabase project details before sign-in can work.',
    custom:`<div class="note" style="text-align:left;margin:0">
      1. Open public/js/supabase-client.js<br>
      2. Replace SUPABASE_URL and SUPABASE_ANON_KEY<br>
      3. Run supabase/schema.sql in your Supabase SQL editor<br>
      4. Refresh this page
    </div>`,
    actions:[{label:'OK', cls:'btn', fn:closeModal}]
  });
}

function showSchemaSetupHelp(){
  modal({
    icon:'🧱',
    title:'Set up database functions/tables',
    text:'Supabase auth works, but this project is missing required SQL objects.',
    custom:`<div class="note" style="text-align:left;margin:0">
      1. Open supabase/schema.sql in this project<br>
      2. Paste it into Supabase SQL Editor and run the whole file<br>
      3. In Auth Providers, enable Email sign-ins and disable Confirm email<br>
      4. Refresh this page
    </div>`,
    actions:[{label:'OK', cls:'btn', fn:closeModal}]
  });
}

function askAdminLogin(){
  modal({
    icon:'🔑', title:'Organiser sign in', text:'Sign in with your organiser username and password to manage the menu and view everyone\'s orders.',
    custom:`<label class="fld" style="text-align:left"><span>Username (or email)</span><input id="ad-login" class="input" autocomplete="username" placeholder="e.g. organiser or you@example.com"></label>
            <label class="fld" style="text-align:left"><span>Password</span><input id="ad-pass" class="input" type="password" autocomplete="current-password"></label>
            <div class="authrow"><label class="checkline"><input id="ad-show-pass" type="checkbox"><span>Show password</span></label></div>`,
    actions:[
      {label:'Sign in', cls:'btn brass', keep:true, fn:async ()=>{
        const login=($('#ad-login')||{}).value, pass=($('#ad-pass')||{}).value;
        try{
          const user = await DB.signInAdmin(login, pass);
          const admin = await DB.checkAdmin(user.id);
          if(!admin){ await DB.signOutAll(); throw new Error('not-admin'); }
          tab='setup'; closeModal();   // applySession() renders the admin view
        }catch(e){
          if(isConfigError(e)){ closeModal(); showSupabaseSetupHelp(); return; }
          const p=$('#ad-pass'); if(p){ p.style.borderColor='var(--danger)'; p.value=''; }
          toast(e.message==='not-admin' ? "That account isn't set up as an organiser" : 'Wrong username or password');
        }
      }},
      {label:'Cancel', cls:'btn ghost', fn:closeModal}
    ]
  });
  bindPasswordVisibility('#ad-show-pass', '#ad-pass');
  setTimeout(()=>{ const e=$('#ad-login'); if(e) e.focus(); },50);
}

/* ===========================================================
   MAIN SHELL
   =========================================================== */
function render(){
  const app = $('#app');
  app.innerHTML='';
  const isAdmin = me.role==='admin';
  const nav = isAdmin
    ? [['setup','Menu setup',SVG.setup],['all','All orders',SVG.all]]
    : [['menu','Menu',SVG.menu],['orders','My order',SVG.orders]];
  if(!nav.find(n=>n[0]===tab)) tab = nav[0][0];

  const shell = el(`
    <div class="shell">
      <nav class="rail">
        <div class="brand"><b>Tour Meals</b>Choir Cape Tour</div>
        ${nav.map(n=>`<button class="navbtn ${tab===n[0]?'active':''}" data-tab="${n[0]}">${n[2]}<span>${esc(n[1])}</span></button>`).join('')}
        <div class="spacer"></div>
        <div class="railfoot"><button id="signout">${isAdmin?'Exit admin':'Switch user'}</button></div>
      </nav>
      <div class="main">
        <div class="topbar">
          <h1 id="ptitle"></h1>
          <div class="topbar-actions">
            ${isAdmin?'<button class="btn ghost sm" id="admin-reset-pass">Reset member password</button>':''}
            <div class="who">${isAdmin?'Admin':'Hi'} <b>${esc(isAdmin?'Organiser':me.name)}</b></div>
          </div>
        </div>
        <div class="content" id="content"></div>
      </div>
    </div>`);
  app.appendChild(shell);
  shell.querySelectorAll('.navbtn').forEach(b=> b.onclick = ()=>{ tab=b.dataset.tab; render(); });
  $('#signout').onclick = ()=> confirmSignout();
  if(isAdmin){
    const reset = $('#admin-reset-pass');
    if(reset) reset.onclick = ()=> askAdminPasswordReset();
  }

  if(isAdmin){ tab==='all' ? renderAllOrders() : renderSetup(); }
  else { tab==='orders' ? renderMyOrders() : (window.__rest ? renderRestaurant(window.__rest) : renderMenu()); }
}

function confirmSignout(){
  const admin = me.role==='admin';
  modal({ icon: admin?'🚪':'👤', title: admin?'Exit admin?':'Switch user?',
    text: admin?'You\'ll return to the member sign-in screen.':'Your saved orders stay safe. Use your member code and password to log in again later.',
    actions:[
      {label:'Yes', cls:'btn', fn:async ()=>{ window.__rest=null; closeModal(); await DB.signOutAll(); }},
      {label:'Stay', cls:'btn ghost', fn:closeModal}
    ]});
}

function askAdminPasswordReset(prefillName=''){
  if(me?.role !== 'admin'){
    modal({
      icon:'🔒',
      title:'Organiser access required',
      text:'Only organiser accounts can reset member passwords.',
      actions:[
        {label:'Organiser sign in', cls:'btn brass', fn:()=>{ closeModal(); askAdminLogin(); }},
        {label:'Close', cls:'btn ghost', fn:closeModal}
      ]
    });
    return;
  }

  const suggestedName = String(prefillName || '').trim();
  let busy = false;
  modal({
    icon:'🔐',
    title:'Reset member password',
    text:'Set a new password for a member who forgot theirs.',
    custom:`<label class="fld" style="text-align:left"><span>Member code</span><input id="rp-code" class="input" autocomplete="username" value="${esc(suggestedName)}" placeholder="e.g. thabo.mokoena or choir.24"></label>
            <label class="fld" style="text-align:left"><span>New password</span><input id="rp-pass" class="input" type="password" autocomplete="new-password" placeholder="At least 6 characters"></label>
            <label class="fld" style="text-align:left"><span>Confirm new password</span><input id="rp-pass-confirm" class="input" type="password" autocomplete="new-password" placeholder="Re-enter the password"></label>
            <div class="authrow"><label class="checkline"><input id="rp-show-pass" type="checkbox"><span>Show passwords</span></label></div>`,
    actions:[
      {label:'Reset password', cls:'btn brass', keep:true, fn:async ()=>{
        if(busy) return;
        const memberCode = String(($('#rp-code')||{}).value || '').trim();
        const pass = String(($('#rp-pass')||{}).value || '');
        const pass2 = String(($('#rp-pass-confirm')||{}).value || '');

        if(!memberCode){
          const n = $('#rp-code');
          if(n) n.focus();
          toast('Enter the member code first');
          return;
        }
        if(pass.length < 6){
          const n = $('#rp-pass');
          if(n) n.focus();
          toast('Password must be at least 6 characters');
          return;
        }
        if(pass !== pass2){
          const n = $('#rp-pass-confirm');
          if(n) n.focus();
          toast('Passwords do not match');
          return;
        }

        busy = true;
        const btn = document.querySelector('.scrim .btn.brass');
        if(btn){ btn.disabled = true; btn.textContent = 'Resetting…'; }
        try{
          await DB.resetMemberPassword(memberCode, pass);
          closeModal();
          toast(`Password reset for ${memberCode}`);
        }catch(e){
          if(isConfigError(e)){ closeModal(); showSupabaseSetupHelp(); return; }
          if(isMemberAuthError(e, DB.MEMBER_AUTH_ERRORS.INVALID_CODE)){
            const n = $('#rp-code');
            if(n) n.focus();
            toast('Use a valid member code');
            return;
          }
          if(isMemberAuthError(e, DB.MEMBER_AUTH_ERRORS.INVALID_PASSWORD)){
            const n = $('#rp-pass');
            if(n) n.focus();
            toast('Password must be at least 6 characters');
            return;
          }
          if(String(e?.message||'') === DB.MEMBER_RESET_ERRORS.MEMBER_NOT_FOUND){
            const n = $('#rp-code');
            if(n) n.focus();
            toast('No member account found for that code');
            return;
          }
          if(String(e?.message||'') === DB.MEMBER_RESET_ERRORS.NOT_AUTHORIZED){
            toast('Only organiser accounts can reset passwords');
            return;
          }
          if(String(e?.message||'') === DB.MEMBER_RESET_ERRORS.RESET_NOT_AVAILABLE){
            closeModal();
            showSchemaSetupHelp();
            return;
          }
          toast('Could not reset password right now');
          console.error(e);
        }finally{
          busy = false;
          const activeBtn = document.querySelector('.scrim .btn.brass');
          if(activeBtn){ activeBtn.disabled = false; activeBtn.textContent = 'Reset password'; }
        }
      }},
      {label:'Cancel', cls:'btn ghost', fn:closeModal}
    ]
  });
  bindPasswordVisibility('#rp-show-pass', ['#rp-pass', '#rp-pass-confirm']);
  setTimeout(()=>{ const n=$('#rp-code'); if(n) n.focus(); },50);
}

/* ===========================================================
   MEMBER — MENU TAB
   =========================================================== */
async function renderMenu(){
  window.__rest = null;
  $('#ptitle').textContent = 'Where we\'re eating';
  const c = $('#content');
  c.innerHTML = `<p class="eyebrow">Menu</p><p class="lead">Tap a stop to choose your meal. You order once per restaurant — and it can't be changed after you save.</p>`;
  if(!menu.length){
    c.appendChild(el(`<div class="card empty">The organiser hasn't added any restaurants yet. Check back soon.</div>`));
    return;
  }
  // which restaurants has this member already ordered for?
  const mine = await myOrderMap();
  menu.forEach(r=>{
    const dp = dayParts(r.date);
    const done = !!mine[r.id];
    const card = el(`
      <div class="card rcard" data-id="${r.id}">
        <div class="day"><div class="d">${dp.d}</div><div class="m">${dp.m}</div></div>
        <div class="meta">
          <h3>${esc(r.name)}</h3>
          <div class="place">${esc(r.place||'')}${r.place&&dp.full?' · ':''}${dp.full||''}</div>
          <div style="margin-top:8px">${done?'<span class="pill locked">✓ Order placed</span>':'<span class="pill open">Tap to order</span>'}</div>
        </div>
        <div class="arrow">›</div>
      </div>`);
    card.onclick = ()=>{ window.__rest = r.id; renderRestaurant(r.id); };
    c.appendChild(card);
  });
}

/* ----- ordering screen for one restaurant ----- */
async function renderRestaurant(restId){
  const r = menu.find(x=>x.id===restId);
  if(!r){ window.__rest=null; return renderMenu(); }
  window.__rest = restId;
  const dp = dayParts(r.date);
  $('#ptitle').textContent = r.name;
  const c = $('#content');
  c.innerHTML='';
  c.appendChild(el(`<button class="btn ghost sm" id="back" style="margin-bottom:14px">‹ Back to menu</button>`));
  $('#back').onclick = ()=>{ window.__rest=null; renderMenu(); };

  // already ordered? show locked ticket
  const mine = await myOrderMap();
  if(mine[r.id]){
    c.appendChild(el(`<p class="eyebrow">Your order — final</p>`));
    c.appendChild(ticketEl(mine[r.id]));
    c.appendChild(el(`<div class="card empty">This order is locked and can't be changed. Speak to the organiser if something's wrong.</div>`));
    return;
  }

  cart[restId] = cart[restId] || { food:null, drink:null };
  c.appendChild(el(`
    <div class="card" style="display:flex;gap:14px;align-items:center;background:var(--green);color:#fff;border:0">
      <div style="text-align:center;font-family:var(--serif)"><div style="font-size:30px;font-weight:700;line-height:1">${dp.d}</div><div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;opacity:.85">${dp.m}</div></div>
      <div><div style="font-family:var(--serif);font-size:20px">${esc(r.name)}</div><div style="font-size:13px;opacity:.85">${esc(r.place||'')} ${dp.full?'· '+dp.full:''}</div></div>
    </div>`));
  if(r.info) c.appendChild(el(`<p class="lead">${esc(r.info)}</p>`));

  const food = (r.food||[]);
  const drinks = (r.drinks||[]);
  const showPrices = me?.role === 'admin';
  if(food.length){ c.appendChild(el(`<h2 class="sec">Choose your meal <span class="hint">pick one</span></h2>`)); c.appendChild(selectList(food, restId, 'food', showPrices)); }
  if(drinks.length){ c.appendChild(el(`<h2 class="sec">Choose a drink <span class="hint">pick one</span></h2>`)); c.appendChild(selectList(drinks, restId, 'drink', showPrices)); }
  if(!food.length && !drinks.length){ c.appendChild(el(`<div class="card empty">No options added for this stop yet.</div>`)); return; }

  const sumBox = el(`<div id="sumbox"></div>`);
  c.appendChild(sumBox);
  const saveBtn = el(`<button class="btn brass" id="save">Save my order</button>`);
  c.appendChild(saveBtn);
  saveBtn.onclick = ()=> startSaveFlow(r);
  refreshSummary(r);
}

function selectList(items, restId, kind, showPrices=false){
  // single-select: each member picks ONE option per category (tap again to clear)
  const box = el(`<div class="selgroup"></div>`);
  items.forEach(it=>{
    const details = optionDetails(it);
    const opt = el(`
      <button type="button" class="opt" data-id="${it.id}">
        <span class="tick" aria-hidden="true"></span>
        <span class="nm"><b>${esc(it.name)}</b>${details?`<div class="ing">${esc(details)}</div>`:''}${showPrices&&it.price?`<div class="pr">${fmtMoney(it.price)}</div>`:''}</span>
      </button>`);
    opt.onclick = ()=>{
      const cur = (cart[restId]||{})[kind];
      cart[restId][kind] = (cur===it.id) ? null : it.id;
      box.querySelectorAll('.opt').forEach(o=> o.classList.toggle('sel', o.dataset.id===cart[restId][kind]));
      refreshSummary(menu.find(x=>x.id===restId));
    };
    if((cart[restId]||{})[kind]===it.id) opt.classList.add('sel');
    box.appendChild(opt);
  });
  return box;
}

function cartLines(r){
  const sel = cart[r.id] || {};
  const lines=[]; let total=0;
  const pick=(arr,kind)=>{
    const it=(arr||[]).find(x=>x.id===sel[kind]);
    if(!it) return;
    const p=it.price||0;
    total+=p;
    lines.push({
      name:it.name,
      type:kind,
      itemType:String(it.type||'').trim(),
      qty:1,
      price:p,
      sub:p
    });
  };
  pick(r.food,'food'); pick(r.drinks,'drink');
  return {lines, total};
}

function refreshSummary(r){
  const box = $('#sumbox'); if(!box) return;
  const {lines,total} = cartLines(r);
  const showPrices = me?.role === 'admin';
  const anyPrice = (r.food||[]).concat(r.drinks||[]).some(i=>i.price);
  const save = $('#save');
  const needFood = (r.food||[]).length>0;
  const hasFood  = !!(cart[r.id]||{}).food;
  const valid = needFood ? hasFood : lines.length>0;
  if(save) save.disabled = !valid;
  if(!lines.length){
    box.innerHTML = `<div class="summary"><div class="empty">Choose your meal${(r.drinks||[]).length?' and a drink':''} above.</div></div>`;
    return;
  }
  box.innerHTML = `<div class="summary">
    ${lines.map(l=>`<div class="ln"><span>${esc(orderItemLabel(l))}</span>${showPrices&&anyPrice?`<span>${fmtMoney(l.sub)}</span>`:''}</div>`).join('')}
    ${showPrices&&anyPrice?`<div class="ln tot"><span>Total</span><span>${fmtMoney(total)}</span></div>`:''}
    ${needFood&&!hasFood?`<div class="empty" style="margin-top:6px">Please choose a meal to continue.</div>`:''}
  </div>`;
}

function buildKitchenGroups(orders){
  const order = menu.map(m=>m.id);
  const groups = {};
  orders.forEach(o=> (groups[o.restId]=groups[o.restId]||[]).push(o));
  const ids = Object.keys(groups).sort((a,b)=>{
    const ia=order.indexOf(a), ib=order.indexOf(b);
    return (ia<0?99:ia)-(ib<0?99:ib);
  });

  return ids.map(restId=>{
    const list = (groups[restId]||[]).slice().sort((a,b)=>a.member.localeCompare(b.member));
    const r = menu.find(m=>m.id===restId);
    const name = r ? r.name : (list[0]?.restName || 'Removed restaurant');
    const date = dayParts(r ? r.date : list[0]?.date);
    const tally = new Map();
    let total = 0;
    let anyPrice = false;

    list.forEach(o=>{
      (o.items||[]).forEach(i=>{
        const label = orderItemLabel(i);
        const qty = Number(i.qty||1);
        const price = Number(i.price||0);
        const sub = Number(i.sub||price*qty||0);
        anyPrice = anyPrice || price > 0 || sub > 0;
        const entry = tally.get(label) || { label, qty:0, unitPrice:price, subTotal:0 };
        entry.qty += qty;
        entry.subTotal += sub;
        if(!entry.unitPrice && price) entry.unitPrice = price;
        tally.set(label, entry);
      });
      total += Number(o.total||0);
    });

    return {
      restId,
      name,
      date,
      list,
      total,
      anyPrice,
      summary: Array.from(tally.values()).sort((a,b)=>b.qty-a.qty || a.label.localeCompare(b.label)),
    };
  });
}

/* ----- double confirmation + save ----- */
function startSaveFlow(r){
  const {lines} = cartLines(r);
  if(!lines.length) return;
  // PROMPT 1
  modal({
    icon:'📝', title:'Save this order?',
    text:`Once saved, your order for ${r.name} cannot be changed. Are you happy to save it?`,
    custom:`<div class="summary" style="text-align:left">${lines.map(l=>`<div class="ln"><span>${esc(orderItemLabel(l))}</span></div>`).join('')}</div>`,
    actions:[
      {label:'Yes, save it', cls:'btn brass', keep:true, fn:()=> confirmFinal(r)},
      {label:'Not yet', cls:'btn ghost', fn:closeModal}
    ]
  });
}
function confirmFinal(r){
  // PROMPT 2
  modal({
    icon:'⚠️', title:'Are you really, really sure?',
    text:'This is your final answer. After this you will not be able to change or add to this order.',
    actions:[
      {label:'Yes — lock it in', cls:'btn', keep:true, fn:()=> saveOrder(r)},
      {label:'Go back', cls:'btn ghost', fn:closeModal}
    ]
  });
}
async function saveOrder(r){
  const {lines,total} = cartLines(r);
  const order = {
    uid: me.uid, member: me.name,
    memberCode: me.memberCode || '',
    restId: r.id, restName: r.name, place: r.place||'', date: r.date||'',
    items: lines, total, placedAt: new Date().toISOString()
  };
  try{
    await DB.placeOrder(order);
    closeModal(); cart[r.id] = { food:null, drink:null };
    toast('Order locked in ✓'); window.__rest=null; tab='orders'; render();
  }catch(e){
    closeModal(); console.error(e);
    toast(/duplicate|unique/i.test(e.message||'') ? 'You already ordered for this stop' : 'Could not save — please try again');
  }
}

/* ===========================================================
   MEMBER — MY ORDERS TAB
   =========================================================== */
async function myOrderMap(){
  const list = await DB.getMyOrders(me.uid);
  const map = {};
  list.forEach(o=> map[o.restId]=o);
  return map;
}
async function renderMyOrders(){
  $('#ptitle').textContent = 'My order';
  const c = $('#content');
  c.innerHTML = `<p class="eyebrow">My order</p><p class="lead">Your locked orders for the tour. These are final.</p>`;
  const map = await myOrderMap();
  const list = Object.values(map).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  if(!list.length){
    c.appendChild(el(`<div class="card empty">You haven't placed any orders yet. Open the <b>Menu</b> tab to choose your meals.</div>`));
    return;
  }
  list.forEach(o=> c.appendChild(ticketEl(o)));
}

function ticketEl(o){
  const dp = dayParts(o.date);
  const anyPrice = me?.role === 'admin' && o.items.some(i=>i.price);
  return el(`
    <div class="ticket">
      <div class="stub">
        <div class="day"><div class="d">${dp.d}</div><div class="m">${dp.m}</div></div>
        <div><h3>${esc(o.restName)}</h3><div class="sub">${esc(o.place||'')} ${dp.full?'· '+dp.full:''}</div></div>
      </div>
      <div class="stamp">FINAL</div>
      <div class="body">
        ${o.items.map(i=>`<div class="row"><span><span class="q">${i.type==='drink'?'🥤':'🍽️'}</span>${esc(orderItemLabel(i))}</span>${anyPrice?`<span>${fmtMoney(i.sub)}</span>`:''}</div>`).join('')}
        ${anyPrice?`<div class="ttl"><span>Total</span><span>${fmtMoney(o.total)}</span></div>`:''}
      </div>
      <div class="foot">Placed ${new Date(o.placedAt).toLocaleString('en-ZA',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})} · cannot be changed</div>
    </div>`);
}

/* ===========================================================
   ADMIN — MENU SETUP
   =========================================================== */
function renderSetup(){
  $('#ptitle').textContent = 'Menu setup';
  const c = $('#content');
  c.innerHTML = `<p class="eyebrow">Admin</p><p class="lead">Add the restaurants the choir will visit, with the date and the food &amp; drink options members can choose from.</p>`;

  c.appendChild(el(`<h2 class="sec">Member codes</h2>`));
  const mcWrap = el(`<div id="mc-wrap"></div>`);
  c.appendChild(mcWrap);
  renderMemberCodes();

  c.appendChild(el(`<h2 class="sec">Restaurants on the tour</h2>`));
  c.appendChild(el(`<button class="btn brass" id="addr">+ Add a restaurant</button>`));
  $('#addr').onclick = ()=> editRestaurant(null);

  if(!menu.length){ c.appendChild(el(`<div class="card empty">No restaurants yet — add your first one above.</div>`)); return; }
  menu.forEach(r=>{
    const dp = dayParts(r.date);
    const card = el(`
      <div class="card">
        <div style="display:flex;gap:12px;align-items:flex-start">
          <div class="day" style="flex:0 0 54px;text-align:center;background:var(--green);color:#fff;border-radius:10px;padding:8px 4px;font-family:var(--serif)">
            <div style="font-size:20px;font-weight:700;line-height:1">${dp.d}</div><div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;opacity:.85">${dp.m}</div></div>
          <div style="flex:1;min-width:0">
            <h3 style="font-family:var(--serif);margin:0;font-size:18px">${esc(r.name)}</h3>
            <div style="font-size:13px;color:var(--muted)">${esc(r.place||'')} ${dp.full?'· '+dp.full:''}</div>
            <div style="font-size:12.5px;color:var(--muted);margin-top:4px">${(r.food||[]).length} food · ${(r.drinks||[]).length} drinks</div>
          </div>
        </div>
        <div style="display:flex;gap:10px;margin-top:12px">
          <button class="btn ghost sm" data-edit="${r.id}">Edit</button>
          <button class="btn danger sm" data-del="${r.id}">Delete</button>
        </div>
      </div>`);
    card.querySelector('[data-edit]').onclick = ()=> editRestaurant(r.id);
    card.querySelector('[data-del]').onclick = ()=> delRestaurant(r);
    c.appendChild(card);
  });
}

async function renderMemberCodes(){
  const wrap = $('#mc-wrap');
  if(!wrap) return;
  wrap.innerHTML = '<div class="card empty">Loading…</div>';

  let codes;
  try{ codes = await DB.getAllowedCodes(); }
  catch(e){
    wrap.innerHTML = '<div class="card empty">Could not load member codes.</div>';
    console.error(e);
    return;
  }

  wrap.innerHTML = '';

  // Add form (single + bulk)
  const addCard = el(`
    <div class="card">
      <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
        <label class="fld" style="flex:1;min-width:180px;margin:0">
          <span>Add member code</span>
          <input class="input" id="mc-code" placeholder="e.g. thabo.mokoena">
        </label>
        <button class="btn brass sm" id="mc-add" style="width:auto">Add</button>
      </div>
      <label class="fld" style="margin:10px 0 0">
        <span>Or paste a list (one code per line)</span>
        <textarea class="input" id="mc-bulk" rows="3" placeholder="jane.smith&#10;peter.jones&#10;choir.member24"></textarea>
      </label>
      <button class="btn ghost sm" id="mc-bulk-add" style="margin-top:8px;width:auto">Import list</button>
      <div class="note" style="margin-top:8px">Members can only create accounts using a code on this list. Each code can only be claimed once.</div>
    </div>`);
  wrap.appendChild(addCard);

  const addOne = async (raw)=>{
    if(!raw) return false;
    try{
      const added = await DB.addAllowedCode(raw);
      return added;
    }catch(e){
      if(/duplicate|unique|already/i.test(String(e?.message||''))) return null; // already exists — silently skip
      throw e;
    }
  };

  $('#mc-add').onclick = async ()=>{
    const inp = $('#mc-code');
    const raw = (inp?.value||'').trim();
    if(!raw){ inp?.focus(); toast('Enter a member code first'); return; }
    try{
      const added = await addOne(raw);
      if(added === false){ inp?.focus(); toast('Invalid code'); return; }
      if(added === null){ toast(`${normaliseMemberCode(raw)} is already on the list`); inp.value=''; return; }
      inp.value = '';
      toast(`Added: ${added}`);
      renderMemberCodes();
    }catch(e){ toast('Could not add code'); console.error(e); }
  };
  $('#mc-code').addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); $('#mc-add').click(); } });

  $('#mc-bulk-add').onclick = async ()=>{
    const raw = ($('#mc-bulk')?.value||'');
    const lines = raw.split(/[\r\n,]+/).map(s=>s.trim()).filter(Boolean);
    if(!lines.length){ toast('Paste at least one code'); return; }
    let added=0, skipped=0;
    try{
      for(const line of lines){
        const result = await addOne(line);
        if(result) added++;
        else if(result===null) skipped++;
      }
      $('#mc-bulk').value = '';
      toast(`Added ${added} code${added===1?'':'s'}${skipped?`, ${skipped} already existed`:''}`);
      renderMemberCodes();
    }catch(e){ toast('Could not import codes'); console.error(e); }
  };

  // Codes list
  if(!codes.length){
    wrap.appendChild(el('<div class="card empty">No codes yet. Add codes above so members can register.</div>'));
    return;
  }

  const listCard = el('<div class="card"></div>');
  codes.forEach(row=>{
    const item = el(`
      <div class="moe" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="flex:1;font-family:monospace;font-size:13px">${esc(row.code)}</span>
        <span class="pill ${row.claimed?'locked':'open'}">${row.claimed?'✓ Claimed':'Open'}</span>
        <button class="btn danger sm" style="width:auto" data-rmcode="${esc(row.code)}">Remove</button>
      </div>`);
    item.querySelector('[data-rmcode]').onclick = async ()=>{
      const btn = item.querySelector('[data-rmcode]');
      btn.disabled = true;
      try{
        await DB.removeAllowedCode(row.code);
        item.remove();
        toast(`Removed: ${row.code}`);
        if(!listCard.querySelector('.moe')) renderMemberCodes();
      }catch(e){ btn.disabled=false; toast('Could not remove code'); console.error(e); }
    };
    listCard.appendChild(item);
  });
  wrap.appendChild(listCard);
}

function delRestaurant(r){
  modal({icon:'🗑️', title:`Delete ${r.name}?`, text:'It will be removed from the menu and all orders placed for this restaurant will also be deleted.',
    actions:[
      {label:'Delete', cls:'btn danger', fn:async ()=>{ try{ await DB.deleteRestaurant(r.id); menu = await DB.loadMenu(); closeModal(); renderSetup(); toast('Restaurant deleted'); }catch(e){ closeModal(); toast('Could not delete'); console.error(e); } }},
      {label:'Cancel', cls:'btn ghost', fn:closeModal}
    ]});
}

/* draft buffer for the editor */
let draft = null;
let optionEditors = { food:null, drinks:null };
function editRestaurant(id){
  const existing = id ? menu.find(x=>x.id===id) : null;
  draft = existing ? JSON.parse(JSON.stringify(existing))
                    : { id:rid(), name:'', place:'', date:'', info:'', food:[], drinks:[] };
  optionEditors = { food:null, drinks:null };
  $('#ptitle').textContent = existing ? 'Edit restaurant' : 'New restaurant';
  const c = $('#content');
  c.innerHTML='';
  c.appendChild(el(`<button class="btn ghost sm" id="back" style="margin-bottom:14px">‹ Back</button>`));
  $('#back').onclick = ()=> renderSetup();

  const form = el(`<div class="card">
    <label class="fld"><span>Restaurant name</span><input class="input" id="f-name" value="${esc(draft.name)}" placeholder="e.g. Spice Route — La Grapperia"></label>
    <label class="fld"><span>Place / area (optional)</span><input class="input" id="f-place" value="${esc(draft.place)}" placeholder="e.g. Paarl"></label>
    <label class="fld"><span>Date we eat there</span><input class="input" id="f-date" type="date" value="${esc(draft.date)}"></label>
    <label class="fld"><span>Note for members (optional)</span><textarea class="input" id="f-info" placeholder="e.g. Buffet starts 13:00. Vegetarian options marked.">${esc(draft.info)}</textarea></label>
  </div>`);
  c.appendChild(form);

  c.appendChild(el(`<h2 class="sec">Food options</h2>`));
  const foodBox = el(`<div class="card" id="foodbox" style="padding:4px 16px"></div>`); c.appendChild(foodBox);
  c.appendChild(optionAdder('food'));
  c.appendChild(optionBulkImporter('food'));
  c.appendChild(el(`<h2 class="sec">Drink options</h2>`));
  const drinkBox = el(`<div class="card" id="drinkbox" style="padding:4px 16px"></div>`); c.appendChild(drinkBox);
  c.appendChild(optionAdder('drinks'));
  c.appendChild(optionBulkImporter('drinks'));

  drawOptions();
  const save = el(`<button class="btn brass" id="rsave" style="margin-top:18px">Save restaurant</button>`);
  c.appendChild(save);
  save.onclick = saveRestaurant;
}

function optionAdder(kind){
  const foodMode = kind==='food';
  const box = el(`<div class="card">
    <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
      <label class="fld" style="flex:1;min-width:140px;margin:0"><span>Add ${foodMode?'a dish':'a drink'}</span><input class="input add-name" placeholder="${foodMode?'e.g. Lamb potjie':'e.g. Rooibos iced tea'}"></label>
      <label class="fld" style="width:130px;margin:0"><span>Type (optional)</span><input class="input add-type" placeholder="${foodMode?'e.g. Pizza':'e.g. Soft drink'}"></label>
      <label class="fld" style="width:110px;margin:0"><span>Price (optional)</span><input class="input add-price" type="number" min="0" step="0.01" placeholder="R"></label>
    </div>
    <label class="fld" style="margin:10px 0 0"><span>Ingredients / what's in it (optional)</span><input class="input add-desc" placeholder="${foodMode?'e.g. Slow-cooked lamb, potatoes, carrots, red wine':'e.g. Rooibos tea, lemon, honey, ice'}"></label>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
      <button class="btn sm add-btn" style="width:auto">Add</button>
      <button class="btn ghost sm cancel-btn" style="width:auto;display:none">Cancel edit</button>
    </div>
  </div>`);
  const nameI=box.querySelector('.add-name');
  const typeI=box.querySelector('.add-type');
  const priceI=box.querySelector('.add-price');
  const descI=box.querySelector('.add-desc');
  const addBtn=box.querySelector('.add-btn');
  const cancelBtn=box.querySelector('.cancel-btn');

  const editor = { kind, nameI, typeI, priceI, descI, addBtn, cancelBtn, editingId:null };
  editor.reset = (focus=false)=>{
    editor.editingId = null;
    nameI.value = '';
    typeI.value = '';
    priceI.value = '';
    descI.value = '';
    addBtn.textContent = 'Add';
    cancelBtn.style.display = 'none';
    if(focus) nameI.focus();
  };
  editor.beginEdit = (item)=>{
    editor.editingId = item.id;
    nameI.value = item.name || '';
    typeI.value = item.type || '';
    priceI.value = item.price ? String(item.price) : '';
    descI.value = item.desc || '';
    addBtn.textContent = 'Update';
    cancelBtn.style.display = 'inline-flex';
    nameI.focus();
    nameI.select();
  };

  const saveOption=()=>{
    const n = nameI.value.trim();
    if(!n){ nameI.focus(); return; }
    const pv = parseFloat(priceI.value);
    const option = {
      name:n,
      type:typeI.value.trim(),
      price:Number.isFinite(pv) && pv > 0 ? pv : 0,
      desc:descI.value.trim()
    };
    if(editor.editingId){
      const idx = draft[kind].findIndex(x=>x.id===editor.editingId);
      if(idx>=0) draft[kind][idx] = { ...draft[kind][idx], ...option };
    }else{
      draft[kind].push({ id:rid(), ...option });
    }
    editor.reset(true);
    drawOptions();
  };

  addBtn.onclick = saveOption;
  cancelBtn.onclick = ()=> editor.reset(true);
  [nameI,typeI,priceI,descI].forEach(i=> i.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); saveOption(); } }));
  optionEditors[kind] = editor;
  return box;
}
function optionBulkImporter(kind){
  const foodMode = kind==='food';
  const placeholder = foodMode
    ? 'Pizza - Margherita (R145)\nFior di Latte Mozzarella, Napoletana Sauce, Fresh Basil'
    : 'Drink - Coke (R35)\nSoft Drink';
  const box = el(`<div class="card">
    <label class="fld" style="margin:0">
      <span>Paste a ${foodMode?'food':'drink'} list</span>
      <textarea class="input bulk-text" placeholder="${placeholder}"></textarea>
    </label>
    <div class="empty" style="padding:0 0 10px">Paste one option per block. I’ll read lines like “${foodMode?'Pizza - Margherita (R145)':'Drink - Coke (R35)'}” and use the next line as the description.</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn ghost sm import-btn" style="width:auto">Import pasted list</button>
      <button class="btn ghost sm clear-btn" style="width:auto">Clear box</button>
    </div>
  </div>`);
  const textI = box.querySelector('.bulk-text');
  const importBtn = box.querySelector('.import-btn');
  const clearBtn = box.querySelector('.clear-btn');

  importBtn.onclick = ()=>{
    const items = parsePastedOptions(textI.value);
    if(!items.length){
      textI.focus();
      toast('No options found in that pasted list');
      return;
    }
    draft[kind].push(...items);
    optionEditors[kind]?.reset();
    drawOptions();
    textI.value = '';
    toast(`Imported ${items.length} ${foodMode?'food option':'drink option'}${items.length===1?'':'s'}`);
  };
  clearBtn.onclick = ()=>{
    textI.value = '';
    textI.focus();
  };
  return box;
}
function drawOptions(){
  ['food','drinks'].forEach(kind=>{
    const box = $(kind==='food'?'#foodbox':'#drinkbox'); if(!box) return;
    const items = draft[kind];
    if(!items.length){ box.innerHTML=`<div class="empty">None added yet.</div>`; return; }
    box.innerHTML='';
    items.forEach(it=>{
      const details = optionDetails(it);
      const row = el(`<div class="item"><div class="nm"><b>${esc(it.name)}</b>${details?`<div class="ing">${esc(details)}</div>`:''}${it.price?`<div class="pr">${fmtMoney(it.price)}</div>`:''}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn ghost sm" style="width:auto">Edit</button>
          <button class="btn danger sm" style="width:auto">Remove</button>
        </div>
      </div>`);
      const btns = row.querySelectorAll('button');
      btns[0].onclick=()=> optionEditors[kind]?.beginEdit(it);
      btns[1].onclick=()=>{
        draft[kind]=draft[kind].filter(x=>x.id!==it.id);
        if(optionEditors[kind]?.editingId===it.id) optionEditors[kind].reset();
        drawOptions();
      };
      box.appendChild(row);
    });
  });
}
async function saveRestaurant(){
  draft.name = $('#f-name').value.trim();
  draft.place = $('#f-place').value.trim();
  draft.date = $('#f-date').value;
  draft.info = $('#f-info').value.trim();
  if(!draft.name){ $('#f-name').focus(); toast('Give the restaurant a name'); return; }
  if(!draft.date){ $('#f-date').focus(); toast('Pick the date you eat there'); return; }
  try{
    await DB.upsertRestaurant(draft);
    menu = await DB.loadMenu();
    renderSetup(); toast('Restaurant saved ✓');
  }catch(e){ console.error(e); toast('Could not save — are you signed in as organiser?'); }
}

/* ===========================================================
   ADMIN — ALL ORDERS
   =========================================================== */
async function renderAllOrders(){
  $('#ptitle').textContent = 'All orders';
  const c = $('#content');
  c.innerHTML = `<p class="eyebrow">Admin</p><p class="lead">Every member's order, grouped by restaurant. Use the summary to tell each venue how many of each dish to prepare.</p>`;
  const orders = await DB.getAllOrders();
  if(!orders.length){ c.appendChild(el(`<div class="card empty">No orders yet. Once members start ordering, they'll appear here.</div>`)); return; }

  const groups = buildKitchenGroups(orders);
  c.appendChild(el(`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px"><button class="btn ghost sm" id="dlall" style="width:auto">⬇ Download all restaurant PDFs</button></div>`));
  $('#dlall').onclick = ()=> downloadAllRestaurantSummaries(groups);

  groups.forEach(group=>{
    c.appendChild(renderKitchenGroup(group, true));
  });
}

function renderKitchenGroup(group, showDownloadButton=false){
  const section = el(`<div></div>`);
  const head = el(`<div class="ordhead"><h2>${esc(group.name)}</h2><span class="count">${group.date.full||''} · ${group.list.length} order${group.list.length===1?'':'s'}</span></div>`);
  if(showDownloadButton){
    const btn = el(`<button class="btn ghost sm" style="width:auto">⬇ Download PDF</button>`);
    btn.onclick = ()=> downloadRestaurantSummary(group);
    head.appendChild(btn);
  }
  section.appendChild(head);

  const agg = el(`<div class="agg"><div class="ln" style="font-weight:700;color:var(--green)"><span>Kitchen summary</span><span></span></div>
    ${group.summary.map(row=>`<div class="ln"><span>${esc(row.label)}</span><span class="q">${row.qty} × ${fmtMoney(row.unitPrice)}${row.subTotal&&row.subTotal!==row.qty*row.unitPrice?` = ${fmtMoney(row.subTotal)}`:''}</span></div>`).join('')}
    ${group.anyPrice?`<div class="ln" style="font-weight:700"><span>Total value</span><span>${fmtMoney(group.total)}</span></div>`:''}
  </div>`);
  section.appendChild(agg);

  const box = el(`<div class="card"></div>`);
  group.list.forEach(o=>{
    box.appendChild(el(`<div class="moe"><b>${esc(o.member)}</b>${o.memberCode?` <span class="it">(${esc(o.memberCode)})</span>`:''} — <span class="it">${o.items.map(i=>esc(orderItemLabel(i))).join(' · ')}</span>${o.total?` · <span style="color:var(--brass-d);font-weight:700">${fmtMoney(o.total)}</span>`:''}</div>`));
  });
  section.appendChild(box);
  return section;
}

function downloadAllRestaurantSummaries(groups){
  groups.forEach(group=> downloadRestaurantSummary(group));
}

function downloadRestaurantSummary(group){
  const jsPDF = window.jspdf?.jsPDF;
  const canPdf = !!jsPDF && typeof jsPDF?.API?.autoTable === 'function';
  if(!canPdf){
    downloadSummaryText([group]);
    return;
  }

  const doc = new jsPDF({ orientation:'landscape', unit:'pt', format:'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 38;
  const generated = new Date().toLocaleString('en-ZA');

  const addFooter = ()=>{
    const pageNumber = doc.getCurrentPageInfo().pageNumber;
    doc.setFontSize(9);
    doc.setTextColor(111, 101, 87);
    doc.text(`Generated ${generated}`, margin, pageHeight - 18);
    doc.text(`Page ${pageNumber}`, pageWidth - margin, pageHeight - 18, { align:'right' });
  };

  doc.setTextColor(31, 61, 52);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text('Choir Tour Meals', margin, 34);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(111, 101, 87);
  doc.text('Kitchen summary and per-member breakdown', margin, 52);
  doc.setFontSize(11);
  doc.text(`${group.name}  ·  ${group.date.full || 'No date'}  ·  ${group.list.length} order${group.list.length===1 ? '' : 's'}`, margin, 72);

  doc.autoTable({
    startY: 90,
    head: [['Item', 'Qty', 'Price', 'Subtotal']],
    body: group.summary.length ? group.summary.map(row=>[
      row.label,
      String(row.qty),
      row.unitPrice ? fmtMoney(row.unitPrice) : '—',
      group.anyPrice ? fmtMoney(row.subTotal || (row.qty * row.unitPrice)) : '—'
    ]) : [['No items', '', '', '']],
    theme: 'grid',
    styles: { font:'helvetica', fontSize:10, cellPadding:5, textColor:[36,31,26], lineColor:[224,213,192] },
    headStyles: { fillColor:[31,61,52], textColor:[255,255,255], fontStyle:'bold' },
    alternateRowStyles: { fillColor:[251,247,238] },
    columnStyles: { 1:{ halign:'center', cellWidth:50 }, 2:{ halign:'right', cellWidth:78 }, 3:{ halign:'right', cellWidth:88 }, 4:{ halign:'right', cellWidth:92 } },
    margin: { left:margin, right:margin },
    didDrawPage: addFooter,
  });

  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 18,
    head: [['Member', 'Items', 'Total']],
    body: group.list.length ? group.list.map(o=>[
      o.member + (o.memberCode ? ` (${o.memberCode})` : ''),
      (o.items||[]).map(i=>{
        const label = orderItemLabel(i);
        const price = Number(i.price||0);
        return price ? `${label} (${fmtMoney(price)})` : label;
      }).join(' · '),
      o.total ? fmtMoney(o.total) : '—'
    ]) : [['No members', '', '']],
    theme: 'striped',
    styles: { font:'helvetica', fontSize:9.5, cellPadding:5, textColor:[36,31,26], lineColor:[224,213,192] },
    headStyles: { fillColor:[184,138,54], textColor:[255,255,255], fontStyle:'bold' },
    alternateRowStyles: { fillColor:[253,249,239] },
    columnStyles: { 2:{ halign:'right', cellWidth:80 } },
    margin: { left:margin, right:margin },
    didDrawPage: addFooter,
  });

  doc.save(`${group.name.replace(/[^a-z0-9]+/gi,'-').replace(/^-+|-+$/g,'').toLowerCase() || 'restaurant'}-summary.pdf`);
}

function downloadSummaryText(groups){
  let out = 'CHOIR CAPE TOUR — MEAL ORDERS\nGenerated '+new Date().toLocaleString('en-ZA')+'\n';
  groups.forEach(group=>{
    out += `\n========================================\n${group.name}  (${group.date.full||'no date'})  —  ${group.list.length} orders\n========================================\n`;
    out += 'KITCHEN SUMMARY:\n';
    group.summary.forEach(row=> out += `  ${row.qty}x ${row.label}${row.unitPrice ? ` @ ${fmtMoney(row.unitPrice)}` : ''}${row.subTotal ? ` (${fmtMoney(row.subTotal)})` : ''}\n`);
    if(group.anyPrice) out += `  TOTAL VALUE: ${fmtMoney(group.total)}\n`;
    out += '\nPER MEMBER:\n';
    group.list.forEach(o=>{
      out += `  ${o.member}${o.memberCode?` (${o.memberCode})`:''}: ${o.items.map(i=>`${orderItemLabel(i)}${Number(i.price||0) ? ` (${fmtMoney(i.price)})` : ''}`).join(' / ')}${o.total?` (${fmtMoney(o.total)})`:''}\n`;
    });
  });
  const blob = new Blob([out],{type:'text/plain'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='choir-tour-orders.txt'; a.click(); URL.revokeObjectURL(a.href);
}

/* ===========================================================
   MODAL + TOAST
   =========================================================== */
function modal({icon,title,text,custom,actions}){
  closeModal();
  const scrim = el(`<div class="scrim"><div class="modal">
    ${icon?`<div class="mk">${icon}</div>`:''}
    <h3>${esc(title)}</h3>${text?`<p>${esc(text)}</p>`:''}
    ${custom||''}
    <div class="acts"></div></div></div>`);
  const acts = scrim.querySelector('.acts');
  (actions||[]).forEach(a=>{ const b=el(`<button class="${a.cls||'btn'}">${esc(a.label)}</button>`); b.onclick=()=>{ if(!a.keep) closeModal(); a.fn&&a.fn(); }; acts.appendChild(b); });
  scrim.addEventListener('click',e=>{ if(e.target===scrim) closeModal(); });
  document.body.appendChild(scrim);
}
function closeModal(){ const s=document.querySelector('.scrim'); if(s) s.remove(); }
let toastT;
function toast(msg){ const old=document.querySelector('.toast'); if(old) old.remove();
  const t=el(`<div class="toast">${esc(msg)}</div>`); document.body.appendChild(t);
  clearTimeout(toastT); toastT=setTimeout(()=>t.remove(),2600); }

/* go */
init();
