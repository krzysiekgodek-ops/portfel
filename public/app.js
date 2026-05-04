/* ============================================================
   PORTFEL — Aplikacja budżetowa PWA
   ============================================================ */

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

const PAYMENT_METHODS = {
  income: [
    { id: 'przelew',  label: '🏦 Przelew' },
    { id: 'gotowka',  label: '💵 Gotówka' },
    { id: 'karta',    label: '💳 Karta' },
  ],
  expense: [
    { id: 'karta',          label: '💳 Karta debetowa' },
    { id: 'karta_kredyt',   label: '💳 Karta kredytowa' },
    { id: 'gotowka',        label: '💵 Gotówka' },
    { id: 'przelew',        label: '🏦 Przelew' },
  ]
};

const MONTHS_PL = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec',
                   'Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];

// ===== STATE =====
let db, auth;
let currentUser = null;
let allTransactions = [];
let customCategories = { income: [], expense: [] };
let dashMonth, dashYear;
let histMonth, histYear;
let addType = 'expense';
let selectedCategory = null;
let selectedPayment = null;
let statsPeriod = 'month';
let dashChart = null, statsBarChart = null, statsPieExpense = null, statsPieIncome = null;

// ===== FIREBASE INIT =====
function initFirebase() {
  try {
    firebase.initializeApp(firebaseConfig);
    db   = firebase.firestore();
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
    showToast('❌ Błąd konfiguracji Firebase. Sprawdź firebase-config.js', 'error');
    console.error(e);
  }
}

// ===== AUTH =====
function signInGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).catch(err => {
    showToast('Błąd logowania: ' + err.message, 'error');
  });
}

function logout() {
  auth.signOut();
}

function showLogin() {
  document.getElementById('screen-login').classList.add('active');
  document.getElementById('screen-app').classList.remove('active');
}

function showApp(user) {
  document.getElementById('screen-login').classList.remove('active');
  document.getElementById('screen-app').classList.add('active');

  const avatar = document.getElementById('user-avatar');
  if (user.photoURL) {
    avatar.innerHTML = `<img src="${user.photoURL}" alt="avatar">`;
  } else {
    avatar.textContent = (user.displayName || user.email || '?')[0].toUpperCase();
  }
}

// ===== DATA =====
async function loadData() {
  if (!currentUser) return;
  try {
    // Załaduj transakcje
    const snap = await db.collection('users').doc(currentUser.uid)
                         .collection('transactions').orderBy('date', 'desc').get();
    allTransactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Załaduj własne kategorie
    const catDoc = await db.collection('users').doc(currentUser.uid)
                           .collection('settings').doc('categories').get();
    if (catDoc.exists) {
      const data = catDoc.data();
      customCategories.income  = data.customIncome  || [];
      customCategories.expense = data.customExpense || [];
    }

    renderDashboard();
    renderHistory();
    renderStats();
  } catch (e) {
    showToast('Błąd ładowania danych', 'error');
    console.error(e);
  }
}

async function saveTransaction(tx) {
  await db.collection('users').doc(currentUser.uid)
          .collection('transactions').add(tx);
  allTransactions.unshift({ id: 'temp', ...tx });
  await loadData();
}

async function deleteTransaction(id) {
  await db.collection('users').doc(currentUser.uid)
          .collection('transactions').doc(id).delete();
  allTransactions = allTransactions.filter(t => t.id !== id);
  renderDashboard();
  renderHistory();
  renderStats();
}

async function saveCustomCategory(type, name) {
  if (!name.trim()) return;
  const trimmed = name.trim();
  if (customCategories[type].includes(trimmed)) return;
  customCategories[type].push(trimmed);
  await db.collection('users').doc(currentUser.uid)
          .collection('settings').doc('categories').set({
            customIncome:  customCategories.income,
            customExpense: customCategories.expense
          });
}

// ===== NAVIGATION =====
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn[data-page]').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelector(`.nav-btn[data-page="${page}"]`)?.classList.add('active');
}

// ===== DASHBOARD =====
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

  // Recent (last 8)
  const recent = txs.slice(0, 8);
  const listEl = document.getElementById('dash-tx-list');
  listEl.innerHTML = recent.length
    ? recent.map(t => txHtml(t, false)).join('')
    : emptyState('Brak transakcji w tym miesiącu');

  // Chart: ostatnie 6 miesięcy
  renderDashChart();
}

function renderDashChart() {
  const labels = [];
  const incData = [];
  const expData = [];
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
        { label: 'Przychody', data: incData, backgroundColor: 'rgba(76,175,80,0.7)', borderRadius: 6 },
        { label: 'Koszty',    data: expData, backgroundColor: 'rgba(244,67,54,0.7)', borderRadius: 6 }
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

// ===== HISTORY =====
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
  const typeFilter = document.getElementById('hist-type-select').value;
  const catFilter  = document.getElementById('hist-cat-select').value;

  let txs = txForMonth(allTransactions, histYear, histMonth);
  if (typeFilter !== 'all') txs = txs.filter(t => t.type === typeFilter);
  if (catFilter !== 'all')  txs = txs.filter(t => t.category === catFilter);

  const income  = sumType(txForMonth(allTransactions, histYear, histMonth), 'income');
  const expense = sumType(txForMonth(allTransactions, histYear, histMonth), 'expense');
  document.getElementById('hist-income-sum').textContent  = fmtShort(income);
  document.getElementById('hist-expense-sum').textContent = fmtShort(expense);
  document.getElementById('hist-balance-sum').textContent = fmtShort(income - expense);

  // Update category filter options
  const cats = [...new Set(txForMonth(allTransactions, histYear, histMonth).map(t => t.category))];
  const catSel = document.getElementById('hist-cat-select');
  const curCat = catSel.value;
  catSel.innerHTML = '<option value="all">Kategoria</option>' +
    cats.map(c => `<option value="${c}" ${c === curCat ? 'selected' : ''}>${c}</option>`).join('');

  const listEl = document.getElementById('hist-tx-list');
  listEl.innerHTML = txs.length
    ? txs.map(t => txHtml(t, true)).join('')
    : emptyState('Brak transakcji');

  // Delete listeners
  listEl.querySelectorAll('.tx-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (confirm('Usunąć tę transakcję?')) {
        await deleteTransaction(btn.dataset.id);
        showToast('Usunięto', 'success');
      }
    });
  });
}

// ===== STATISTICS =====
function renderStats() {
  const txs = filterByPeriod(allTransactions, statsPeriod);
  const income  = sumType(txs, 'income');
  const expense = sumType(txs, 'expense');

  document.getElementById('stats-income-total').textContent  = fmt(income);
  document.getElementById('stats-expense-total').textContent = fmt(expense);

  renderStatsBarChart(txs);
  renderStatsPie('expense', txs);
  renderStatsPie('income', txs);
  renderTopCategories('expense', txs);
  renderTopCategories('income', txs);
}

function renderStatsBarChart(txs) {
  // Group by month
  const months = {};
  txs.forEach(t => {
    const d = new Date(t.date);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (!months[key]) months[key] = { label: MONTHS_PL[d.getMonth()].substring(0,3) + ' ' + String(d.getFullYear()).slice(2), income: 0, expense: 0 };
    months[key][t.type] += t.amount;
  });
  const keys = Object.keys(months).sort();
  const labels   = keys.map(k => months[k].label);
  const incData  = keys.map(k => months[k].income);
  const expData  = keys.map(k => months[k].expense);

  const ctx = document.getElementById('stats-bar-chart').getContext('2d');
  if (statsBarChart) statsBarChart.destroy();
  statsBarChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Przychody', data: incData, backgroundColor: 'rgba(76,175,80,0.75)', borderRadius: 5 },
        { label: 'Koszty',    data: expData, backgroundColor: 'rgba(244,67,54,0.75)', borderRadius: 5 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#b0b0cc', font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: '#60607a', font: { size: 10 } }, grid: { color: '#2a2a44' } },
        y: { ticks: { color: '#60607a', callback: v => fmtShort(v) }, grid: { color: '#2a2a44' } }
      }
    }
  });
}

function renderStatsPie(type, txs) {
  const filtered = txs.filter(t => t.type === type);
  const catMap = {};
  filtered.forEach(t => {
    catMap[t.category] = (catMap[t.category] || 0) + t.amount;
  });
  const labels = Object.keys(catMap);
  const data   = labels.map(l => catMap[l]);

  const COLORS_EXP = ['#f44336','#e91e63','#ff5722','#ff9800','#ffc107','#ff6f00','#bf360c','#c62828'];
  const COLORS_INC = ['#4caf50','#2196f3','#00bcd4','#8bc34a','#26a69a','#43a047','#1976d2','#0097a7'];
  const colors = type === 'expense' ? COLORS_EXP : COLORS_INC;

  const canvasId = type === 'expense' ? 'stats-pie-expense' : 'stats-pie-income';
  const ctx = document.getElementById(canvasId).getContext('2d');
  if (type === 'expense' && statsPieExpense) statsPieExpense.destroy();
  if (type === 'income'  && statsPieIncome)  statsPieIncome.destroy();

  const chart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors.slice(0, labels.length), borderWidth: 2, borderColor: '#10101e' }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#b0b0cc', font: { size: 11 }, padding: 10 } }
      }
    }
  });
  if (type === 'expense') statsPieExpense = chart;
  else                    statsPieIncome  = chart;
}

function renderTopCategories(type, txs) {
  const filtered = txs.filter(t => t.type === type);
  const catMap = {};
  filtered.forEach(t => { catMap[t.category] = (catMap[t.category] || 0) + t.amount; });
  const sorted = Object.entries(catMap).sort((a,b) => b[1]-a[1]).slice(0, 6);
  const max = sorted[0]?.[1] || 1;

  const elId = type === 'expense' ? 'stats-top-expense' : 'stats-top-income';
  const el = document.getElementById(elId);
  if (!sorted.length) { el.innerHTML = `<p style="color:var(--text3);font-size:0.85rem;text-align:center;padding:12px">Brak danych</p>`; return; }
  el.innerHTML = sorted.map(([cat, amt]) => `
    <div class="cat-row">
      <span class="cat-row-name">${cat}</span>
      <div class="cat-row-bar-wrap">
        <div class="cat-row-bar ${type}" style="width:${Math.round(amt/max*100)}%"></div>
      </div>
      <span class="cat-row-amt">${fmt(amt)}</span>
    </div>`).join('');
}

// ===== ADD TRANSACTION MODAL =====
function openAddModal(type) {
  addType = type || 'expense';
  selectedCategory = null;
  selectedPayment  = null;

  document.getElementById('tx-amount').value = '';
  document.getElementById('tx-note').value   = '';
  document.getElementById('tx-date').value   = new Date().toISOString().split('T')[0];
  document.getElementById('custom-cat-input').value = '';
  document.getElementById('custom-cat-wrap').classList.remove('show');

  updateModalType();

  document.getElementById('add-modal').classList.add('open');
  document.getElementById('tx-amount').focus();
}

function updateModalType() {
  const isExpense = addType === 'expense';

  // Title & toggle
  document.getElementById('modal-title').textContent = isExpense ? '📉 Dodaj koszt' : '📈 Dodaj przychód';
  document.getElementById('toggle-expense').className = 'active expense' + (isExpense ? ' active' : '');
  document.getElementById('toggle-income').className  = (!isExpense ? 'active income' : '');
  document.getElementById('toggle-expense').classList.toggle('active', isExpense);
  document.getElementById('toggle-income').classList.toggle('active', !isExpense);

  // Amount input color
  const amtInput = document.getElementById('tx-amount');
  amtInput.className = `amount-input ${addType}`;

  // Submit button
  const btn = document.getElementById('btn-submit');
  btn.className = `btn-submit ${addType}`;
  btn.textContent = isExpense ? 'Zapisz koszt' : 'Zapisz przychód';

  // Render category chips
  renderCategoryChips();
  renderPaymentChips();
}

function renderCategoryChips() {
  const all = [
    ...BUILT_IN[addType],
    ...customCategories[addType].map(c => ({ id: c, label: c }))
  ];
  const wrap = document.getElementById('cat-chips');
  wrap.innerHTML = all.map(c => `
    <button class="chip ${selectedCategory === c.label ? 'selected ' + addType : ''}"
            data-cat="${c.label}">${c.label}</button>
  `).join('') + `<button class="chip add-custom" id="chip-add-custom">＋ Własna</button>`;

  wrap.querySelectorAll('.chip[data-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedCategory = btn.dataset.cat;
      renderCategoryChips();
    });
  });
  document.getElementById('chip-add-custom').addEventListener('click', () => {
    document.getElementById('custom-cat-wrap').classList.toggle('show');
    document.getElementById('custom-cat-input').focus();
  });
}

function renderPaymentChips() {
  const methods = PAYMENT_METHODS[addType];
  const wrap = document.getElementById('payment-chips');
  wrap.innerHTML = methods.map(m => `
    <button class="chip ${selectedPayment === m.id ? 'selected neutral' : ''}"
            data-pay="${m.id}">${m.label}</button>
  `).join('');
  wrap.querySelectorAll('.chip[data-pay]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedPayment = btn.dataset.pay;
      renderPaymentChips();
    });
  });
}

function closeAddModal() {
  document.getElementById('add-modal').classList.remove('open');
}

async function submitTransaction() {
  const amountRaw = document.getElementById('tx-amount').value.replace(',', '.');
  const amount = parseFloat(amountRaw);
  const date   = document.getElementById('tx-date').value;
  const note   = document.getElementById('tx-note').value.trim();

  if (!amount || amount <= 0) { showToast('Podaj kwotę większą od zera', 'error'); return; }
  if (!selectedCategory)      { showToast('Wybierz kategorię', 'error'); return; }
  if (!selectedPayment)       { showToast('Wybierz metodę płatności', 'error'); return; }
  if (!date)                  { showToast('Wybierz datę', 'error'); return; }

  const tx = {
    type: addType,
    amount,
    category: selectedCategory,
    paymentMethod: selectedPayment,
    date,
    note,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  try {
    document.getElementById('btn-submit').textContent = 'Zapisuję...';
    document.getElementById('btn-submit').disabled = true;
    await saveTransaction(tx);
    closeAddModal();
    showToast('✓ Zapisano ' + (addType === 'expense' ? 'koszt' : 'przychód'), 'success');
  } catch (e) {
    showToast('Błąd zapisu: ' + e.message, 'error');
    console.error(e);
  } finally {
    document.getElementById('btn-submit').disabled = false;
    updateModalType();
  }
}

// ===== HELPERS =====
function txForMonth(txs, year, month) {
  return txs.filter(t => {
    const d = new Date(t.date);
    return d.getFullYear() === year && d.getMonth() === month;
  });
}

function filterByPeriod(txs, period) {
  const now = new Date();
  const cutoff = new Date();
  if (period === 'month') { cutoff.setDate(1); }
  else if (period === '3m') { cutoff.setMonth(now.getMonth() - 3); }
  else if (period === '6m') { cutoff.setMonth(now.getMonth() - 6); }
  else if (period === 'year') { cutoff.setMonth(0); cutoff.setDate(1); }
  else return txs;
  return txs.filter(t => new Date(t.date) >= cutoff);
}

function sumType(txs, type) {
  return txs.filter(t => t.type === type).reduce((s, t) => s + t.amount, 0);
}

function fmt(n) {
  return n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł';
}

function fmtShort(n) {
  if (n >= 1000) return (n/1000).toFixed(1) + 'k';
  return Math.round(n).toString();
}

function payLabel(id) {
  const all = [...PAYMENT_METHODS.income, ...PAYMENT_METHODS.expense];
  return all.find(m => m.id === id)?.label || id;
}

function txHtml(t, showDelete) {
  const sign   = t.type === 'income' ? '+' : '−';
  const dateStr = new Date(t.date).toLocaleDateString('pl-PL', { day:'2-digit', month:'short' });
  return `
  <div class="transaction-item">
    <div class="tx-icon ${t.type}">${t.category.split(' ')[0]}</div>
    <div class="tx-info">
      <div class="tx-category">${t.category}</div>
      <div class="tx-meta">${dateStr} · ${payLabel(t.paymentMethod)}${t.note ? ' · ' + t.note : ''}</div>
    </div>
    <div class="tx-amount ${t.type}">${sign}${fmt(t.amount)}</div>
    ${showDelete ? `<button class="tx-delete" data-id="${t.id}" title="Usuń">🗑</button>` : ''}
  </div>`;
}

function emptyState(msg) {
  return `<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">${msg}</div></div>`;
}

let toastTimer;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ===== EVENT LISTENERS =====
function bindEvents() {
  // Auth
  document.getElementById('btn-google-login').addEventListener('click', signInGoogle);
  document.getElementById('btn-logout').addEventListener('click', logout);

  // Nav
  document.querySelectorAll('.nav-btn[data-page]').forEach(btn => {
    btn.addEventListener('click', () => showPage(btn.dataset.page));
  });
  document.getElementById('nav-add-btn').addEventListener('click', () => openAddModal(addType));

  // Dashboard
  document.getElementById('dash-prev-month').addEventListener('click', () => {
    if (dashMonth === 0) { dashMonth = 11; dashYear--; } else dashMonth--;
    renderDashboard();
  });
  document.getElementById('dash-next-month').addEventListener('click', () => {
    const now = new Date();
    if (dashYear === now.getFullYear() && dashMonth === now.getMonth()) return;
    if (dashMonth === 11) { dashMonth = 0; dashYear++; } else dashMonth++;
    renderDashboard();
  });
  document.getElementById('dash-add-income').addEventListener('click', () => openAddModal('income'));
  document.getElementById('dash-add-expense').addEventListener('click', () => openAddModal('expense'));

  // Modal
  document.getElementById('btn-close-modal').addEventListener('click', closeAddModal);
  document.getElementById('add-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeAddModal();
  });
  document.getElementById('toggle-expense').addEventListener('click', () => { addType = 'expense'; updateModalType(); });
  document.getElementById('toggle-income').addEventListener('click',  () => { addType = 'income';  updateModalType(); });
  document.getElementById('btn-submit').addEventListener('click', submitTransaction);

  // Custom category
  document.getElementById('btn-add-cat').addEventListener('click', async () => {
    const name = document.getElementById('custom-cat-input').value.trim();
    if (!name) return;
    await saveCustomCategory(addType, name);
    selectedCategory = name;
    document.getElementById('custom-cat-input').value = '';
    document.getElementById('custom-cat-wrap').classList.remove('show');
    renderCategoryChips();
    showToast('Dodano kategorię: ' + name, 'success');
  });
  document.getElementById('custom-cat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-add-cat').click();
  });

  // History filters
  document.getElementById('hist-month-select').addEventListener('change', e => {
    const [y, m] = e.target.value.split('-').map(Number);
    histYear = y; histMonth = m;
    renderHistory();
  });
  document.getElementById('hist-type-select').addEventListener('change', renderHistory);
  document.getElementById('hist-cat-select').addEventListener('change', renderHistory);

  // Stats period
  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      statsPeriod = btn.dataset.period;
      renderStats();
    });
  });
}

// ===== SERVICE WORKER =====
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .then(() => console.log('SW zarejestrowany'))
      .catch(e => console.warn('SW błąd:', e));
  }
}

// ===== START =====
document.addEventListener('DOMContentLoaded', () => {
  initDashDate();
  histMonth = dashMonth;
  histYear  = dashYear;
  initHistFilters();
  bindEvents();
  registerSW();
  initFirebase();

  // Chart.js defaults
  Chart.defaults.color = '#b0b0cc';
  Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
});
