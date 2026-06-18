// ═══════════════════════════════════════════════════════════════════════════
// frontend-api-integration.js
// FRMC Clinic Management System — Backend API bridge
//
// SETUP:
//   1. Place this file in the same folder as medcore-clinic.html
//   2. Change API_BASE below to your backend URL
//   3. Make sure the backend is running: cd frmc-backend && npm start
//   4. Open medcore-clinic.html in a browser
// ═══════════════════════════════════════════════════════════════════════════

const API_BASE = 'https://frmc-backend-production.up.railway.app/api/v1';  // ← change for production

// ── Token storage (sessionStorage survives tab, not browser close) ──────────
let _accessToken  = sessionStorage.getItem('frmc_at') || null;
let _refreshToken = sessionStorage.getItem('frmc_rt') || null;

function _setTokens(at, rt) {
  _accessToken  = at;
  _refreshToken = rt;
  if (at) sessionStorage.setItem('frmc_at', at);
  else    sessionStorage.removeItem('frmc_at');
  if (rt) sessionStorage.setItem('frmc_rt', rt);
  else    sessionStorage.removeItem('frmc_rt');
}

// ── Role → display label + navigation section permissions ───────────────────
const _ROLE_MAP = {
  admin:      {
    label: 'Administrator',
    perms: ['dashboard','reception','patients','dental','hemorrhoid','medical',
            'pharmacy','expenses','reports','receipts','management','settings'],
  },
  reception:  {
    label: 'Reception',
    perms: ['reception','patients','pharmacy'],
  },
  dental:     { label: 'Dental Doctor',  perms: ['dashboard','dental','patients'] },
  hemorrhoid: { label: 'Hemorrhoid Dr.', perms: ['dashboard','hemorrhoid','patients'] },
  medical:    { label: 'Medical Doctor', perms: ['dashboard','medical','patients'] },
  pharmacy:   { label: 'Pharmacist',     perms: ['dashboard','pharmacy','patients'] },
};

// ── Central fetch helper with auto token-refresh on 401 ─────────────────────
async function _apiFetch(path, options = {}) {
  const url     = API_BASE + path;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (_accessToken) headers['Authorization'] = 'Bearer ' + _accessToken;

  let res = await fetch(url, { ...options, headers });

  if (res.status === 401 && _refreshToken) {
    const refreshed = await _doRefresh();
    if (refreshed) {
      headers['Authorization'] = 'Bearer ' + _accessToken;
      res = await fetch(url, { ...options, headers });
    }
  }

  if (res.status === 401) {
    // Session is truly gone (no token, or refresh failed/expired).
    // Tell the rest of the app so it can return to the login screen
    // instead of silently failing every subsequent action.
    // (Skip this for the login endpoint itself — a 401 there just
    // means wrong username/password, not an expired session.)
    _setTokens(null, null);
    if (!path.startsWith('/auth/login')) {
      document.dispatchEvent(new CustomEvent('frmc:session-expired'));
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg  = body.message || body.error || ('HTTP ' + res.status);
    throw Object.assign(new Error(msg), { status: res.status, body });
  }

  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : null;
}

async function _doRefresh() {
  try {
    const res = await fetch(API_BASE + '/auth/refresh', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ refresh_token: _refreshToken }),
    });
    if (!res.ok) { _setTokens(null, null); return false; }
    const data = await res.json();
    _setTokens(data.data.accessToken, data.data.refreshToken || _refreshToken);
    return true;
  } catch {
    _setTokens(null, null);
    return false;
  }
}

function _d(res) {
  return (res && res.data !== undefined) ? res.data : res;
}

// ════════════════════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════════════════════

async function API_login(username, password) {
  try {
    const res  = await _apiFetch('/auth/login', {
      method: 'POST',
      body:   JSON.stringify({ username, password }),
    });
    const data = _d(res);
    _setTokens(data.accessToken, data.refreshToken);
    const user   = data.user;
    const mapped = _ROLE_MAP[user.role] || { label: user.role, perms: ['dashboard'] };
    return {
      id:       user.id,
      name:     user.full_name,
      username: user.username,
      role:     mapped.label,
      _rawRole: user.role,
      perms:    mapped.perms,
    };
  } catch (err) {
    if (err.status === 401 || err.status === 400) return null;
    throw err;
  }
}

async function API_logout() {
  try {
    await _apiFetch('/auth/logout', { method: 'POST' });
  } catch { /* ignore */ } finally {
    _setTokens(null, null);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PRINT SETTINGS  (localStorage only)
// ════════════════════════════════════════════════════════════════════════════

function API_loadPrintSettings() {
  try {
    const raw = localStorage.getItem('frmc_print_cfg');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function API_savePrintSettings(cfg) {
  try { localStorage.setItem('frmc_print_cfg', JSON.stringify(cfg)); } catch {}
}

// ════════════════════════════════════════════════════════════════════════════
// PATIENTS
// ════════════════════════════════════════════════════════════════════════════

async function API_searchPatient(query) {
  try {
    const res = await _apiFetch('/patients/search?q=' + encodeURIComponent(query));
    return _d(res) || [];
  } catch { return []; }
}

async function API_createPatient(payload) {
  try {
    const res = await _apiFetch('/patients', {
      method: 'POST',
      body:   JSON.stringify(payload),
    });
    return _d(res);
  } catch (err) {
    console.error('API_createPatient:', err.message);
    if (typeof toast==='function') toast(err.message,'err');
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CONSULTATIONS
// ════════════════════════════════════════════════════════════════════════════

async function API_loadReceptions() {
  try {
    const today    = new Date().toISOString().slice(0, 10);
    const res      = await _apiFetch('/consultations?date=' + today + '&limit=200');
    const rows     = _d(res) || [];
    const dkOf     = function(d){ return {'Dental':'dental','Dental Department':'dental','Hemorrhoid':'hemorrhoid','Hemorrhoid Department':'hemorrhoid','Medical':'medical','Medical Department':'medical','Pharmacy':'pharmacy'}[d]||'medical'; };
    const calcAge  = function(dob){ if(!dob)return null; return Math.floor((Date.now()-new Date(dob).getTime())/(365.25*24*3600*1000)); };
    return rows.map(function(c) {
      const st  = c.invoice && c.invoice.status;
      const pay = st==='paid'?'paid':st==='partial'?'partial':'pending';
      return {
        id:c.id,_bid:c.id,patientId:c.patient_id,
        invoiceId:c.invoice_id||(c.invoice&&c.invoice.id),
        date:c.consultation_date,
        time:(c.created_at||'').slice(11,16)||'09:00',
        name:c.patient?c.patient.full_name:(c.patient_name||''),
        phone:c.patient?(c.patient.phone||''):'',
        age:c.patient?calcAge(c.patient.date_of_birth):null,
        addr:c.patient?(c.patient.address||''):'',
        dept:c.department,deptKey:dkOf(c.department),
        doctor:c.doctor_name||'',vtype:c.visit_type||'New patient',
        fee:parseFloat(c.consultation_fee)||0,cur:c.currency||'SSP',
        pay:c.payment_method||'Cash',status:c.status||'waiting',
        paymentStatus:pay,invoiceNo:c.consultation_number,
        invoiceLocked:st==='paid',staff:c.created_by_name||'',
        createdBy:c.created_by_name||'',notes:c.notes||'',
      };
    });
  } catch (err) {
    console.error('API_loadReceptions:', err.message);
    return [];
  }
}

async function API_createConsultation(payload) {
  try {
    const res = await _apiFetch('/consultations', { method:'POST', body:JSON.stringify(payload) });
    return _d(res);
  } catch (err) {
    console.error('API_createConsultation:', err.message);
    if (typeof toast==='function') toast(err.message,'err');
    return null;
  }
}

async function API_updateConsultation(id, payload) {
  try {
    const res = await _apiFetch('/consultations/'+id, { method:'PATCH', body:JSON.stringify(payload) });
    return _d(res);
  } catch (err) {
    console.error('API_updateConsultation:', err.message);
    if (typeof toast==='function') toast(err.message,'err');
    return null;
  }
}

async function API_deleteConsultation(id) {
  try {
    await _apiFetch('/consultations/'+id+'/status', { method:'PATCH', body:JSON.stringify({status:'cancelled'}) });
    return true;
  } catch (err) {
    console.error('API_deleteConsultation:', err.message);
    if (typeof toast==='function') toast(err.message,'err');
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TREATMENTS
// ════════════════════════════════════════════════════════════════════════════

async function API_loadTreatments(consultationId) {
  try {
    const res  = await _apiFetch('/treatments?consultation_id='+consultationId+'&limit=100');
    const rows = _d(res)||[];
    const dkOf = function(d){ return {'Dental':'dental','Dental Department':'dental','Hemorrhoid':'hemorrhoid','Hemorrhoid Department':'hemorrhoid','Medical':'medical','Medical Department':'medical','Pharmacy':'pharmacy'}[d]||'medical'; };
    return rows.map(function(t){
      return {
        id:t.id,_bid:t.id,patientId:t.consultation_id,
        patientName:t.patient?t.patient.full_name:'',
        dept:t.department,deptKey:dkOf(t.department),
        name:t.treatment_name,location:t.location||'',
        status:t.status||'planned',cost:parseFloat(t.treatment_cost)||0,
        cur:t.currency||'SSP',date:t.treatment_date,
        diagnosis:t.diagnosis||'',notes:t.notes||'',
        chart:t.chart_reference||'',meds:t.medications||'',
        staff:t.created_by_name||'',
      };
    });
  } catch (err) {
    console.error('API_loadTreatments:', err.message);
    return [];
  }
}

async function API_createTreatment(payload) {
  try {
    const res = await _apiFetch('/treatments', { method:'POST', body:JSON.stringify(payload) });
    return _d(res);
  } catch (err) {
    console.error('API_createTreatment:', err.message);
    if (typeof toast==='function') toast(err.message,'err');
    return null;
  }
}

async function API_updateTreatment(id, payload) {
  try {
    const res = await _apiFetch('/treatments/'+id+'/status', { method:'PATCH', body:JSON.stringify(payload) });
    return _d(res);
  } catch (err) {
    console.error('API_updateTreatment:', err.message);
    if (typeof toast==='function') toast(err.message,'err');
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PENDING TREATMENT INVOICES
// ════════════════════════════════════════════════════════════════════════════

async function API_loadPendingTxInvoices() {
  try {
    const res  = await _apiFetch('/invoices/pending?type=treatment&limit=100');
    const rows = _d(res)||[];
    return rows.map(function(inv){
      const items=(inv.items||[]).map(function(item){
        return { name:item.description||item.item_name||'', cost:parseFloat(item.total_price||item.unit_price)||0, cur:inv.currency||'SSP', date:(inv.created_at||'').slice(0,10) };
      });
      return {
        id:inv.id,_bid:inv.id,invoiceId:inv.id,
        patientId:inv.reference_id||inv.patient_id,
        patientName:inv.patient?inv.patient.full_name:(inv.patient_name||''),
        invoiceNo:inv.invoice_number,dept:inv.department||'',
        deptKey:inv.dept_key||'',doctor:inv.doctor_name||'',
        date:(inv.created_at||'').slice(0,10),
        time:(inv.created_at||'').slice(11,16),
        paymentStatus:inv.status||'pending',currency:inv.currency||'SSP',
        items:items,pay:'',payRef:'',paidBy:'',locked:inv.status==='paid',
      };
    });
  } catch (err) {
    console.error('API_loadPendingTxInvoices:', err.message);
    return [];
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PAYMENTS
// ════════════════════════════════════════════════════════════════════════════

async function API_recordPayment(invoiceId, amount, currency, paymentMethod, paymentReference, notes) {
  try {
    const res = await _apiFetch('/payments', {
      method:'POST',
      body:JSON.stringify({ invoice_id:invoiceId, amount, currency, payment_method:paymentMethod||'Cash', payment_reference:paymentReference||null, notes:notes||null }),
    });
    return _d(res);
  } catch (err) {
    console.error('API_recordPayment:', err.message);
    if (typeof toast==='function') toast(err.message,'err');
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PHARMACY SALES
// ════════════════════════════════════════════════════════════════════════════

async function API_completeSale(payload) {
  try {
    const res = await _apiFetch('/pharmacy/sales', { method:'POST', body:JSON.stringify(payload) });
    return _d(res);
  } catch (err) {
    console.error('API_completeSale:', err.message);
    if (typeof toast==='function') toast(err.message,'err');
    return null;
  }
}

async function API_loadSales(dateFrom, dateTo) {
  try {
    let q='?limit=100';
    if (dateFrom&&dateTo) q='?date_from='+dateFrom+'&date_to='+dateTo+'&limit=100';
    const res  = await _apiFetch('/pharmacy/sales'+q);
    const rows = _d(res)||[];
    return rows.map(function(s){
      return {
        id:s.id,_bid:s.id,receiptNo:s.sale_number,date:s.sale_date,
        time:(s.created_at||'').slice(11,16),patient:s.patient_name||'Walk-in',
        items:(s.items||[]).map(function(i){ return {medId:i.inventory_id,name:i.product_name,qty:i.quantity,price:parseFloat(i.unit_price),total:parseFloat(i.total_price),unit:i.unit_of_measure||''}; }),
        subtotal:parseFloat(s.subtotal_amount||s.total_amount)||0,
        discount:parseFloat(s.discount_percent)||0,total:parseFloat(s.total_amount)||0,
        pay:s.payment_method||'Cash',cur:s.currency||'SSP',
        createdBy:s.dispensed_by_name||'',paymentStatus:s.status||'paid',
      };
    });
  } catch (err) {
    console.error('API_loadSales:', err.message);
    return [];
  }
}

// ════════════════════════════════════════════════════════════════════════════
// INVENTORY
// ════════════════════════════════════════════════════════════════════════════

async function API_loadInventory() {
  try {
    const res  = await _apiFetch('/inventory?limit=500');
    const rows = _d(res)||[];
    return rows.map(function(m){
      return { id:m.id,_bid:m.id,name:m.product_name,generic:m.generic_name||'',cat:m.category||'medication',unit:m.unit_of_measure||'tabs',price:parseFloat(m.selling_price)||0,cost:parseFloat(m.cost_price)||0,qty:parseInt(m.quantity_in_stock)||0,min:parseInt(m.reorder_level)||10,exp:m.expiry_date||'',sup:m.supplier_name||'',loc:m.storage_location||'',notes:m.notes||'' };
    });
  } catch (err) {
    console.error('API_loadInventory:', err.message);
    return [];
  }
}

async function API_createInventory(payload) {
  try {
    const res = await _apiFetch('/inventory', { method:'POST', body:JSON.stringify(payload) });
    return _d(res);
  } catch (err) {
    console.error('API_createInventory:', err.message);
    if (typeof toast==='function') toast(err.message,'err');
    return null;
  }
}

async function API_updateInventory(id, payload) {
  try {
    const res = await _apiFetch('/inventory/'+id, { method:'PATCH', body:JSON.stringify(payload) });
    return _d(res);
  } catch (err) {
    console.error('API_updateInventory:', err.message);
    if (typeof toast==='function') toast(err.message,'err');
    return null;
  }
}

async function API_deleteInventory(id) {
  try {
    await _apiFetch('/inventory/'+id, { method:'DELETE' });
    return true;
  } catch (err) {
    console.error('API_deleteInventory:', err.message);
    if (typeof toast==='function') toast(err.message,'err');
    return null;
  }
}

async function API_restockInventory(id, qty, expiryDate) {
  try {
    const res = await _apiFetch('/inventory/'+id+'/restock', {
      method:'POST',
      body:JSON.stringify({ quantity_to_add:qty, expiry_date:expiryDate||null }),
    });
    return _d(res);
  } catch (err) {
    console.error('API_restockInventory:', err.message);
    if (typeof toast==='function') toast(err.message,'err');
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPENSES
// ════════════════════════════════════════════════════════════════════════════

async function API_loadExpenses() {
  try {
    const res  = await _apiFetch('/expenses?limit=300');
    const rows = _d(res)||[];
    return rows.map(function(e){
      return { id:e.id,_bid:e.id,date:e.expense_date,desc:e.description,cat:e.category,amount:parseFloat(e.amount)||0,cur:e.currency||'SSP',paidBy:e.vendor_name||'',ref:e.reference||'',notes:e.notes||'',staff:e.created_by_name||'' };
    });
  } catch (err) {
    console.error('API_loadExpenses:', err.message);
    return [];
  }
}

async function API_createExpense(payload) {
  try {
    const res = await _apiFetch('/expenses', { method:'POST', body:JSON.stringify(payload) });
    return _d(res);
  } catch (err) {
    console.error('API_createExpense:', err.message);
    if (typeof toast==='function') toast(err.message,'err');
    return null;
  }
}

async function API_updateExpense(id, payload) {
  try {
    const res = await _apiFetch('/expenses/'+id, { method:'PATCH', body:JSON.stringify(payload) });
    return _d(res);
  } catch (err) {
    console.error('API_updateExpense:', err.message);
    if (typeof toast==='function') toast(err.message,'err');
    return null;
  }
}

async function API_deleteExpense(id) {
  try {
    await _apiFetch('/expenses/'+id, { method:'DELETE' });
    return true;
  } catch (err) {
    console.error('API_deleteExpense:', err.message);
    if (typeof toast==='function') toast(err.message,'err');
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// RECEIPTS
// ════════════════════════════════════════════════════════════════════════════

async function API_loadReceipts(limit) {
  try {
    const res = await _apiFetch('/receipts?limit='+(limit||100));
    return _d(res)||[];
  } catch (err) {
    console.error('API_loadReceipts:', err.message);
    return null;
  }
}

async function API_reprintReceipt(receiptId) {
  try {
    const res = await _apiFetch('/receipts/'+receiptId+'/reprint', { method:'POST' });
    return _d(res);
  } catch (err) {
    console.error('API_reprintReceipt:', err.message);
    if (typeof toast==='function') toast(err.message,'err');
    return null;
  }
}

function API_showReceiptSnapshot(receiptData, mode) {
  if (!receiptData) return;
  const snap = receiptData.receipt_data || receiptData;

  if (mode === 'pharmacy') {
    const sale = {
      id:receiptData.id||snap.sale_id||'',receiptNo:receiptData.receipt_number||snap.sale_number||'',
      date:(receiptData.printed_at||'').slice(0,10)||snap.sale_date||'',
      time:(receiptData.printed_at||'').slice(11,16)||'',patient:snap.patient_name||'Walk-in',
      items:(snap.items||[]).map(function(i){ return {name:i.description||i.product_name||'',qty:i.quantity||1,price:parseFloat(i.unit_price)||0,total:parseFloat(i.total_price)||0}; }),
      subtotal:parseFloat(snap.subtotal_amount||snap.total_amount)||0,discount:0,
      total:parseFloat(snap.total_amount)||0,pay:snap.payment_method||'',cur:snap.currency||'SSP',paymentStatus:'paid',
    };
    if (typeof showRx==='function') showRx(sale);
    return;
  }

  const dkOf=function(d){ return {'Dental':'dental','Dental Department':'dental','Hemorrhoid':'hemorrhoid','Hemorrhoid Department':'hemorrhoid','Medical':'medical','Medical Department':'medical','Pharmacy':'pharmacy'}[d]||'medical'; };
  const fakeRec={
    id:snap.consultation_id||receiptData.reference_id||'',name:snap.patient_name||'',
    dept:snap.department||'',deptKey:dkOf(snap.department),doctor:snap.doctor_name||'',
    date:snap.consultation_date||snap.treatment_date||(receiptData.printed_at||'').slice(0,10),
    time:(receiptData.printed_at||'').slice(11,16),invoiceNo:snap.invoice_number||'',
    fee:mode==='consult'?(parseFloat(snap.consultation_fee)||0):0,cur:snap.currency||'SSP',
    pay:snap.payment_method||'',payRef:snap.payment_reference||'',paidBy:snap.received_by||'',
    age:null,phone:snap.patient_phone||'',vtype:snap.visit_type||'',
  };
  const fakeTxs=mode==='treatment'?[{name:snap.treatment_name||'',cost:parseFloat(snap.treatment_cost)||0,cur:snap.currency||'SSP',location:snap.treatment_location||'',notes:snap.notes||'',status:'completed'}]:[];
  const fmt=typeof _currentRxFmt!=='undefined'?_currentRxFmt:'a4';
  if (typeof _renderConsultModal==='function') {
    _renderConsultModal(fakeRec,fakeTxs,fmt,mode);
    if (typeof openM==='function') openM('m-rx');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// REPORTS & DASHBOARD
// ════════════════════════════════════════════════════════════════════════════

async function API_dashboardData(dateFrom, dateTo) {
  try {
    const res = await _apiFetch('/reports/dashboard?date_from='+dateFrom+'&date_to='+dateTo);
    return _d(res);
  } catch (err) {
    console.error('API_dashboardData:', err.message);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// USERS
// ════════════════════════════════════════════════════════════════════════════

async function API_loadUsers() {
  try {
    const res = await _apiFetch('/users');
    return _d(res)||[];
  } catch (err) {
    console.error('API_loadUsers:', err.message);
    return [];
  }
}
