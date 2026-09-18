/* ============================================================
   PORTFEL — Aplikacja budżetowa PWA
   ============================================================ */

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
    .then(reg => console.log('✅ SW registered:', reg))
    .catch(err => console.error('❌ SW registration failed:', err));
}

// ===== KONFIGURACJA KATEGORII =====
const BUILT_IN = {
  income: [
    { id: 'praca',    label: '💼 Praca' },
    { id: 'zlecenia', label: '📋 Zlecenia' },
    { id: 'wynajem',  label: '🏠 Wynajem' },
    { id: 'sprzedaz', label: '📦 Sprzedaż' },
    { id: 'inne',     label: '🎁 Inne' },
  ],
  expense: [
    { id: 'paliwo',     label: '⛽ Paliwo' },
    { id: 'leki',       label: '💊 Leki' },
    { id: 'abonamenty', label: '📱 Abonamenty' },
    { id: 'zakupy',     label: '🛒 Zakupy' },
    { id: 'jedzenie',   label: '🍔 Jedzenie' },
    { id: 'rachunki',   label: '🏠 Rachunki' },
    { id: 'auto',       label: '🚗 Auto' },
    { id: 'rozrywka',   label: '🎮 Rozrywka' },
  ]
};

// Zaktualizowane Metody Płatności (uproszczone do 3)
const PAYMENT_METHODS = {
  income: [
    { id: 'karta',    label: '💳 Karta' },
    { id: 'gotowka',  label: '💵 Gotówka' },
    { id: 'przelew',  label: '🏦 Przelew' }
  ],
  expense: [
    { id: 'karta',    label: '💳 Karta' },
    { id: 'gotowka',  label: '💵 Gotówka' },
    { id: 'przelew',  label: '🏦 Przelew' }
  ]
};

const MONTHS_PL = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec',
                   'Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];

function splitCatLabel(label) {
  const firstChar = [...label][0];
  if (firstChar && firstChar.codePointAt(0) > 0x2000) {
    const spaceIdx = label.indexOf(' ');
    if (spaceIdx > 0) return { icon: label.slice(0, spaceIdx), text: label.slice(spaceIdx + 1) };
  }
  return { icon: '📁', text: label };
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function emptyState(msg) { return `<div class="empty-state">${msg}</div>`; }

// ===== STATE =====
let db, auth;
let currentUser = null;
let allTransactions = [];
let customCategories = { income: [], expense: [] };
let dashMonth, dashYear;
let histMonth, histYear;
let addType = 'expense';
let editingId = null;
let selectedCategory = null;
let selectedPayment = null;
let statsPeriod = 'month';
let dashChart = null, statsBarChart = null, statsPieExpense = null, statsPieIncome = null;

function initFirebase() {
  try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    db.enablePersistence({ synchronizeTabs: true })
      .catch(err => console.warn('Offline cache niedostępny:', err.code));
    auth = firebase.auth();
    auth.onAuthStateChanged(user => {
      if (user) {
        currentUser = user;
        showApp(user);
        loadData();
      } else {
        currentUser = null;
        showLogin();
      }
    });
  } catch (e) {
    showToast('❌ Błąd konfiguracji Firebase', 'error');
  }
}

function signInGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).catch(err => showToast('Błąd logowania', 'error'));
}

function logout() { auth.signOut(); }

function showLogin() {
  document.getElementById('screen-login').classList.add('active');
  document.getElementById('screen-app').classList.remove('active');
}

function showApp(user) {
  document.getElementById('screen-login').classList.remove('active');
  document.getElementById('screen-app').classList.add('active');
  const avatar = document.getElementById('user-avatar');
  if (user.photoURL) avatar.innerHTML = `<img src="${esc(user.photoURL)}" alt="">`;
  else avatar.textContent = (user.displayName || user.email || '?')[0].toUpperCase();
}

async function loadData() {
  if (!currentUser) return;
  try {
    const snap = await db.collection('users').doc(currentUser.uid)
                         .collection('transactions').orderBy('date', 'desc').get();
    allTransactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const catDoc = await db.collection('users').doc(currentUser.uid)
                           .collection('settings').doc('categories').get();
    if (catDoc.exists) {
      const data = catDoc.data();
      customCategories.income  = data.customIncome  || [];
      customCategories.expense = data.customExpense || [];
    }

    renderAll();
  } catch (e) {
    showToast('Błąd ładowania danych', 'error');
  }
}

function renderAll() {
  renderDashboard();
  renderHistory();
  renderStats();
}

function sortTransactions() {
  allTransactions.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function txCollection() {
  return db.collection('users').doc(currentUser.uid).collection('transactions');
}

/* Zapis optymistyczny: lokalna tablica aktualizuje się od razu, a zapis leci w tle.
   Firestore offline kolejkuje write i potwierdza go dopiero po odzyskaniu sieci —
   czekanie na `await` zawieszałoby formularz bez zasięgu. Błąd = wycofanie zmiany. */
function rollback(msg, restore) {
  restore();
  sortTransactions();
  renderAll();
  showToast(msg, 'error');
}

function saveTransaction(tx) {
  const ref = txCollection().doc();
  allTransactions.push({ ...tx, id: ref.id, createdAt: new Date() });
  sortTransactions();
  renderAll();
  ref.set(tx).catch(() => rollback('Nie udało się zapisać transakcji',
    () => { allTransactions = allTransactions.filter(t => t.id !== ref.id); }));
}

function updateTransaction(id, tx) {
  const i = allTransactions.findIndex(t => t.id === id);
  if (i === -1) return;
  const before = { ...allTransactions[i] };
  allTransactions[i] = { ...before, ...tx, updatedAt: new Date() };
  sortTransactions();
  renderAll();
  txCollection().doc(id).update(tx).catch(() => rollback('Nie udało się zapisać zmian',
    () => { allTransactions = allTransactions.map(t => t.id === id ? before : t); }));
}

function deleteTransaction(id) {
  const before = allTransactions.find(t => t.id === id);
  if (!before) return;
  allTransactions = allTransactions.filter(t => t.id !== id);
  renderAll();
  txCollection().doc(id).delete().catch(() => rollback('Nie udało się usunąć transakcji',
    () => { allTransactions.push(before); }));
}

function saveCustomCategory(type, name) {
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed || customCategories[type].includes(trimmed)) return;
  customCategories[type].push(trimmed);
  db.collection('users').doc(currentUser.uid).collection('settings').doc('categories').set({
    customIncome:  customCategories.income,
    customExpense: customCategories.expense
  }).catch(() => {
    customCategories[type] = customCategories[type].filter(c => c !== trimmed);
    renderCategoryChips();
    showToast('Nie udało się zapisać kategorii', 'error');
  });
}

function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn[data-page]').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelector(`.nav-btn[data-page="${page}"]`)?.classList.add('active');
}

function initDashDate() {
  const now = new Date();
  dashMonth = now.getMonth();
  dashYear  = now.getFullYear();
}

function renderDashboard() {
  const txs = txForMonth(allTransactions, dashYear, dashMonth);
  const income  = sumType(txs, 'income');
  const expense = sumType(txs, 'expense');
  const balance = income - expense;

  document.getElementById('dash-month-label').textContent = `${MONTHS_PL[dashMonth]} ${dashYear}`;
  document.getElementById('dash-income').textContent  = fmt(income);
  document.getElementById('dash-expense').textContent = fmt(expense);

  const balEl = document.getElementById('dash-balance');
  balEl.textContent = (balance >= 0 ? '+' : '') + fmt(balance);
  balEl.className   = 'dash-balance ' + (balance >= 0 ? 'pos' : 'neg');

  const recent = txs.slice(0, 8);
  const listEl = document.getElementById('dash-tx-list');
  listEl.innerHTML = recent.length ? recent.map(t => txHtml(t, false)).join('') : emptyState('Brak transakcji');
  renderDashChart();
}

function renderDashChart() {
  const labels = [], incData = [], expData = [];
  for (let i = 5; i >= 0; i--) {
    let m = dashMonth - i, y = dashYear;
    if (m < 0) { m += 12; y--; }
    labels.push(MONTHS_PL[m].substring(0, 3));
    const txs = txForMonth(allTransactions, y, m);
    incData.push(sumType(txs, 'income'));
    expData.push(sumType(txs, 'expense'));
  }

  const ctx = document.getElementById('dash-chart').getContext('2d');
  if (dashChart) dashChart.destroy();
  dashChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Przychody', data: incData, backgroundColor: 'rgba(26, 115, 232, 0.7)', borderRadius: 6 },
        { label: 'Koszty',    data: expData, backgroundColor: 'rgba(244, 67, 54, 0.7)', borderRadius: 6 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#b0b0cc', font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: '#60607a' }, grid: { color: '#2a2a44' } },
        y: { ticks: { color: '#60607a', callback: v => fmtShort(v) }, grid: { color: '#2a2a44' } }
      }
    }
  });
}

function initHistFilters() {
  const sel = document.getElementById('hist-month-select');
  sel.innerHTML = '';
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    let m = now.getMonth() - i, y = now.getFullYear();
    if (m < 0) { m += 12; y--; }
    const opt = document.createElement('option');
    opt.value = `${y}-${m}`;
    opt.textContent = `${MONTHS_PL[m]} ${y}`;
    if (i === 0) opt.selected = true;
    sel.appendChild(opt);
  }
  histMonth = now.getMonth();
  histYear  = now.getFullYear();
}

function renderHistory() {
  const monthTxs = txForMonth(allTransactions, histYear, histMonth);

  // Lista kategorii budowana przed filtrowaniem, z zachowaniem wyboru użytkownika
  const catSel  = document.getElementById('hist-cat-select');
  const prevCat = catSel.value;
  const cats    = [...new Set(monthTxs.map(t => t.category))];
  catSel.innerHTML = '<option value="all">Kategoria</option>' +
    cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  catSel.value = cats.includes(prevCat) ? prevCat : 'all';

  const typeFilter = document.getElementById('hist-type-select').value;
  const catFilter  = catSel.value;
  let txs = monthTxs;
  if (typeFilter !== 'all') txs = txs.filter(t => t.type === typeFilter);
  if (catFilter !== 'all')  txs = txs.filter(t => t.category === catFilter);

  const income  = sumType(monthTxs, 'income');
  const expense = sumType(monthTxs, 'expense');
  document.getElementById('hist-income-sum').textContent  = fmtShort(income);
  document.getElementById('hist-expense-sum').textContent = fmtShort(expense);
  document.getElementById('hist-balance-sum').textContent = fmtShort(income - expense);

  const listEl = document.getElementById('hist-tx-list');
  listEl.innerHTML = txs.length ? txs.map(t => txHtml(t, true)).join('') : emptyState('Brak transakcji');

  listEl.querySelectorAll('.tx-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const tx = allTransactions.find(t => t.id === btn.dataset.id);
      if (tx) openEditModal(tx);
    });
  });

  listEl.querySelectorAll('.tx-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Usunąć tę transakcję?')) return;
      btn.disabled = true;
      deleteTransaction(btn.dataset.id);
      showToast('Usunięto', 'success');
    });
  });
}

function renderStats() {
  const txs = filterByPeriod(allTransactions, statsPeriod);
  document.getElementById('stats-income-total').textContent  = fmt(sumType(txs, 'income'));
  document.getElementById('stats-expense-total').textContent = fmt(sumType(txs, 'expense'));
  renderStatsBarChart(txs);
  renderStatsPie('expense', txs);
  renderStatsPie('income', txs);
  renderTopCategories('expense', txs);
  renderTopCategories('income', txs);
}

function renderStatsBarChart(txs) {
  const months = {};
  txs.forEach(t => {
    const d = parseTxDate(t.date);
    const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`;
    if (!months[key]) months[key] = { label: MONTHS_PL[d.getMonth()].substring(0,3), income: 0, expense: 0 };
    months[key][t.type] += t.amount;
  });
  const keys = Object.keys(months).sort();
  const ctx = document.getElementById('stats-bar-chart').getContext('2d');
  if (statsBarChart) statsBarChart.destroy();
  statsBarChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: keys.map(k => months[k].label),
      datasets: [
        { label: 'Przychody', data: keys.map(k => months[k].income), backgroundColor: 'rgba(26, 115, 232, 0.75)', borderRadius: 5 },
        { label: 'Koszty',    data: keys.map(k => months[k].expense), backgroundColor: 'rgba(244, 67, 54, 0.75)', borderRadius: 5 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

function renderStatsPie(type, txs) {
  const filtered = txs.filter(t => t.type === type);
  const catMap = {};
  filtered.forEach(t => { catMap[t.category] = (catMap[t.category] || 0) + t.amount; });
  const labels = Object.keys(catMap);
  const colors = type === 'expense' 
    ? ['#f44336','#e91e63','#ff5722','#ff9800','#ffc107'] 
    : ['#1a73e8','#4285f4','#64b5f6','#2196f3','#0d47a1'];

  const canvasId = type === 'expense' ? 'stats-pie-expense' : 'stats-pie-income';
  const ctx = document.getElementById(canvasId).getContext('2d');
  const prev = type === 'expense' ? statsPieExpense : statsPieIncome;
  if (prev) prev.destroy();
  const chart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: labels.map(l => catMap[l]), backgroundColor: colors, borderWidth: 2, borderColor: '#10101e' }] },
    options: { responsive: true, maintainAspectRatio: false }
  });
  if (type === 'expense') statsPieExpense = chart; else statsPieIncome = chart;
}

function renderTopCategories(type, txs) {
  const filtered = txs.filter(t => t.type === type);
  const catMap = {};
  filtered.forEach(t => { catMap[t.category] = (catMap[t.category] || 0) + t.amount; });
  const sorted = Object.entries(catMap).sort((a,b) => b[1]-a[1]).slice(0, 6);
  const max = sorted[0]?.[1] || 1;
  const el = document.getElementById(type === 'expense' ? 'stats-top-expense' : 'stats-top-income');
  el.innerHTML = sorted.map(([cat, amt]) => `
    <div class="cat-row">
      <span class="cat-row-name">${esc(cat)}</span>
      <div class="cat-row-bar-wrap">
        <div class="cat-row-bar ${type}" style="width:${Math.round(amt/max*100)}%"></div>
      </div>
      <span class="cat-row-amt">${fmt(amt)}</span>
    </div>`).join('');
}

// ===== MODAL & HELPERS =====
function closeModal() {
  editingId = null;
  document.getElementById('add-modal').classList.remove('open');
}

function openEditModal(tx) {
  editingId = tx.id;
  addType = tx.type || 'expense';
  selectedCategory = tx.category || null;
  selectedPayment  = tx.paymentMethod || null;
  document.getElementById('tx-amount').value = tx.amount != null ? tx.amount : '';
  document.getElementById('tx-note').value = tx.note || '';
  document.getElementById('custom-cat-input').value = '';
  document.getElementById('custom-cat-wrap').classList.remove('show');
  document.getElementById('tx-date').value = tx.date || todayISO();
  updateModalType();
  document.getElementById('add-modal').classList.add('open');
}

function openAddModal(type) {
  editingId = null;
  addType = type || 'expense';
  selectedCategory = null; selectedPayment = null;
  document.getElementById('tx-amount').value = '';
  document.getElementById('tx-note').value = '';
  document.getElementById('custom-cat-input').value = '';
  document.getElementById('custom-cat-wrap').classList.remove('show');
  document.getElementById('tx-date').value = todayISO();
  updateModalType();
  document.getElementById('add-modal').classList.add('open');
}

function updateModalType() {
  const isExp = addType === 'expense';
  document.getElementById('modal-title').textContent = editingId
    ? (isExp ? '✏️ Edytuj koszt' : '✏️ Edytuj przychód')
    : (isExp ? '📉 Dodaj koszt' : '📈 Dodaj przychód');
  document.getElementById('btn-submit').className = `btn-submit ${addType}`;
  document.getElementById('btn-submit').textContent = editingId
    ? 'Zapisz zmiany'
    : (isExp ? 'Zapisz koszt' : 'Zapisz przychód');
  
  // Zaktualizowany Napis zamiast przełącznika
  const msgEl = document.getElementById('modal-msg');
  msgEl.textContent = isExp ? '- przemyśl jeszcze raz :)' : 'Tak trzymaj!';
  msgEl.className = isExp ? 'msg-expense' : 'msg-income';

  renderCategoryChips();
  renderPaymentChips();
}

function renderCategoryChips() {
  const all = [...BUILT_IN[addType], ...customCategories[addType].map(c => ({ id: c, label: c }))];
  const wrap = document.getElementById('cat-chips');
  wrap.innerHTML = all.map(c => {
    const { icon, text } = splitCatLabel(c.label);
    const sel = selectedCategory === c.label ? 'selected ' + addType : '';
    return `<button class="cat-grid-btn ${sel}" data-cat="${esc(c.label)}">
      <span class="cat-grid-icon">${esc(icon)}</span>
      <span class="cat-grid-label">${esc(text)}</span>
    </button>`;
  }).join('') + `<button class="cat-grid-btn add-custom" id="chip-add-custom">
    <span class="cat-grid-icon">＋</span>
    <span class="cat-grid-label">Własna</span>
  </button>`;
  wrap.querySelectorAll('.cat-grid-btn[data-cat]').forEach(btn => btn.addEventListener('click', () => { selectedCategory = btn.dataset.cat; renderCategoryChips(); }));
  document.getElementById('chip-add-custom').addEventListener('click', () => document.getElementById('custom-cat-wrap').classList.toggle('show'));
}

function renderPaymentChips() {
  const wrap = document.getElementById('payment-chips');
  wrap.innerHTML = PAYMENT_METHODS[addType].map(m => `<button class="chip ${selectedPayment === m.id ? 'selected neutral' : ''}" data-pay="${esc(m.id)}">${esc(m.label)}</button>`).join('');
  wrap.querySelectorAll('.chip[data-pay]').forEach(btn => btn.addEventListener('click', () => { selectedPayment = btn.dataset.pay; renderPaymentChips(); }));
}

function submitTransaction() {
  const amountRaw = document.getElementById('tx-amount').value.replace(',', '.');
  const amount = parseFloat(amountRaw);
  
  // Zaktualizowany limit kwoty do 9 999.99 (zmniejszony o 2 cyfry)
  if (!amount || amount <= 0) { showToast('Uzupełnij dane', 'error'); return; }
  if (amount > 9999.99) { showToast('Max: 9 999,99 zł', 'error'); return; }
  
  if (!selectedCategory || !selectedPayment) { showToast('Uzupełnij dane', 'error'); return; }
  
  const tx = {
    type: addType,
    amount,
    category: selectedCategory,
    paymentMethod: selectedPayment,
    date: document.getElementById('tx-date').value,
    note: document.getElementById('tx-note').value.trim().slice(0, 500)
  };

  const btn = document.getElementById('btn-submit');
  btn.disabled = true;
  try {
    if (editingId) {
      updateTransaction(editingId, { ...tx, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      showToast('Zaktualizowano', 'success');
    } else {
      saveTransaction({ ...tx, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      showToast('Zapisano', 'success');
    }
    editingId = null;
    closeModal();
  } catch (e) {
    showToast('Błąd zapisu — sprawdź połączenie', 'error');
  } finally {
    btn.disabled = false;
  }
}

function txForMonth(txs, y, m) { return txs.filter(t => { const d = parseTxDate(t.date); return d.getFullYear() === y && d.getMonth() === m; }); }
function filterByPeriod(txs, p) {
  if (p === 'all') return txs;
  const c = new Date();
  if (p === 'month')     c.setDate(1);
  else if (p === '3m')   c.setMonth(c.getMonth() - 3);
  else if (p === '6m')   c.setMonth(c.getMonth() - 6);
  else if (p === 'year') c.setMonth(0, 1);
  else return txs;
  c.setHours(0, 0, 0, 0);
  return txs.filter(t => parseTxDate(t.date) >= c);
}

// 'YYYY-MM-DD' jako data LOKALNA — new Date('2026-09-01') to północ UTC i potrafi cofnąć dzień
function parseTxDate(s) {
  const [y, m, d] = String(s || '').split('-').map(Number);
  return (y && m && d) ? new Date(y, m - 1, d) : new Date(s);
}

function todayISO() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}
function sumType(txs, t) { return txs.filter(x => x.type === t).reduce((s, x) => s + x.amount, 0); }
function fmt(n) { return Number(n || 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł'; }
function fmtShort(n) { return n >= 1000 ? (n/1000).toFixed(1) + 'k' : Math.round(n); }

function txHtml(t, del) {
  const sign = t.type === 'income' ? '+' : '−';
  const { icon, text } = splitCatLabel(t.category || '');
  const meta = [t.date, t.note].filter(Boolean).join(' · ');
  return `<div class="transaction-item">
    <div class="tx-icon ${esc(t.type)}">${esc(icon)}</div>
    <div class="tx-info"><div class="tx-category">${esc(text)}</div><div class="tx-meta">${esc(meta)}</div></div>
    <div class="tx-amount ${esc(t.type)}">${sign}${fmt(t.amount)}</div>
    ${del ? `<button class="tx-edit" data-id="${esc(t.id)}" aria-label="Edytuj transakcję">✏️</button>
    <button class="tx-delete" data-id="${esc(t.id)}" aria-label="Usuń transakcję">🗑</button>` : ''}
  </div>`;
}

function showToast(m, t) { const el = document.getElementById('toast'); el.textContent = m; el.className = `toast ${t} show`; setTimeout(() => el.classList.remove('show'), 3000); }

function bindEvents() {
  document.getElementById('btn-google-login').addEventListener('click', signInGoogle);
  document.getElementById('btn-logout').addEventListener('click', logout);
  document.querySelectorAll('.nav-btn[data-page]').forEach(b => b.addEventListener('click', () => showPage(b.dataset.page)));
  document.getElementById('nav-add-btn').addEventListener('click', () => openAddModal('expense'));
  document.getElementById('btn-submit').addEventListener('click', submitTransaction);
  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('add-modal').addEventListener('click', e => {
    if (e.target.id === 'add-modal') closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });
  document.getElementById('dash-add-income').addEventListener('click', () => openAddModal('income'));
  document.getElementById('dash-add-expense').addEventListener('click', () => openAddModal('expense'));

  // Zaktualizowane ograniczenie do 7 znaków (xxxx.xx)
  document.getElementById('tx-amount').addEventListener('input', (e) => {
    if (e.target.value.length > 7) e.target.value = e.target.value.slice(0, 7);
  });

  document.getElementById('dash-prev-month').addEventListener('click', () => {
    dashMonth--; if (dashMonth < 0) { dashMonth = 11; dashYear--; }
    renderDashboard();
  });
  document.getElementById('dash-next-month').addEventListener('click', () => {
    dashMonth++; if (dashMonth > 11) { dashMonth = 0; dashYear++; }
    renderDashboard();
  });

  document.getElementById('hist-month-select').addEventListener('change', function() {
    const [y, m] = this.value.split('-');
    histYear = parseInt(y); histMonth = parseInt(m);
    renderHistory();
  });

  document.getElementById('hist-type-select').addEventListener('change', () => renderHistory());
  document.getElementById('hist-cat-select').addEventListener('change', () => renderHistory());

  document.querySelectorAll('.period-btn').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    statsPeriod = btn.dataset.period;
    renderStats();
  }));

  const addCustomCategory = () => {
    const input = document.getElementById('custom-cat-input');
    if (!input.value.trim()) return;
    saveCustomCategory(addType, input.value);
    input.value = '';
    document.getElementById('custom-cat-wrap').classList.remove('show');
    renderCategoryChips();
  };
  document.getElementById('btn-add-cat').addEventListener('click', addCustomCategory);
  document.getElementById('custom-cat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addCustomCategory(); }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initDashDate(); initHistFilters(); bindEvents(); initFirebase();
});