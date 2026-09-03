/* =========================================================================
   CLINIC WHATSAPP BOT â€” FAILI MOJA KAMILI
   Kila kitu (database, WhatsApp sender, mtiririko wa mgonjwa, dashboard,
   na server) kiko ndani ya faili hii moja. Hakuna folder za "lib" wala
   faili nyingine za code zinazohitajika.

   JINSI YA KUENDESHA:
     1) npm install
     2) nakili .env.example kuwa .env na jaza taarifa zako
     3) npm start
   ========================================================================= */

import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import axios from 'axios';
import { JSONFilePreset } from 'lowdb/node';

/* ------------------------------------------------------------------------
   SEHEMU YA 1: DATABASE (faili la data.json, bure, hakuna server ya nje)
   ------------------------------------------------------------------------ */

const defaultData = {
  staff: [],
  patients: [],
  products: [],
  outbox: {},
  roleQueue: { doctor: [], room3: [], pharmacy: [] },
  nextPatientId: 1
};

const db = await JSONFilePreset('data.json', defaultData);

async function findStaffByPhone(phone) {
  return db.data.staff.find(s => s.phone === phone) || null;
}

async function registerStaff(phone, role) {
  const existing = await findStaffByPhone(phone);
  if (existing) {
    existing.role = role;
    await db.write();
    await flushRoleQueue(role, phone);
    return existing;
  }
  const staff = { phone, role };
  db.data.staff.push(staff);
  await db.write();
  await flushRoleQueue(role, phone);
  return staff;
}

async function flushRoleQueue(role, phone) {
  const queue = db.data.roleQueue[role];
  if (!queue || queue.length === 0) return;
  for (const text of queue) {
    await sendMessage(phone, text);
  }
  db.data.roleQueue[role] = [];
  await db.write();
}

async function broadcastToRole(role, text) {
  const members = await staffByRole(role);
  if (members.length > 0) {
    await broadcast(members.map(m => m.phone), text);
  } else {
    db.data.roleQueue[role].push(text);
    await db.write();
  }
}

async function staffByRole(role) {
  return db.data.staff.filter(s => s.role === role);
}

async function createPatient(info) {
  const patient = {
    id: db.data.nextPatientId++,
    info,
    status: 'reception',
    doctorNotes: '',
    room3Notes: '',
    createdAt: new Date().toISOString()
  };
  db.data.patients.push(patient);
  await db.write();
  return patient;
}

async function getPatient(id) {
  return db.data.patients.find(p => p.id === Number(id)) || null;
}

async function updatePatient(id, updates) {
  const patient = await getPatient(id);
  if (!patient) return null;
  Object.assign(patient, updates);
  await db.write();
  return patient;
}

async function listProducts() {
  return db.data.products;
}

async function addProduct(name, price, mfgDate, expDate) {
  const existing = db.data.products.find(
    p => p.name.toLowerCase() === name.toLowerCase()
  );
  if (existing) {
    existing.price = price;
    if (mfgDate) existing.mfgDate = mfgDate;
    if (expDate) existing.expDate = expDate;
  } else {
    db.data.products.push({
      name,
      price,
      mfgDate: mfgDate || '',
      expDate: expDate || '',
      addedAt: new Date().toISOString()
    });
  }
  await db.write();
  return db.data.products;
}

async function listPatients() {
  return [...db.data.patients].sort((a, b) => b.id - a.id);
}

async function getStats() {
  const patients = db.data.patients;
  return {
    total: patients.length,
    waitingDoctor: patients.filter(p => p.status === 'reception').length,
    waitingRoom3: patients.filter(p => p.status === 'doctor').length,
    waitingPharmacy: patients.filter(p => p.status === 'room3').length,
    completed: patients.filter(p => p.status === 'kamili').length,
    totalProducts: db.data.products.length
  };
}

/* ------------------------------------------------------------------------
   SEHEMU YA 2: KUTUMA UJUMBE WA WHATSAPP (Meta Cloud API)
   ------------------------------------------------------------------------ */

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const GRAPH_URL = `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

async function sendMessage(to, text) {
  if (!db.data.outbox[to]) db.data.outbox[to] = [];
  db.data.outbox[to].push({ text, at: Date.now() });
  await db.write();

  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.log(`[SIMULATED WHATSAPP MESSAGE to ${to}]:\n${text}\n`);
    return;
  }
  try {
    await axios.post(
      GRAPH_URL,
      { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );
  } catch (err) {
    console.error('Failed to send WhatsApp message:', err.response?.data || err.message);
  }
}

async function broadcast(numbers, text) {
  await Promise.all(numbers.map(n => sendMessage(n, text)));
}

/* ------------------------------------------------------------------------
   SEHEMU YA 3: MTIRIRIKO WA MGONJWA (PIN, receptionâ†’doctorâ†’room3â†’pharmacy)
   ------------------------------------------------------------------------ */

const PINS = {
  [process.env.PIN_RECEPTION || '1111']: 'reception',
  [process.env.PIN_DOCTOR || '2222']: 'doctor',
  [process.env.PIN_ROOM3 || '3333']: 'room3',
  [process.env.PIN_PHARMACY || '4444']: 'pharmacy'
};

const ROLE_NAMES = {
  reception: 'Reception',
  doctor: 'Daktari',
  room3: 'Chumba cha 3',
  pharmacy: 'Pharmacy'
};

function help(role) {
  switch (role) {
    case 'reception':
      return 'Tuma taarifa za mgonjwa mpya kama ujumbe wa kawaida, mfano:\n"Jina: Asha, Umri: 24, Tatizo: Homa"';
    case 'doctor':
      return 'Kujibu mgonjwa: JIBU <ID> <matibabu>\nMfano: JIBU 3 Ana malaria, tumia Coartem';
    case 'room3':
      return 'Kujibu mgonjwa: JIBU <ID> <maelezo>\nMfano: JIBU 3 Vipimo vimefanyika, tayari kwa dawa';
    case 'pharmacy':
      return 'Amri: \nTOA <ID> - kutoa dawa\nONGEZA <jina>,<bei> - kuongeza/kuhariri bidhaa\nONGEZA <jina>,<bei>,<tarehe ya kutengenezwa>,<exp date> - na tarehe (mfano: ONGEZA Panadol,500,2026-01-15,2027-01-15)\nORODHA - kuona bidhaa zote';
    default:
      return '';
  }
}

async function handleIncomingMessage(from, rawText) {
  const text = (rawText || '').trim();
  let staff = await findStaffByPhone(from);

  if (!staff) {
    const role = PINS[text];
    if (role) {
      staff = await registerStaff(from, role);
      await sendMessage(from, `Karibu! Umesajiliwa kama *${ROLE_NAMES[role]}*.\n\n${help(role)}`);
    } else {
      await sendMessage(from, 'Tafadhali tuma PIN yako kwanza kuingia mfumoni.');
    }
    return;
  }

  const role = staff.role;

  if (PINS[text] && PINS[text] !== role) {
    staff = await registerStaff(from, PINS[text]);
    await sendMessage(from, `Umebadilisha role kuwa *${ROLE_NAMES[staff.role]}*.\n\n${help(staff.role)}`);
    return;
  }

  if (/^(SAIDIA|HELP)$/i.test(text)) {
    await sendMessage(from, help(role));
    return;
  }

  if (role === 'reception') {
    const patient = await createPatient(text);
    await sendMessage(from, `Sawa, mgonjwa #${patient.id} amesajiliwa na ametumwa kwa Daktari.`);
    await broadcastToRole('doctor', `ðŸ©º Mgonjwa mpya #${patient.id}\n${text}\n\nJibu: JIBU ${patient.id} <matibabu>`);
    return;
  }

  if (role === 'doctor') {
    const match = text.match(/^JIBU\s+(\d+)\s+([\s\S]+)$/i);
    if (!match) { await sendMessage(from, help(role)); return; }
    const [, id, notes] = match;
    const patient = await getPatient(id);
    if (!patient) { await sendMessage(from, `Sijampata mgonjwa #${id}.`); return; }
    await updatePatient(id, { status: 'doctor', doctorNotes: notes });
    await sendMessage(from, `Sawa, mgonjwa #${id} ametumwa Chumba cha 3.`);
    await broadcastToRole('room3', `ðŸ“‹ Mgonjwa #${id}\nTaarifa: ${patient.info}\nMatibabu ya Daktari: ${notes}\n\nJibu: JIBU ${id} <maelezo>`);
    return;
  }

  if (role === 'room3') {
    const match = text.match(/^JIBU\s+(\d+)\s+([\s\S]+)$/i);
    if (!match) { await sendMessage(from, help(role)); return; }
    const [, id, notes] = match;
    const patient = await getPatient(id);
    if (!patient) { await sendMessage(from, `Sijampata mgonjwa #${id}.`); return; }
    await updatePatient(id, { status: 'room3', room3Notes: notes });
    await sendMessage(from, `Sawa, mgonjwa #${id} ametumwa Pharmacy.`);
    await broadcastToRole('pharmacy', `ðŸ’Š Mgonjwa #${id} tayari kwa dawa\nTaarifa: ${patient.info}\nMatibabu: ${patient.doctorNotes}\nChumba 3: ${notes}\n\nJibu: TOA ${id}`);
    return;
  }

  if (role === 'pharmacy') {
    if (/^ORODHA$/i.test(text)) {
      const products = await listProducts();
      if (products.length === 0) {
        await sendMessage(from, 'Bado hakuna bidhaa kwenye orodha.');
      } else {
        const list = products.map(p => {
          let line = `â€¢ ${p.name} â€” Sh${p.price}`;
          if (p.mfgDate) line += `\n  Tengenezwa: ${p.mfgDate}`;
          if (p.expDate) line += `\n  Inaisha: ${p.expDate}`;
          return line;
        }).join('\n');
        await sendMessage(from, `Bidhaa zilizopo:\n${list}`);
      }
      return;
    }

    const addMatch = text.match(/^ONGEZA\s+([^,]+),\s*(\d+(\.\d+)?)\s*(?:,\s*([^,]*))?\s*(?:,\s*([^,]*))?$/i);
    if (addMatch) {
      const [, name, price, , mfgDate, expDate] = addMatch;
      await addProduct(name.trim(), Number(price), (mfgDate || '').trim(), (expDate || '').trim());
      let reply = `Sawa, "${name.trim()}" imesajiliwa kwa bei Sh${price}.`;
      if (mfgDate) reply += ` Tengenezwa: ${mfgDate.trim()}.`;
      if (expDate) reply += ` Inaisha: ${expDate.trim()}.`;
      await sendMessage(from, reply);
      return;
    }

    const doneMatch = text.match(/^TOA\s+(\d+)$/i);
    if (doneMatch) {
      const [, id] = doneMatch;
      const patient = await getPatient(id);
      if (!patient) { await sendMessage(from, `Sijampata mgonjwa #${id}.`); return; }
      await updatePatient(id, { status: 'kamili' });
      await sendMessage(from, `Sawa, mgonjwa #${id} amepewa dawa. Huduma imekamilika âœ…`);
      return;
    }

    await sendMessage(from, help(role));
    return;
  }
}

/* ------------------------------------------------------------------------
   SEHEMU YA 4: DASHBOARD YA DAKTARI (view-only, na password)
   ------------------------------------------------------------------------ */

const STATUS_LABELS = {
  reception: { label: 'Anasubiri Daktari', color: '#D4A017' },
  doctor: { label: 'Anasubiri Chumba 3', color: '#2E7D6B' },
  room3: { label: 'Tayari kwa Dawa', color: '#4472C4' },
  kamili: { label: 'Kamili âœ…', color: '#5C8C7F' }
};

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function baseStyles() {
  return `<style>
    *{box-sizing:border-box;}
    body{font-family:system-ui,-apple-system,sans-serif;background:#082B29;margin:0;color:#1C2422;}
    .wrap{max-width:760px;margin:0 auto;padding:20px 16px 40px;}
    h1{font-size:19px;color:#F5F1E6;margin:0;}
    h2{font-size:15px;color:#F5F1E6;margin:26px 0 10px;}
    .topbar{display:flex;justify-content:space-between;align-items:center;padding:8px 0 4px;}
    .logout{color:#D4A017;font-size:12px;text-decoration:none;font-weight:600;}
    .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:16px;}
    .stat{background:#F5F1E6;border-radius:12px;padding:12px 8px;text-align:center;}
    .stat b{display:block;font-size:20px;color:#0B3D3A;}
    .stat span{font-size:10px;color:#5B6864;font-weight:600;}
    .table-wrap{background:#F5F1E6;border-radius:12px;overflow:hidden;overflow-x:auto;}
    table{width:100%;border-collapse:collapse;font-size:12.5px;}
    th{text-align:left;background:#EAE3D2;padding:8px 10px;color:#5B6864;font-size:10.5px;text-transform:uppercase;}
    td{padding:9px 10px;border-top:1px solid #EAE3D2;}
    .badge{color:#fff;padding:3px 8px;border-radius:8px;font-size:10.5px;font-weight:600;white-space:nowrap;}
    .empty{text-align:center;color:#9AA6A2;padding:16px;}
    .note{color:#9FB3AE;font-size:11px;text-align:center;margin-top:20px;}
    .login-wrap{display:flex;align-items:center;justify-content:center;min-height:90vh;}
    .login-card{background:#F5F1E6;border-radius:16px;padding:26px 22px;max-width:320px;width:100%;text-align:center;}
    .login-card h1{color:#0B3D3A;font-size:17px;}
    .login-card .sub{color:#5B6864;font-size:12px;margin:6px 0 18px;}
    .login-card input{width:100%;padding:11px;border-radius:10px;border:1px solid #D8CFB8;margin-bottom:10px;font-size:14px;}
    .login-card button{width:100%;padding:11px;border-radius:10px;border:none;background:#0B3D3A;color:#F5F1E6;font-weight:700;font-size:14px;cursor:pointer;}
    .error{color:#B4483C;font-size:12px;margin-top:10px;}
  </style>`;
}

function renderLoginPage(error) {
  return `<!DOCTYPE html>
<html lang="sw"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dashboard â€” Ingia</title>
${baseStyles()}
</head><body>
<div class="wrap login-wrap">
  <div class="login-card">
    <h1>ðŸ©º Dashboard ya Daktari</h1>
    <p class="sub">Ingiza password kuona taarifa za kliniki</p>
    <form method="POST" action="/dashboard">
      <input type="password" name="password" placeholder="Password" autofocus>
      <button type="submit">Ingia</button>
    </form>
    ${error ? `<p class="error">Password si sahihi. Jaribu tena.</p>` : ''}
  </div>
</div>
</body></html>`;
}

async function renderDashboard() {
  const patients = await listPatients();
  const products = await listProducts();
  const stats = await getStats();

  const patientRows = patients.length === 0
    ? `<tr><td colspan="4" class="empty">Bado hakuna mgonjwa</td></tr>`
    : patients.map(p => {
        const s = STATUS_LABELS[p.status] || { label: p.status, color: '#999' };
        return `<tr>
          <td>#${p.id}</td>
          <td>${escapeHtml(p.info)}</td>
          <td><span class="badge" style="background:${s.color}">${s.label}</span></td>
          <td>${new Date(p.createdAt).toLocaleString('sw-TZ')}</td>
        </tr>`;
      }).join('');

  const productRows = products.length === 0
    ? `<tr><td colspan="4" class="empty">Bado hakuna bidhaa</td></tr>`
    : products.map(p => {
        const today = new Date().toISOString().slice(0,10);
        const isExpired = p.expDate && p.expDate < today;
        const expCell = p.expDate
          ? `<span style="${isExpired ? 'color:#B4483C;font-weight:700;' : ''}">${escapeHtml(p.expDate)}${isExpired ? ' âš ï¸' : ''}</span>`
          : 'â€”';
        return `<tr><td>${escapeHtml(p.name)}</td><td>Sh${p.price}</td><td>${p.mfgDate ? escapeHtml(p.mfgDate) : 'â€”'}</td><td>${expCell}</td></tr>`;
      }).join('');

  return `<!DOCTYPE html>
<html lang="sw"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dashboard â€” Daktari</title>
${baseStyles()}
</head><body>
<div class="wrap">
  <div class="topbar">
    <h1>ðŸ©º Dashboard ya Kliniki</h1>
    <a href="/dashboard/logout" class="logout">Toka</a>
  </div>
  <div class="stats">
    <div class="stat"><b>${stats.total}</b><span>Wagonjwa Wote</span></div>
    <div class="stat"><b>${stats.waitingDoctor}</b><span>Wanasubiri Daktari</span></div>
    <div class="stat"><b>${stats.waitingRoom3}</b><span>Wanasubiri Chumba 3</span></div>
    <div class="stat"><b>${stats.waitingPharmacy}</b><span>Tayari kwa Dawa</span></div>
    <div class="stat"><b>${stats.completed}</b><span>Wamekamilika</span></div>
    <div class="stat"><b>${stats.totalProducts}</b><span>Bidhaa Dukani</span></div>
  </div>
  <h2>Wagonjwa</h2>
  <div class="table-wrap">
    <table><thead><tr><th>ID</th><th>Taarifa</th><th>Hatua</th><th>Muda</th></tr></thead>
    <tbody>${patientRows}</tbody></table>
  </div>
  <h2>Bidhaa za Pharmacy</h2>
  <div class="table-wrap">
    <table><thead><tr><th>Jina</th><th>Bei</th><th>Tengenezwa</th><th>Exp Date</th></tr></thead>
    <tbody>${productRows}</tbody></table>
  </div>
  <p class="note">Dashboard hii ni ya kuangalia tu (view-only) â€” mabadiliko yote yanafanyika kupitia WhatsApp.</p>
</div>
</body></html>`;
}

/* ------------------------------------------------------------------------
   SEHEMU YA 5: SERVER (webhook ya WhatsApp + dashboard)
   ------------------------------------------------------------------------ */

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'clinic-verify-123';
const PORT = process.env.PORT || 3000;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'daktari123';
const AUTH_COOKIE_VALUE = crypto.createHash('sha256').update(DASHBOARD_PASSWORD).digest('hex');

function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  header.split(';').forEach(pair => {
    const [k, ...v] = pair.trim().split('=');
    cookies[k] = decodeURIComponent(v.join('='));
  });
  return cookies;
}

function isAuthed(req) {
  return parseCookies(req).dash_auth === AUTH_COOKIE_VALUE;
}

app.get('/', (req, res) => {
  res.send('Clinic WhatsApp bot iko live âœ… (dashboard: /dashboard)');
});

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified.');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const messages = change?.value?.messages;
    if (!messages || messages.length === 0) return;
    for (const msg of messages) {
      if (msg.type !== 'text') continue;
      await handleIncomingMessage(msg.from, msg.text?.body || '');
    }
  } catch (err) {
    console.error('Error handling webhook:', err);
  }
});

app.get('/dashboard', async (req, res) => {
  if (!isAuthed(req)) return res.send(renderLoginPage(false));
  res.send(await renderDashboard());
});

app.post('/dashboard', (req, res) => {
  if (req.body.password === DASHBOARD_PASSWORD) {
    res.setHeader('Set-Cookie', `dash_auth=${AUTH_COOKIE_VALUE}; HttpOnly; Path=/; Max-Age=86400`);
    return res.redirect('/dashboard');
  }
  res.send(renderLoginPage(true));
});

app.get('/dashboard/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'dash_auth=; HttpOnly; Path=/; Max-Age=0');
  res.redirect('/dashboard');
});

// --- Real cross-device test mode (before WhatsApp number is ready) ---

app.post('/simulate', async (req, res) => {
  const { from, text } = req.body;
  if (!from || !text) return res.status(400).json({ error: 'from na text vinahitajika' });
  await handleIncomingMessage(String(from), String(text));
  res.json({ ok: true });
});

app.get('/inbox/:phone', async (req, res) => {
  const phone = req.params.phone;
  const messages = db.data.outbox[phone] || [];
  db.data.outbox[phone] = [];
  await db.write();
  res.json({ messages });
});

app.get('/test', (req, res) => {
  res.send(renderTestPage());
});

function renderTestPage() {
  return `<!DOCTYPE html>
<html lang="sw"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<title>Clinic Bot â€” Jaribio la Kweli</title>
<style>
  *{box-sizing:border-box;}
  body{margin:0;background:#082B29;font-family:system-ui,-apple-system,sans-serif;display:flex;justify-content:center;padding:14px;}
  .wrap{width:100%;max-width:420px;}
  h1{color:#F5F1E6;font-size:18px;text-align:center;margin:6px 0 2px;}
  p.sub{color:#B9CFC9;font-size:11.5px;text-align:center;margin:0 0 16px;}
  .card{background:#F5F1E6;border-radius:16px;overflow:hidden;box-shadow:0 12px 30px rgba(0,0,0,.3);}
  .setup{padding:14px;border-bottom:1px solid #EAE3D2;}
  .setup label{font-size:11px;color:#5B6864;font-weight:600;display:block;margin-bottom:4px;}
  .setup input{width:100%;padding:9px 10px;border-radius:8px;border:1px solid #D8CFB8;font-size:13px;margin-bottom:8px;}
  .setup .status{font-size:11px;color:#0B3D3A;font-weight:700;}
  .messages{height:360px;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#EAE3D2;}
  .msg{max-width:82%;padding:9px 12px;border-radius:14px;font-size:13px;white-space:pre-wrap;line-height:1.4;}
  .msg.bot{align-self:flex-start;background:#fff;border-bottom-left-radius:4px;}
  .msg.user{align-self:flex-end;background:#DCF3D8;border-bottom-right-radius:4px;}
  .composer{display:flex;gap:8px;padding:10px;background:#F5F1E6;}
  .composer input{flex:1;border:1px solid #D8CFB8;border-radius:20px;padding:10px 14px;font-size:13.5px;}
  .composer button{background:#0B3D3A;color:#F5F1E6;border:none;width:40px;height:40px;border-radius:50%;font-size:16px;cursor:pointer;}
  .quickrow{display:flex;gap:6px;flex-wrap:wrap;padding:0 10px 10px;background:#F5F1E6;}
  .quickrow button{border:1px solid #0B3D3A;color:#0B3D3A;background:transparent;font-size:11px;font-weight:600;padding:6px 10px;border-radius:14px;cursor:pointer;}
  .dashlink{display:block;text-align:center;color:#D4A017;font-size:11.5px;margin-top:12px;text-decoration:none;font-weight:600;}
</style>
</head><body>
<div class="wrap">
  <h1>ðŸ¥ Clinic Bot â€” Jaribio la Kweli</h1>
  <p class="sub">Ukifungua hii kwenye vifaa viwili tofauti, zote zinaongea na server hii hii â€” matokeo halisi.</p>
  <div class="card">
    <div class="setup">
      <label>Namba yako (yoyote â€” mfano: 0712345678)</label>
      <input id="phone" placeholder="0712345678">
      <div class="status" id="statusLine">Ingiza namba yako kuanza</div>
    </div>
    <div class="messages" id="messages"></div>
    <div class="quickrow" id="quickrow"></div>
    <div class="composer">
      <input id="input" type="text" placeholder="Andika PIN au ujumbe...">
      <button id="sendBtn">âž¤</button>
    </div>
  </div>
  <a class="dashlink" href="/dashboard">ðŸ“Š Fungua Dashboard ya Daktari</a>
</div>
<script>
let phone = localStorage.getItem('clinicPhone') || '';
document.getElementById('phone').value = phone;

function addMsg(text, cls){
  const box = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = 'msg ' + cls;
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function renderQuick(){
  const row = document.getElementById('quickrow');
  row.innerHTML = '';
  ['1111 (Reception)','2222 (Daktari)','3333 (Chumba 3)','4444 (Pharmacy)'].forEach(label=>{
    const pin = label.split(' ')[0];
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.onclick = () => { document.getElementById('input').value = pin; send(); };
    row.appendChild(btn);
  });
}
renderQuick();

document.getElementById('phone').addEventListener('change', e=>{
  phone = e.target.value.trim();
  localStorage.setItem('clinicPhone', phone);
  document.getElementById('statusLine').textContent = phone ? ('Umeingia kama: ' + phone) : 'Ingiza namba yako kuanza';
});
if (phone) document.getElementById('statusLine').textContent = 'Umeingia kama: ' + phone;

async function send(){
  const input = document.getElementById('input');
  const text = input.value.trim();
  if (!phone){ alert('Weka namba yako kwanza juu.'); return; }
  if (!text) return;
  input.value = '';
  addMsg(text, 'user');
  await fetch('/simulate', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ from: phone, text })
  });
}
document.getElementById('sendBtn').onclick = send;
document.getElementById('input').addEventListener('keydown', e=>{ if (e.key==='Enter') send(); });

// Poll for incoming messages every 2 seconds
setInterval(async ()=>{
  if (!phone) return;
  try {
    const res = await fetch('/inbox/' + encodeURIComponent(phone));
    const data = await res.json();
    (data.messages || []).forEach(m => addMsg(m.text, 'bot'));
  } catch(e){}
}, 2000);
</script>
</body></html>`;
}

app.listen(PORT, () => {
  console.log(`Clinic bot inasikiliza kwenye port ${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/dashboard`);
  if (!WHATSAPP_TOKEN) {
    console.log('âš ï¸  WHATSAPP_TOKEN haijawekwa bado â€” ujumbe utaonekana tu kwenye console (simulation mode).');
  }
});
