/* ════════════════════════════════════════
   app.js — PitNotes
   Sections:
     1.  Config & Supabase helpers
     2.  Auth state (tokens)
     3.  App state
     4.  Startup
     5.  Auth — login / register / logout
     6.  Navigation
     7.  Data loader
     8.  Cars — CRUD + render
     9.  Sessions — form helpers
    10.  Sessions — race events
    11.  Sessions — save / edit / delete
    12.  Sessions — render list
    13.  Sessions — detail view
    14.  Tracks — CRUD + render
    15.  Stats — render
    16.  Modals
    17.  Toast
    18.  Settings Modal
════════════════════════════════════════ */


/* ────────────────────────────────────────
   1. CONFIG & SUPABASE HELPERS
──────────────────────────────────────── */
const SUPA_URL = 'https://uipngbwdcojorjzyxjmg.supabase.co';
const SUPA_KEY = 'sb_publishable_L6NUbZRyjkL-TKpiSSxUzA_RErMvX4t';

async function sbFetch(path, opts = {}) {
  const headers = {
    'apikey': SUPA_KEY,
    'Content-Type': 'application/json',
    ...opts.headers,
  };
  if (ACCESS_TOKEN) headers['Authorization'] = 'Bearer ' + ACCESS_TOKEN;

  const res  = await fetch(SUPA_URL + path, { ...opts, headers });
  const text = await res.text();

  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }

  if (!res.ok) {
    throw new Error(
      (data && (data.message || data.error_description || data.msg)) || 'Request failed'
    );
  }
  return data;
}

// Auth endpoint wrapper
function sbAuth(path, body) {
  return sbFetch('/auth/v1' + path, { method: 'POST', body: JSON.stringify(body) });
}

// REST helpers — all use RLS so user_id filtering is automatic
function sbSelect(table) {
  return sbFetch(`/rest/v1/${table}?select=*&order=created_at.desc`, {
    headers: { 'Prefer': 'return=representation' },
  });
}

function sbInsert(table, body) {
  return sbFetch(`/rest/v1/${table}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Prefer': 'return=representation' },
  });
}

function sbUpdate(table, id, body) {
  return sbFetch(`/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Prefer': 'return=representation' },
  });
}

function sbDelete(table, id) {
  return sbFetch(`/rest/v1/${table}?id=eq.${id}`, { method: 'DELETE' });
}


/* ────────────────────────────────────────
   2. AUTH STATE — TOKEN PERSISTENCE
──────────────────────────────────────── */
let ACCESS_TOKEN  = null;
let REFRESH_TOKEN = null;
let CU = null; // current user object

function saveTokens(access, refresh, user) {
  ACCESS_TOKEN  = access;
  REFRESH_TOKEN = refresh;
  CU = user;
  localStorage.setItem('pn_token', JSON.stringify({ access, refresh, user }));
}

function clearTokens() {
  ACCESS_TOKEN  = null;
  REFRESH_TOKEN = null;
  CU = null;
  localStorage.removeItem('pn_token');
}

function loadTokens() {
  try {
    const d = JSON.parse(localStorage.getItem('pn_token') || 'null');
    if (d) {
      ACCESS_TOKEN  = d.access;
      REFRESH_TOKEN = d.refresh;
      CU = d.user;
      return true;
    }
  } catch (e) { /* corrupted storage — just ignore */ }
  return false;
}


/* ────────────────────────────────────────
   3. APP STATE
──────────────────────────────────────── */
let cars = [];
let sessions = [];
let tracks = [];    // saved tracks with baseline setups
let ACI = null;   // active car id (filter)
let editSid = null;   // session being edited
let detailId = null;  // session open in detail modal
let editCid = null;   // car being edited
let editTid = null;   // track being edited

let reCount = 0;   // race-event counter (used to generate unique input IDs)


/* ────────────────────────────────────────
   4. STARTUP
──────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  showLogin();

  // Try to silently restore session from localStorage
  if (loadTokens()) {
    sbAuth('/token?grant_type=refresh_token', { refresh_token: REFRESH_TOKEN })
      .then(res => {
        saveTokens(res.access_token, res.refresh_token, res.user);
        loginSuccess();
      })
      .catch(() => clearTokens());
  }
});


/* ────────────────────────────────────────
   5. AUTH — LOGIN / REGISTER / LOGOUT
──────────────────────────────────────── */
function showLogin() {
  document.getElementById('login-form').style.display = '';
  document.getElementById('register-form').style.display = 'none';
}

function showRegister() {
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('register-form').style.display = '';
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-pass').value;
  const err = document.getElementById('login-error');

  if (!email || !pass) {
    err.textContent = 'Fill in all fields.';
    err.classList.add('show');
    return;
  }

  try {
    const res = await sbAuth('/token?grant_type=password', { email, password: pass });
    saveTokens(res.access_token, res.refresh_token, res.user);
    err.classList.remove('show');
    loginSuccess();
  } catch (e) {
    err.textContent = e.message;
    err.classList.add('show');
  }
}

async function doRegister() {
  const email = document.getElementById('reg-email').value.trim();
  const pass = document.getElementById('reg-pass').value;
  const err = document.getElementById('reg-error');

  if (!email || !pass) { err.textContent = 'All fields required.'; err.classList.add('show'); return; }
  if (pass.length < 6) { err.textContent = 'Password min 6 chars.'; err.classList.add('show'); return; }

  try {
    await sbAuth('/signup', { email, password: pass });
    err.classList.remove('show');
    showToast('Account created! Check your email to confirm, then sign in.');
    showLogin();
  } catch (e) {
    err.textContent = e.message;
    err.classList.add('show');
  }
}

function doLogout() {
  clearTokens();
  document.getElementById('app-screen').classList.remove('active');
  document.getElementById('login-screen').classList.add('active');
  showLogin();
}

function loginSuccess() {
  document.getElementById('login-screen').classList.remove('active');
  document.getElementById('app-screen').classList.add('active');

  const em = CU.email || '';
  document.getElementById('profile-avatar').textContent = em.charAt(0).toUpperCase();
  document.getElementById('profile-email-display').textContent = em;

  loadAll();
  showPage('sessions');
}


/* ────────────────────────────────────────
   6. NAVIGATION
──────────────────────────────────────── */
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t  => t.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.getElementById('tab-'  + name).classList.add('active');
}


/* ────────────────────────────────────────
   7. DATA LOADER
──────────────────────────────────────── */
async function loadAll() {
  try {
    const [c, s, t] = await Promise.all([
      fetch(`${SUPA_URL}/rest/v1/cars?select=*&order=created_at.desc`, {
        headers: { 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + ACCESS_TOKEN },
      }).then(r => r.json()),
      fetch(`${SUPA_URL}/rest/v1/sessions?select=*&order=created_at.desc`, {
        headers: { 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + ACCESS_TOKEN },
      }).then(r => r.json()),
      fetch(`${SUPA_URL}/rest/v1/tracks?select=*&order=created_at.desc`, {
        headers: { 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + ACCESS_TOKEN },
      }).then(r => r.json()),
    ]);

    if (c.code || s.code) throw new Error(c.message || s.message || 'DB error');

    cars = Array.isArray(c) ? c : [];
    sessions = Array.isArray(s) ? s : [];
    tracks = Array.isArray(t) ? t : [];
  } catch (e) {
    console.error('loadAll error:', e);
    cars = [];
    sessions = [];
    tracks = [];
    showToast('Load error: ' + e.message);
  }

  renderCars();
  renderSessions();
  renderTracksPage();
  renderStats();
  populateCarDD();
  populateTrackDD();
}


/* ────────────────────────────────────────
   8. CARS — CRUD + RENDER
──────────────────────────────────────── */
function openCarModal(id = null) {
  editCid = id;
  document.getElementById('car-modal-title').textContent = id ? 'Edit Car' : 'Add Car';

  const car = id ? cars.find(c => c.id === id) : null;
  document.getElementById('cm-num').value = car ? car.num : '';
  document.getElementById('cm-name').value  = car ? car.name  || '' : '';
  document.getElementById('cm-class').value = car ? car.cls   || '' : '';
  document.getElementById('cm-notes').value = car ? car.notes || '' : '';

  openModal('car-modal');
}

async function saveCar() {
  const num = document.getElementById('cm-num').value.trim();
  if (!num) { showToast('Car number required!'); return; }

  const payload = {
    num,
    name: document.getElementById('cm-name').value.trim(),
    cls: document.getElementById('cm-class').value.trim(),
    notes: document.getElementById('cm-notes').value.trim(),
    user_id: CU.id,
  };

  try {
    if (editCid) {
      const res = await sbUpdate('cars', editCid, payload);
      const updated = Array.isArray(res) ? res[0] : res;
      cars = cars.map(c => c.id === editCid ? updated : c);
    } else {
      const res = await sbInsert('cars', payload);
      const inserted = Array.isArray(res) ? res[0] : res;
      cars.unshift(inserted);
    }
    closeModal('car-modal');
    renderCars();
    populateCarDD();
    renderSessions();
    showToast('Car saved!');
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

async function deleteCar(id) {
  if (!confirm('Delete this car?')) return;

  try {
    await sbDelete('cars', id);
    cars = cars.filter(c => c.id !== id);
    if (ACI === id) { ACI = null; updateBadge(); }
    renderCars();
    populateCarDD();
    renderSessions();
    showToast('Car deleted.');
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

function setActiveCar(id) {
  ACI = (ACI === id) ? null : id;
  updateBadge();
  renderSessions();
}

function updateBadge() {
  const car = ACI ? cars.find(c => c.id === ACI) : null;
  document.getElementById('active-car-badge').textContent = car ? '#' + car.num : 'All Cars';
}

function renderCars() {
  const list = document.getElementById('cars-list');
  list.innerHTML = '';

  if (!cars.length) {
    list.innerHTML = `<div class="empty-state"><div class="icon">🏎</div><p>No cars yet.<br>Tap <b>+ Add Car</b> to get started.</p></div>`;
    return;
  }

  cars.forEach(c => {
    const cnt = sessions.filter(s => s.car_id === c.id).length;
    const div = document.createElement('div');
    div.className = 'car-card';
    div.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;">
        <div class="car-num">${c.num}</div>
        <div class="car-info">
          <h3>${c.name || c.num}</h3>
          <p>${c.cls || ''}${cnt ? ' · ' + cnt + ' session' + (cnt !== 1 ? 's' : '') : ''}</p>
        </div>
      </div>
      <div class="car-actions">
        <button class="btn ghost sm"     onclick="setActiveCar('${c.id}')">Filter</button>
        <button class="btn secondary sm" onclick="openCarModal('${c.id}')">Edit</button>
        <button class="btn danger sm"    onclick="deleteCar('${c.id}')">✕</button>
      </div>`;
    list.appendChild(div);
  });
}

// Populate all car <select> dropdowns in modals
function populateCarDD() {
  const options = '<option value="">— No car —</option>'
    + cars.map(c => `<option value="${c.id}">#${c.num} ${c.name || ''}</option>`).join('');
  document.getElementById('ns-car').innerHTML = options;
}

// Populate the track dropdown in the new session modal
function populateTrackDD() {
  const sel = document.getElementById('ns-track');
  const current = sel.value;
  sel.innerHTML = '<option value="">— Select Track —</option>'
    + tracks.map(t => `<option value="${t.id}">${t.name}${t.size ? ' — ' + t.size : ''}</option>`).join('');
  if (current) sel.value = current;
}


/* ────────────────────────────────────────
   9. SESSIONS — FORM HELPERS
──────────────────────────────────────── */
// Corner names and field names used to auto-clear / auto-populate the chassis grid
const CORNER_NAMES = ['lf', 'rf', 'lr', 'rr'];
const CORNER_FIELDS = ['block', 'bar', 'preload', 'comp', 'reb', 'tire', 'psi', 'ride'];

// Safe getValue helper
function gv(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

function openNewSession() {
  editSid = null;
  clearForm();
  document.getElementById('ns-title').textContent = 'New Session';
  document.getElementById('ns-date').value = new Date().toISOString().split('T')[0];
  if (ACI) document.getElementById('ns-car').value = ACI;

  // Wire track dropdown to autofill baseline setup
  const trackSel = document.getElementById('ns-track');
  trackSel.onchange = function() { autofillBaseline(this.value); };

  document.getElementById('re-container').innerHTML = '';
  reCount = 0;
  addRaceEvent();

  openModal('ns-modal');
}

function autofillBaseline(trackId) {
  if (!trackId) return;
  const t = tracks.find(x => x.id === trackId);
  if (!t || !t.baseline) return;

  const b = t.baseline;
  // Fill corner fields
  CORNER_NAMES.forEach(cn => {
    CORNER_FIELDS.forEach(f => {
      const el = document.getElementById(cn + '-' + f);
      if (el && b.corners && b.corners[cn]) el.value = b.corners[cn][f] || '';
    });
  });
  if (b.corners) {
    if (b.corners.rr) {
      const rrs = document.getElementById('rr-stagger'); if (rrs) rrs.value = b.corners.rr.stagger || '';
      const rrsp = document.getElementById('rr-spacing'); if (rrsp) rrsp.value = b.corners.rr.spacing || '';
    }
    if (b.corners.lr) {
      const lrsp = document.getElementById('lr-spacing'); if (lrsp) lrsp.value = b.corners.lr.spacing || '';
    }
  }
  // Fill bolt-ons
  if (b.bolt_ons) {
    const lrr = document.getElementById('lr-radius'); if (lrr) lrr.value = b.bolt_ons.lr_radius || '';
    const rrr = document.getElementById('rr-radius'); if (rrr) rrr.value = b.bolt_ons.rr_radius || '';
    const jac = document.getElementById('rr-jacobs'); if (jac) jac.value = b.bolt_ons.jacobs_ladder || '';
    const fph = document.getElementById('front-panhard'); if (fph) fph.value = b.bolt_ons.front_panhard || '';
  }
  // Fill engine fields
  const fields = ['engine','gear','exhaust','injection','fp','wing'];
  fields.forEach(f => {
    const el = document.getElementById('ns-' + f);
    if (el && b[f]) el.value = b[f];
  });
  showToast('Baseline setup loaded! ✓');
}

function clearForm() {
  // Basic event info + engine fields
  [
    'ns-date', 'ns-driver', 'ns-class', 'ns-condition',
    'ns-engine', 'ns-gear', 'ns-exhaust', 'ns-injection', 'ns-fp', 'ns-wing', 'ns-notes',
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  // Reset track dropdown
  const trackSel = document.getElementById('ns-track');
  if (trackSel) trackSel.value = '';

  // Corner grid inputs
  CORNER_NAMES.forEach(cn => {
    CORNER_FIELDS.forEach(f => {
      const el = document.getElementById(cn + '-' + f);
      if (el) el.value = '';
    });
  });

  // Corner-specific extras
  ['rr-stagger', 'rr-spacing', 'lr-spacing'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['lr-radius', 'rr-radius', 'rr-jacobs', 'front-panhard'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  document.getElementById('ns-car').value = '';
}


/* ────────────────────────────────────────
   10. SESSIONS — RACE EVENTS
──────────────────────────────────────── */
function addRaceEvent(d = null) {
  reCount++;
  const i = reCount;
  const container = document.getElementById('re-container');

  const rows = ['bar-size', 'turns', 'rebound', 'compression', 'PSI'];
  const corners = ['lf', 'rf', 'lr', 'rr'];

  // Build tire table rows
  const tireTbody = rows.map(row => {
    const cells = corners.map(cor => {
      const val = d && d.tires && d.tires[row] ? d.tires[row][cor] || '' : '';
      return `<td><input id="re-${row}-${cor}-${i}" value="${val}"></td>`;
    }).join('');
    return `<tr><td>${row}</td>${cells}</tr>`;
  }).join('');

  const staggerVal = d && d.tires && d.tires.stagger ? d.tires.stagger.rr || '' : '';

  const div = document.createElement('div');
  div.className = 're-block';
  div.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px;">
      <h4>Race Event</h4>
      <button class="icon-btn" onclick="this.closest('.re-block').remove()">✕</button>
    </div>
    <div class="re-4" style="margin-bottom:8px;">
      <div><div class="re-lbl">Start</div>   <input class="re-inp" id="re-start-${i}"  placeholder="8th"  value="${d ? d.start   || '' : ''}"></div>
      <div><div class="re-lbl">Finish</div>  <input class="re-inp" id="re-finish-${i}" placeholder="3rd"  value="${d ? d.finish  || '' : ''}"></div>
      <div><div class="re-lbl"># Cars</div>  <input class="re-inp" id="re-cars-${i}"   placeholder="24"   value="${d ? d.numCars || '' : ''}"></div>
      <div><div class="re-lbl">Laps</div>    <input class="re-inp" id="re-laps-${i}"   placeholder="40"   value="${d ? d.laps    || '' : ''}"></div>
    </div>
    <div style="margin-bottom:8px;">
      <div class="re-lbl">Track Condition</div>
      <input class="re-inp" id="re-cond-${i}" placeholder="Slick / Tacky / Cushion…" value="${d ? d.cond || '' : ''}">
    </div>
    <div class="re-lbl" style="margin-bottom:5px;">Tires</div>
    <table class="tire-tbl">
      <thead>
        <tr><th></th><th>LF</th><th>RF</th><th>LR</th><th>RR</th></tr>
      </thead>
      <tbody>
        ${tireTbody}
        <tr>
          <td>Stagger</td>
          <td></td><td></td><td></td>
          <td><input id="re-stagger-rr-${i}" value="${staggerVal}"></td>
        </tr>
        <tr>
          <td>LR Spacing</td>
          <td></td><td></td>
          <td><input id="re-lr-spacing-${i}" value="${d && d.lr_spacing ? d.lr_spacing : ''}"></td>
          <td></td>
        </tr>
        <tr>
          <td>RR Spacing</td>
          <td></td><td></td><td></td>
          <td><input id="re-rr-spacing-${i}" value="${d && d.rr_spacing ? d.rr_spacing : ''}"></td>
        </tr>
      </tbody>
    </table>
    <div style="margin-top:8px;">
      <div class="re-lbl">Notes</div>
      <input class="re-inp" id="re-note-${i}" placeholder="Session notes…" value="${d ? d.note || '' : ''}">
    </div>`;

  container.appendChild(div);
}

// Collect all race event data from DOM into an array of objects
function collectRE() {
  const events = [];
  const rows = ['bar-size', 'turns', 'rebound', 'compression', 'PSI'];
  const corners = ['lf', 'rf', 'lr', 'rr'];

  document.querySelectorAll('#re-container .re-block').forEach(block => {
    // Extract the index from the first input's id
    const inp = block.querySelector('input');
    if (!inp) return;
    const m = inp.id.match(/-(\d+)$/);
    if (!m) return;
    const i = m[1];

    const tires = {};
    rows.forEach(r => {
      tires[r] = {};
      corners.forEach(c => { tires[r][c] = gv(`re-${r}-${c}-${i}`); });
    });
    tires.stagger = { rr: gv(`re-stagger-rr-${i}`) };

    events.push({
      start: gv(`re-start-${i}`),
      finish: gv(`re-finish-${i}`),
      numCars: gv(`re-cars-${i}`),
      laps: gv(`re-laps-${i}`),
      cond: gv(`re-cond-${i}`),
      note: gv(`re-note-${i}`),
      lr_spacing: gv(`re-lr-spacing-${i}`),
      rr_spacing: gv(`re-rr-spacing-${i}`),
      tires,
    });
  });

  return events;
}


/* ────────────────────────────────────────
   11. SESSIONS — SAVE / EDIT / DELETE
──────────────────────────────────────── */
async function saveSession() {
  const trackId = gv('ns-track');
  if (!trackId) { showToast('Select a track!'); return; }
  const trackObj = tracks.find(t => t.id === trackId);

  // Collect corner data
  const corners = {};
  CORNER_NAMES.forEach(cn => {
    corners[cn] = {};
    CORNER_FIELDS.forEach(f => { corners[cn][f] = gv(cn + '-' + f); });
  });
  corners.rr.stagger = gv('rr-stagger');
  corners.rr.spacing = gv('rr-spacing');
  corners.lr.spacing = gv('lr-spacing');
  const bolt_ons = {
    lr_radius:     gv('lr-radius'),
    rr_radius:     gv('rr-radius'),
    jacobs_ladder: gv('rr-jacobs'),
    front_panhard: gv('front-panhard'),
  };

  const payload = {
    user_id: CU.id,
    car_id: gv('ns-car') || null,
    track_id: trackId,
    track: trackObj ? trackObj.name : '',
    date: gv('ns-date'),
    driver: gv('ns-driver'),
    cls: gv('ns-class'),
    cond: gv('ns-condition'),
    engine: gv('ns-engine'),
    gear: gv('ns-gear'),
    exhaust: gv('ns-exhaust'),
    injection: gv('ns-injection'),
    fp: gv('ns-fp'),
    wing: gv('ns-wing'),
    corners,
    bolt_ons,
    race_events: collectRE(),
    notes: gv('ns-notes'),
  };

  try {
    if (editSid) {
      const res = await sbUpdate('sessions', editSid, payload);
      const updated = Array.isArray(res) ? res[0] : res;
      sessions = sessions.map(s => s.id === editSid ? updated : s);
    } else {
      const res = await sbInsert('sessions', payload);
      const inserted = Array.isArray(res) ? res[0] : res;
      sessions.unshift(inserted);
    }
    closeModal('ns-modal');
    renderSessions();
    renderStats();
    showToast('Session saved! 🏁');
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

function editSession() {
  const s = sessions.find(x => x.id === detailId);
  if (!s) return;

  closeModal('detail-modal');
  clearForm();
  editSid = s.id;

  document.getElementById('ns-title').textContent = 'Edit Session';
  // Set track dropdown — use track_id if stored, else try to match by name
  const trackSel = document.getElementById('ns-track');
  trackSel.onchange = function() { autofillBaseline(this.value); };
  if (s.track_id) {
    trackSel.value = s.track_id;
  } else if (s.track) {
    const match = tracks.find(t => t.name === s.track);
    if (match) trackSel.value = match.id;
  }

  document.getElementById('ns-date').value = s.date   || '';
  document.getElementById('ns-driver').value = s.driver || '';
  document.getElementById('ns-car').value = s.car_id || '';
  document.getElementById('ns-class').value = s.cls    || '';
  document.getElementById('ns-condition').value = s.cond   || '';
  document.getElementById('ns-engine').value = s.engine || '';
  document.getElementById('ns-gear').value = s.gear   || '';
  document.getElementById('ns-exhaust').value = s.exhaust    || '';
  document.getElementById('ns-injection').value = s.injection  || '';
  document.getElementById('ns-fp').value = s.fp     || '';
  document.getElementById('ns-wing').value = s.wing   || '';

  // Restore corner inputs
  CORNER_NAMES.forEach(cn => {
    CORNER_FIELDS.forEach(f => {
      const el = document.getElementById(cn + '-' + f);
      if (el && s.corners && s.corners[cn]) el.value = s.corners[cn][f] || '';
    });
  });
  if (s.corners) {
    if (s.corners.rr) {
      document.getElementById('rr-stagger').value = s.corners.rr.stagger || '';
      document.getElementById('rr-spacing').value = s.corners.rr.spacing || '';
      document.getElementById('rr-radius').value  = s.corners.rr.radius  || '';
      document.getElementById('rr-jacobs').value  = s.corners.rr.jacobs  || '';
    }
    if (s.corners.lr) {
    document.getElementById('lr-spacing').value = s.corners.lr.spacing || '';
    }

    // Restore bolt-on inputs
    if (s.bolt_ons) {
      document.getElementById('lr-radius').value     = s.bolt_ons.lr_radius     || '';
      document.getElementById('rr-radius').value     = s.bolt_ons.rr_radius     || '';
      document.getElementById('rr-jacobs').value     = s.bolt_ons.jacobs_ladder || '';
      document.getElementById('front-panhard').value = s.bolt_ons.front_panhard || '';
    } else if (s.corners) {
      document.getElementById('lr-radius').value = (s.corners.lr && s.corners.lr.radius) || '';
      document.getElementById('rr-radius').value = (s.corners.rr && s.corners.rr.radius) || '';
      document.getElementById('rr-jacobs').value = (s.corners.rr && s.corners.rr.jacobs) || '';
    }
  }

  // Restore race events
  document.getElementById('re-container').innerHTML = '';
  reCount = 0;
  (s.race_events || []).forEach(e => addRaceEvent(e));
  if (!s.race_events || !s.race_events.length) addRaceEvent();

  document.getElementById('ns-notes').value = s.notes || '';

  openModal('ns-modal');
}

async function deleteSession() {
  if (!detailId || !confirm('Delete this session?')) return;

  try {
    await sbDelete('sessions', detailId);
    sessions = sessions.filter(s => s.id !== detailId);
    closeModal('detail-modal');
    renderSessions();
    renderStats();
    showToast('Session deleted.');
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}


/* ────────────────────────────────────────
   13. SESSIONS — RENDER LIST
──────────────────────────────────────── */
function renderSessions() {
  // Build filter bar
  const fb = document.getElementById('filter-bar');
  fb.innerHTML = '';

  const allChip = document.createElement('div');
  allChip.className = 'filter-chip' + (ACI ? '' : ' active');
  allChip.textContent = 'All Cars';
  allChip.onclick = () => { ACI = null; updateBadge(); renderSessions(); };
  fb.appendChild(allChip);

  cars.forEach(c => {
    const chip = document.createElement('div');
    chip.className = 'filter-chip' + (ACI === c.id ? ' active' : '');
    chip.textContent = '#' + c.num + (c.name ? ' — ' + c.name : '');
    chip.onclick = () => setActiveCar(c.id);
    fb.appendChild(chip);
  });

  // Filter sessions by active car
  const data = ACI ? sessions.filter(s => s.car_id === ACI) : sessions;
  const list = document.getElementById('sessions-list');
  list.innerHTML = '';

  if (!data.length) {
    list.innerHTML = `<div class="empty-state"><div class="icon">🏁</div><p>No sessions yet.<br>Tap <b>+ New</b> to log your first setup.</p></div>`;
    return;
  }

  data.forEach((s, i) => {
    const car = cars.find(c => c.id === s.car_id);
    const ds = s.date
      ? new Date(s.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : '';

    const finishes = (s.race_events || []).map(e => parseInt(e.finish)).filter(n => !isNaN(n));
    const fchip = finishes.length ? `<span class="chip ac">P${Math.min(...finishes)}</span>` : '';

    const card = document.createElement('div');
    card.className = 'session-card';
    card.style.animationDelay = (i * 0.04) + 's';
    card.onclick = () => openDetail(s.id);
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div class="card-track">${s.track || '—'}</div>
        <div style="font-size:12px;color:var(--muted);">${ds}</div>
      </div>
      <div class="card-meta">
        ${car   ? `<span class="chip car">#${car.num}</span>` : ''}
        ${s.cls  ? `<span class="chip">${s.cls}</span>`  : ''}
        ${s.cond ? `<span class="chip">${s.cond}</span>` : ''}
        ${fchip}
      </div>
      ${s.notes ? `<div class="card-note">${s.notes}</div>` : ''}`;

    list.appendChild(card);
  });
}


/* ────────────────────────────────────────
   14. SESSIONS — DETAIL VIEW
──────────────────────────────────────── */
function openDetail(id) {
  const s = sessions.find(x => x.id === id);
  if (!s) return;
  detailId = id;

  const car = cars.find(c => c.id === s.car_id);
  const ds  = s.date
    ? new Date(s.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  document.getElementById('detail-title').textContent = s.track;

  // Helper: build a list of <div class="detail-row"> for non-empty [label, value] pairs
  const rows = pairs => pairs
    .filter(([, v]) => v)
    .map(([l, v]) => `<div class="detail-row"><span>${l}</span><span>${v}</span></div>`)
    .join('');

  // Build one corner block
  const cdet = (cn, lbl) => {
    const c = (s.corners && s.corners[cn]) || {};
    const fields = [
      ['Block Size',  c.block],
      ['Bar Size',    c.bar],
      ['Preload',     c.preload],
      ['Ride Height', c.ride],
      ['Shock Reb.',  c.reb],
      ['Shock Comp.', c.comp],
      ['Tire Size',   c.tire],
      ['Air PSI',     c.psi],
    ];
    if (cn === 'lr') fields.push(['LR Spacing', c.spacing]);
    if (cn === 'rr') fields.push(['Stagger', c.stagger], ['RR Spacing', c.spacing]);

    const content = rows(fields);
    if (!content) return '';
    return `<div class="c-detail-blk"><h5>${lbl}</h5>${content}</div>`;
  };

  const cornersH = [cdet('lf','LF'), cdet('rf','RF'), cdet('lr','LR'), cdet('rr','RR')].filter(Boolean).join('');

  // Race events HTML
  const evH = (s.race_events && s.race_events.length)
    ? s.race_events.map(e => {
        const tireRows  = ['pressure','turns','bar-size','compression','rebound']
          .filter(r => ['lf','rf','lr','rr'].some(c => e.tires && e.tires[r] && e.tires[r][c]));
        const staggerRR = e.tires && e.tires.stagger && e.tires.stagger.rr;

        const ttbl = (tireRows.length || staggerRR) ? `
          <table class="tire-tbl" style="margin-top:8px;">
            <thead><tr><th></th><th>LF</th><th>RF</th><th>LR</th><th>RR</th></tr></thead>
            <tbody>
              ${tireRows.map(r => `<tr><td>${r}</td>${['lf','rf','lr','rr'].map(c =>
                `<td style="font-size:12px;text-align:center;">${(e.tires[r] && e.tires[r][c]) || '—'}</td>`
              ).join('')}</tr>`).join('')}
              ${staggerRR ? `<tr><td>Stagger</td><td>—</td><td>—</td><td>—</td><td style="font-size:12px;text-align:center;">${e.tires.stagger.rr}</td></tr>` : ''}
            </tbody>
          </table>` : '';

        return `<div class="re-block">
          ${rows([['Start',e.start],['Finish',e.finish],['# Cars',e.numCars],['Laps',e.laps],['Track Condition',e.cond],['LR Spacing',e.lr_spacing],['RR Spacing',e.rr_spacing]])}
          ${ttbl}
          ${e.note ? `<div style="margin-top:7px;font-size:13px;color:var(--muted);">${e.note}</div>` : ''}
        </div>`;
      }).join('')
    : '';

  document.getElementById('detail-body').innerHTML = `
    <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:12px;">
      ${ds     ? `<span class="chip">${ds}</span>` : ''}
      ${car    ? `<span class="chip car">#${car.num} ${car.name || ''}</span>` : ''}
      ${s.cls  ? `<span class="chip">${s.cls}</span>`  : ''}
      ${s.cond ? `<span class="chip">${s.cond}</span>` : ''}
      ${s.driver ? `<span class="chip">${s.driver}</span>` : ''}
    </div>
    ${(cornersH || s.wing) ? `<div class="detail-section"><h4>🔧 Chassis Setup</h4>${cornersH ? `<div class="c-detail-grid">${cornersH}</div>` : ''}${s.wing ? `<div class="detail-row"><span>Wing Angle</span><span>${s.wing}</span></div>` : ''}</div>` : ''}
    ${(s.bolt_ons && (s.bolt_ons.lr_radius || s.bolt_ons.rr_radius || s.bolt_ons.jacobs_ladder || s.bolt_ons.front_panhard))
      || (s.corners && ((s.corners.lr && s.corners.lr.radius) || (s.corners.rr && (s.corners.rr.radius || s.corners.rr.jacobs))))
      ? `<div class="detail-section"><h4>🔩 Bolt-Ons</h4>
        ${rows([
          ['LR Radius Rod',  s.bolt_ons ? s.bolt_ons.lr_radius     : (s.corners.lr && s.corners.lr.radius)],
          ['RR Radius Rod',  s.bolt_ons ? s.bolt_ons.rr_radius     : (s.corners.rr && s.corners.rr.radius)],
          ["Jacob's Ladder", s.bolt_ons ? s.bolt_ons.jacobs_ladder : (s.corners.rr && s.corners.rr.jacobs)],
          ['Front Panhard',  s.bolt_ons ? s.bolt_ons.front_panhard : ''],
        ])}
      </div>` : ''}
    ${(s.engine || s.gear || s.exhaust || s.injection || s.fp)
      ? `<div class="detail-section"><h4>⚙️ Engine / Other</h4>
          ${rows([['Engine',s.engine],['Gearing',s.gear],['Exhaust',s.exhaust],['Injection',s.injection],['Fuel Pressure',s.fp]])}
         </div>` : ''}
    ${evH     ? `<div class="detail-section"><h4>🏁 Race Events</h4>${evH}</div>` : ''}
    ${s.notes ? `<div class="detail-section"><h4>📝 Notes</h4><div class="detail-notes">${s.notes}</div></div>` : ''}`;

  openModal('detail-modal');
}


/* ────────────────────────────────────────
   14. TRACKS — CRUD + RENDER
──────────────────────────────────────── */
const TM_CORNER_NAMES = ['lf', 'rf', 'lr', 'rr'];
const TM_CORNER_FIELDS = ['block', 'bar', 'preload', 'ride', 'reb', 'comp', 'psi', 'tire'];

function openTrackModal(id = null) {
  editTid = id;
  document.getElementById('track-modal-title').textContent = id ? 'Edit Track' : 'Add Track';

  const t = id ? tracks.find(x => x.id === id) : null;
  document.getElementById('tm-name').value     = t ? t.name     || '' : '';
  document.getElementById('tm-location').value = t ? t.location || '' : '';
  document.getElementById('tm-size').value     = t ? t.size     || '' : '';
  document.getElementById('tm-notes').value    = t ? t.notes    || '' : '';

  // Clear / restore baseline corner fields
  TM_CORNER_NAMES.forEach(cn => {
    TM_CORNER_FIELDS.forEach(f => {
      const el = document.getElementById('tm-' + cn + '-' + f);
      if (el) el.value = (t && t.baseline && t.baseline.corners && t.baseline.corners[cn])
        ? t.baseline.corners[cn][f] || '' : '';
    });
  });
  // Extra corner fields
  const tmLrSp = document.getElementById('tm-lr-spacing');
  if (tmLrSp) tmLrSp.value = (t && t.baseline && t.baseline.corners && t.baseline.corners.lr) ? t.baseline.corners.lr.spacing || '' : '';
  const tmRrSt = document.getElementById('tm-rr-stagger');
  if (tmRrSt) tmRrSt.value = (t && t.baseline && t.baseline.corners && t.baseline.corners.rr) ? t.baseline.corners.rr.stagger || '' : '';
  const tmRrSp = document.getElementById('tm-rr-spacing');
  if (tmRrSp) tmRrSp.value = (t && t.baseline && t.baseline.corners && t.baseline.corners.rr) ? t.baseline.corners.rr.spacing || '' : '';

  // Bolt-ons
  ['tm-lr-radius','tm-rr-radius','tm-rr-jacobs','tm-front-panhard'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  if (t && t.baseline && t.baseline.bolt_ons) {
    const b = t.baseline.bolt_ons;
    document.getElementById('tm-lr-radius').value     = b.lr_radius     || '';
    document.getElementById('tm-rr-radius').value     = b.rr_radius     || '';
    document.getElementById('tm-rr-jacobs').value     = b.jacobs_ladder || '';
    document.getElementById('tm-front-panhard').value = b.front_panhard || '';
  }

  // Engine fields
  ['engine','gear','exhaust','injection','fp','wing'].forEach(f => {
    const el = document.getElementById('tm-' + f);
    if (el) el.value = (t && t.baseline && t.baseline[f]) ? t.baseline[f] : '';
  });

  openModal('track-modal');
}

function tmGv(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

async function saveTrack() {
  const name = tmGv('tm-name');
  if (!name) { showToast('Track name required!'); return; }

  const corners = {};
  TM_CORNER_NAMES.forEach(cn => {
    corners[cn] = {};
    TM_CORNER_FIELDS.forEach(f => { corners[cn][f] = tmGv('tm-' + cn + '-' + f); });
  });
  corners.lr.spacing = tmGv('tm-lr-spacing');
  corners.rr.stagger = tmGv('tm-rr-stagger');
  corners.rr.spacing = tmGv('tm-rr-spacing');

  const bolt_ons = {
    lr_radius:     tmGv('tm-lr-radius'),
    rr_radius:     tmGv('tm-rr-radius'),
    jacobs_ladder: tmGv('tm-rr-jacobs'),
    front_panhard: tmGv('tm-front-panhard'),
  };

  const baseline = {
    corners,
    bolt_ons,
    engine:    tmGv('tm-engine'),
    gear:      tmGv('tm-gear'),
    exhaust:   tmGv('tm-exhaust'),
    injection: tmGv('tm-injection'),
    fp:        tmGv('tm-fp'),
    wing:      tmGv('tm-wing'),
  };

  const payload = {
    user_id: CU.id,
    name,
    location: tmGv('tm-location'),
    size:     tmGv('tm-size'),
    notes:    tmGv('tm-notes'),
    baseline,
  };

  try {
    if (editTid) {
      const res = await sbUpdate('tracks', editTid, payload);
      const updated = Array.isArray(res) ? res[0] : res;
      tracks = tracks.map(t => t.id === editTid ? updated : t);
    } else {
      const res = await sbInsert('tracks', payload);
      const inserted = Array.isArray(res) ? res[0] : res;
      tracks.unshift(inserted);
    }
    closeModal('track-modal');
    renderTracksPage();
    populateTrackDD();
    renderStats();
    showToast('Track saved! 📍');
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

async function deleteTrack(id) {
  if (!confirm('Delete this track?')) return;
  try {
    await sbDelete('tracks', id);
    tracks = tracks.filter(t => t.id !== id);
    renderTracksPage();
    populateTrackDD();
    renderStats();
    showToast('Track deleted.');
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

function renderTracksPage() {
  const list = document.getElementById('tracks-list-page');
  list.innerHTML = '';

  if (!tracks.length) {
    list.innerHTML = `<div class="empty-state"><div class="icon">📍</div><p>No tracks yet.<br>Tap <b>+ Add Track</b> to get started.</p></div>`;
    return;
  }

  tracks.forEach(t => {
    const cnt = sessions.filter(s => s.track_id === t.id || s.track === t.name).length;
    const div = document.createElement('div');
    div.className = 'car-card';
    div.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;">
        <div class="car-num" style="font-size:24px;width:48px;height:48px;">📍</div>
        <div class="car-info">
          <h3>${t.name}</h3>
          <p>${[t.size, t.location].filter(Boolean).join(' · ')}${cnt ? ' · ' + cnt + ' session' + (cnt !== 1 ? 's' : '') : ''}</p>
        </div>
      </div>
      <div class="car-actions">
        <button class="btn secondary sm" onclick="openTrackModal('${t.id}')">Edit</button>
        <button class="btn danger sm"    onclick="deleteTrack('${t.id}')">✕</button>
      </div>`;
    list.appendChild(div);
  });
}


/* ────────────────────────────────────────
   15. STATS — RENDER
──────────────────────────────────────── */
function renderStats() {
  const total = sessions.length;
  const trackCount = tracks.length;
  const finishes = sessions.flatMap(s =>
    (s.race_events || []).map(e => parseInt(e.finish))
  ).filter(n => !isNaN(n));
  const best = finishes.length ? Math.min(...finishes) : '—';

  document.getElementById('stats-cards').innerHTML = `
    <div class="stat-card"><div class="num">${total}</div><div class="lbl">Sessions</div></div>
    <div class="stat-card"><div class="num">${trackCount}</div><div class="lbl">Tracks</div></div>
    <div class="stat-card"><div class="num">${best === '—' ? '—' : 'P' + best}</div><div class="lbl">Best Finish</div></div>
    <div class="stat-card"><div class="num">${cars.length}</div><div class="lbl">Cars</div></div>`;

  document.getElementById('stats-tracks-list').innerHTML = tracks.length
    ? tracks.map(t => {
        const cnt = sessions.filter(s => s.track_id === t.id || s.track === t.name).length;
        return `<div class="detail-row"><span>${t.name}</span><span>${cnt} session${cnt !== 1 ? 's' : ''}</span></div>`;
      }).join('')
    : '<p style="color:var(--muted);font-size:13px;padding:8px 0;">No tracks added yet.</p>';

  document.getElementById('best-finish').innerHTML = best !== '—'
    ? `<div class="detail-row"><span>Best Finish</span><span>P${best}</span></div>`
    : '<p style="color:var(--muted);font-size:13px;padding:8px 0;">No finishes logged yet.</p>';
}


/* ────────────────────────────────────────
   16. MODALS
──────────────────────────────────────── */
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// Close any modal (except new session) by tapping backdrop
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay && overlay.id !== 'ns-modal') {
      overlay.classList.remove('open');
    }
  });
});


/* ────────────────────────────────────────
   17. TOAST
──────────────────────────────────────── */
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2400);
}


/* ────────────────────────────────────────
   18. SETTINGS MODAL
──────────────────────────────────────── */
function openSettingsModal() {
  // Clear any previous messages
  ['settings-email-error','settings-email-success','settings-pass-error','settings-pass-success'].forEach(id => {
    const el = document.getElementById(id);
    el.textContent = '';
    el.classList.remove('show');
  });
  document.getElementById('settings-new-email').value = '';
  document.getElementById('settings-new-pass').value = '';
  document.getElementById('settings-confirm-pass').value = '';

  // Sync toggle state
  const isLight = document.body.classList.contains('light-mode');
  const btn = document.getElementById('theme-toggle-btn');
  if (isLight) btn.classList.add('on'); else btn.classList.remove('on');
  document.getElementById('theme-sublabel').textContent = isLight ? 'Light Mode' : 'Dark Mode';
  document.getElementById('theme-toggle-btn').querySelector('.theme-toggle-thumb').textContent = isLight ? '☀️' : '🌙';

  openModal('settings-modal');
}

/* ── Theme Toggle ── */
function toggleTheme() {
  const body = document.body;
  const isLight = body.classList.toggle('light-mode');
  localStorage.setItem('pn_theme', isLight ? 'light' : 'dark');

  const btn = document.getElementById('theme-toggle-btn');
  btn.classList.toggle('on', isLight);
  document.getElementById('theme-sublabel').textContent = isLight ? 'Light Mode' : 'Dark Mode';
  btn.querySelector('.theme-toggle-thumb').textContent = isLight ? '☀️' : '🌙';
}

// Apply saved theme on load
(function applyTheme() {
  const saved = localStorage.getItem('pn_theme');
  if (saved === 'light') {
    document.body.classList.add('light-mode');
  }
})();

/* ── Change Email ── */
async function changeEmail() {
  const newEmail = document.getElementById('settings-new-email').value.trim();
  const errEl  = document.getElementById('settings-email-error');
  const okEl   = document.getElementById('settings-email-success');
  errEl.classList.remove('show');
  okEl.classList.remove('show');

  if (!newEmail) {
    errEl.textContent = 'Enter a new email address.';
    errEl.classList.add('show');
    return;
  }

  try {
    await sbFetch('/auth/v1/user', {
      method: 'PUT',
      body: JSON.stringify({ email: newEmail }),
    });
    okEl.textContent = 'Confirmation sent! Check your new email to confirm the change.';
    okEl.classList.add('show');
    document.getElementById('settings-new-email').value = '';
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.add('show');
  }
}

/* ── Change Password ── */
async function changePassword() {
  const newPass     = document.getElementById('settings-new-pass').value;
  const confirmPass = document.getElementById('settings-confirm-pass').value;
  const errEl  = document.getElementById('settings-pass-error');
  const okEl   = document.getElementById('settings-pass-success');
  errEl.classList.remove('show');
  okEl.classList.remove('show');

  if (!newPass || !confirmPass) {
    errEl.textContent = 'Fill in both password fields.';
    errEl.classList.add('show');
    return;
  }
  if (newPass.length < 6) {
    errEl.textContent = 'Password must be at least 6 characters.';
    errEl.classList.add('show');
    return;
  }
  if (newPass !== confirmPass) {
    errEl.textContent = 'Passwords do not match.';
    errEl.classList.add('show');
    return;
  }

  try {
    await sbFetch('/auth/v1/user', {
      method: 'PUT',
      body: JSON.stringify({ password: newPass }),
    });
    okEl.textContent = '✅ Password updated successfully!';
    okEl.classList.add('show');
    document.getElementById('settings-new-pass').value = '';
    document.getElementById('settings-confirm-pass').value = '';
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.add('show');
  }
}
