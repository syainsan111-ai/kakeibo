'use strict';
/*
 * 入出金カレンダ 本体
 * - 画面への文字出力はすべて textContent / createElement で行い、HTML として解釈させない
 * - データは端末内（IndexedDB）のみに保存
 */
(function () {
  const CATEGORIES = {
    income: ['給与', '賞与'],
    expense: ['食費', '買い物', '家賃', 'サブスク', 'ゲーム課金'],
  };
  const TYPE_LABEL = { income: '入金', expense: '出金' };
  const CAT_COLORS = {
    給与: '#e15759', 賞与: '#f28e2b',
    食費: '#4e79a7', 買い物: '#76b7b2', 家賃: '#59a14f', サブスク: '#b8a12a', ゲーム課金: '#b07aa1',
  };
  const COLOR_INCOME = '#d32f2f';
  const COLOR_EXPENSE = '#1565c0';
  const COLOR_NET = '#2e7d6b';
  const MAX_AMOUNT = 999999999;
  const MAX_DAY_BUCKETS = 400;
  const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
  const isType = (t) => t === 'income' || t === 'expense';

  // ---------- 小物 ----------
  const $ = (id) => document.getElementById(id);
  function el(tag, opts = {}, children = []) {
    const e = document.createElement(tag);
    if (opts.className) e.className = opts.className;
    if (opts.text != null) e.textContent = opts.text;
    if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) e.setAttribute(k, v);
    for (const c of children) if (c) e.append(c);
    return e;
  }
  function button(label, className, onClick, disabled = false) {
    const b = el('button', { className, text: label, attrs: { type: 'button' } });
    b.disabled = disabled;
    b.addEventListener('click', onClick);
    return b;
  }
  const pad2 = (n) => String(n).padStart(2, '0');
  const toYmd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const isValidYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && toYmd(parseYmd(s)) === s;
  const isIso = (s) => typeof s === 'string' && s.length <= 40 && !Number.isNaN(Date.parse(s));
  const fmtYmdJa = (s) => { const d = parseYmd(s); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };
  function fmtDayTitle(s) {
    const d = parseYmd(s);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`;
  }
  function fmtDateTime(iso) {
    if (!iso) return '－';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '－';
    return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  const yen = (n) => n.toLocaleString('ja-JP');
  const fmtSigned = (n) => (n > 0 ? '+' + yen(n) : n < 0 ? '-' + yen(-n) : '0');
  const signClass = (n) => (n > 0 ? 'plus' : n < 0 ? 'minus' : 'zero');
  const signedAmount = (e) => (e.type === 'income' ? e.amount : -e.amount);
  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  function summarize(list) {
    let inc = 0;
    let exp = 0;
    for (const e of list) { if (e.type === 'income') inc += e.amount; else exp += e.amount; }
    return { inc, exp, net: inc - exp };
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2500);
  }

  // ---------- 状態 ----------
  const now0 = new Date();
  const state = {
    entries: [],
    year: now0.getFullYear(),
    month: now0.getMonth(),
    day: null,
    mode: 'view', // view | edit | delete
    selected: new Set(),
    editing: null,
    graphCats: new Set([...CATEGORIES.income, ...CATEGORIES.expense]),
    redrawChart: null,
  };

  // ---------- 画面切替 ----------
  function showView(name) {
    for (const v of ['calendar', 'day', 'graph']) $('view-' + v).hidden = v !== name;
    document.querySelectorAll('.tab').forEach((t) => {
      const active = t.dataset.tab === name || (name === 'day' && t.dataset.tab === 'calendar');
      t.classList.toggle('active', active);
      if (active) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    window.scrollTo(0, 0);
    if (name === 'graph' && state.redrawChart) state.redrawChart();
  }

  function renderSummary(container, s) {
    const item = (label, text, cls) => el('div', { className: 'sum-item' }, [
      el('span', { className: 'sum-label', text: label }),
      el('span', { className: 'sum-value ' + cls, text }),
    ]);
    container.replaceChildren(
      item('入金', yen(s.inc), s.inc ? 'plus' : 'zero'),
      item('出金', yen(s.exp), s.exp ? 'minus' : 'zero'),
      item('収支', fmtSigned(s.net), signClass(s.net)),
    );
  }

  // ---------- カレンダ ----------
  function renderCalendar() {
    const y = state.year;
    const m = state.month;
    $('month-title').textContent = `${y}年${m + 1}月`;
    const prefix = `${y}-${pad2(m + 1)}-`;
    const monthEntries = state.entries.filter((e) => e.date.startsWith(prefix));
    const net = new Map();
    for (const e of monthEntries) net.set(e.date, (net.get(e.date) || 0) + signedAmount(e));
    renderSummary($('month-summary'), summarize(monthEntries));

    const grid = $('calendar-grid');
    grid.replaceChildren();
    const startDow = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const today = toYmd(new Date());
    const blank = () => el('div', { className: 'cell empty', attrs: { 'aria-hidden': 'true' } });
    for (let i = 0; i < startDow; i++) grid.append(blank());
    for (let d = 1; d <= days; d++) {
      const ds = prefix + pad2(d);
      const v = net.get(ds) || 0;
      const dow = (startDow + d - 1) % 7;
      const cls = ['cell'];
      if (ds === today) cls.push('today');
      if (dow === 0) cls.push('sun');
      if (dow === 6) cls.push('sat');
      const b = el('button', {
        className: cls.join(' '),
        attrs: { type: 'button', 'aria-label': `${m + 1}月${d}日 収支 ${fmtSigned(v)}円` },
      }, [
        el('span', { className: 'day-num', text: String(d) }),
        el('span', { className: 'day-amount ' + signClass(v), text: fmtSigned(v) }),
      ]);
      b.addEventListener('click', () => openDay(ds));
      grid.append(b);
    }
    const trailing = (7 - ((startDow + days) % 7)) % 7;
    for (let i = 0; i < trailing; i++) grid.append(blank());
  }

  function moveMonth(delta) {
    const d = new Date(state.year, state.month + delta, 1);
    state.year = d.getFullYear();
    state.month = d.getMonth();
    renderCalendar();
  }

  // ---------- 日付の詳細 ----------
  function openDay(ds) {
    state.day = ds;
    setMode('view');
    showView('day');
  }
  const dayEntries = () => state.entries
    .filter((e) => e.date === state.day)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  function setMode(mode) {
    state.mode = mode;
    state.selected.clear();
    renderDay();
  }

  function renderDay() {
    $('day-title').textContent = fmtDayTitle(state.day);
    const list = dayEntries();
    renderSummary($('day-summary'), summarize(list));
    renderToolbar(list.length);
    const ul = $('entry-list');
    ul.replaceChildren(...list.map(entryItem));
    ul.classList.toggle('mode-edit', state.mode === 'edit');
    ul.classList.toggle('mode-delete', state.mode === 'delete');
  }

  function renderToolbar(count) {
    const tb = $('day-toolbar');
    const hint = $('day-hint');
    tb.replaceChildren();
    if (state.mode === 'view') {
      tb.append(
        button('＋ 追加', 'btn-primary', () => openForm(null)),
        button('編集', 'btn-secondary', () => setMode('edit'), count === 0),
      );
      hint.textContent = count ? '' : 'この日の入出金はまだありません。「追加」から入力してください。';
    } else if (state.mode === 'edit') {
      tb.append(
        button('🗑 ゴミ箱', 'btn-danger-outline', () => setMode('delete')),
        button('完了', 'btn-secondary', () => setMode('view')),
      );
      hint.textContent = '編集する項目を選択してください。削除する場合はゴミ箱ボタンを押してください。';
    } else {
      const n = state.selected.size;
      tb.append(
        button(`削除（${n}件）`, 'btn-danger', confirmDelete, n === 0),
        button('キャンセル', 'btn-secondary', () => setMode('edit')),
      );
      hint.textContent = '削除する項目を選択してください（複数選択できます）。';
    }
  }

  function entryItem(e) {
    const content = el('div', { className: 'entry-content' }, [
      el('div', { className: 'entry-main' }, [
        el('span', { className: 'badge ' + e.type, text: TYPE_LABEL[e.type] }),
        el('span', { className: 'entry-cat', text: e.category }),
        el('span', { className: 'entry-amount ' + signClass(signedAmount(e)), text: fmtSigned(signedAmount(e)) }),
      ]),
      el('div', { className: 'entry-meta' }, [
        el('span', { text: `入力日 ${fmtDateTime(e.createdAt)}` }),
        el('span', { text: `編集日 ${fmtDateTime(e.updatedAt)}` }),
      ]),
    ]);
    const li = el('li', { className: 'entry' });
    if (state.mode === 'edit') {
      const b = el('button', { className: 'entry-body selectable', attrs: { type: 'button', 'aria-label': `${TYPE_LABEL[e.type]} ${e.category} ${yen(e.amount)}円 を編集` } }, [content]);
      b.addEventListener('click', () => openForm(e));
      li.append(b);
    } else if (state.mode === 'delete') {
      const cb = el('input', { attrs: { type: 'checkbox', 'aria-label': `${TYPE_LABEL[e.type]} ${e.category} ${yen(e.amount)}円 を選択` } });
      cb.checked = state.selected.has(e.id);
      const label = el('label', { className: 'entry-body selectable' + (cb.checked ? ' checked' : '') }, [cb, content]);
      cb.addEventListener('change', () => {
        if (cb.checked) state.selected.add(e.id); else state.selected.delete(e.id);
        label.classList.toggle('checked', cb.checked);
        renderToolbar(dayEntries().length);
      });
      li.append(label);
    } else {
      li.append(el('div', { className: 'entry-body' }, [content]));
    }
    return li;
  }

  async function confirmDelete() {
    const ids = [...state.selected];
    if (!ids.length) return;
    const ok = await confirmDialog(`選択した ${ids.length} 件を削除しますか？\nこの操作は取り消せません。`);
    if (!ok) return; // 「いいえ」→ 選択状態を保ったまま選択画面に戻る
    try {
      await DB.deleteMany(ids);
      const del = new Set(ids);
      state.entries = state.entries.filter((e) => !del.has(e.id));
      setMode('view');
      renderCalendar();
      toast(`${ids.length} 件削除しました`);
    } catch (err) {
      console.error(err);
      toast('削除に失敗しました');
    }
  }

  // ---------- 入力フォーム ----------
  function fillCategories(type, selected) {
    const s = $('f-category');
    s.replaceChildren(el('option', {
      text: type ? '項目を選択してください' : '先に入金／出金を選択してください',
      attrs: { value: '' },
    }));
    if (type) {
      for (const c of CATEGORIES[type]) {
        const o = el('option', { text: c, attrs: { value: c } });
        if (c === selected) o.selected = true;
        s.append(o);
      }
    }
    s.disabled = !type;
  }

  function openForm(entry) {
    state.editing = entry;
    const f = $('entry-form');
    f.reset();
    $('form-error').textContent = '';
    $('form-title').textContent = entry ? '入出金を編集' : '入出金を追加';
    $('form-date').textContent = fmtDayTitle(state.day);
    if (entry) {
      f.elements.etype.value = entry.type;
      fillCategories(entry.type, entry.category);
      $('f-amount').value = String(entry.amount);
    } else {
      fillCategories(null);
    }
    openModal('form-modal', f.querySelector('input[name="etype"]:checked') ? $('f-amount') : f.querySelector('input[name="etype"]'));
  }

  function parseAmount(raw) {
    const s = String(raw)
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/[,，\s円¥￥]/g, '');
    if (!/^\d{1,9}$/.test(s)) return null;
    const n = Number(s);
    return n >= 1 && n <= MAX_AMOUNT ? n : null;
  }

  async function submitForm(ev) {
    ev.preventDefault();
    const f = $('entry-form');
    const type = f.elements.etype.value;
    const category = $('f-category').value;
    const amount = parseAmount($('f-amount').value);
    const err = $('form-error');
    if (!isType(type)) { err.textContent = '入金か出金を選択してください。'; return; }
    if (!CATEGORIES[type].includes(category)) { err.textContent = '項目を選択してください。'; $('f-category').focus(); return; }
    if (amount === null) { err.textContent = `金額は 1〜${yen(MAX_AMOUNT)} の整数で入力してください。`; $('f-amount').focus(); return; }

    const old = state.editing;
    if (old && old.type === type && old.category === category && old.amount === amount) {
      closeModal('form-modal');
      setMode('view');
      toast('変更はありません');
      return;
    }
    const nowIso = new Date().toISOString();
    const rec = old
      ? { ...old, type, category, amount, updatedAt: nowIso }
      : { id: newId(), date: state.day, type, category, amount, createdAt: nowIso, updatedAt: null };
    try {
      await DB.putMany([rec]);
      if (old) state.entries = state.entries.map((e) => (e.id === rec.id ? rec : e));
      else state.entries.push(rec);
      closeModal('form-modal');
      setMode('view');
      renderCalendar();
      toast('保存しました');
    } catch (e) {
      console.error(e);
      err.textContent = '保存に失敗しました。';
    }
  }

  // ---------- モーダル ----------
  const modalStack = [];
  const cancelHandlers = {};
  function openModal(id, focusEl) {
    const m = $(id);
    m.hidden = false;
    modalStack.push({ id, prev: document.activeElement });
    (focusEl || m.querySelector('button, input, select')).focus();
  }
  function closeModal(id) {
    $(id).hidden = true;
    const i = modalStack.findIndex((x) => x.id === id);
    if (i >= 0) {
      const [{ prev }] = modalStack.splice(i, 1);
      if (prev && prev.isConnected && prev.focus) prev.focus();
    }
  }
  document.addEventListener('keydown', (ev) => {
    const top = modalStack[modalStack.length - 1];
    if (!top) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      if (cancelHandlers[top.id]) cancelHandlers[top.id]();
    } else if (ev.key === 'Tab') {
      // フォーカスをダイアログ内に閉じ込める
      const items = [...$(top.id).querySelectorAll('button, input, select')].filter((x) => !x.disabled && x.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    }
  });

  let confirmResolve = null;
  function confirmDialog(message) {
    $('confirm-message').textContent = message;
    return new Promise((resolve) => {
      confirmResolve = resolve;
      openModal('confirm-modal', $('confirm-no')); // 誤操作防止のため「いいえ」に初期フォーカス
    });
  }
  function answerConfirm(v) {
    closeModal('confirm-modal');
    if (confirmResolve) { const r = confirmResolve; confirmResolve = null; r(v); }
  }
  cancelHandlers['confirm-modal'] = () => answerConfirm(false);
  cancelHandlers['form-modal'] = () => closeModal('form-modal');
  cancelHandlers['data-modal'] = () => closeModal('data-modal');

  // ---------- バックアップ ----------
  function exportData() {
    const data = { app: 'kakeibo', version: 1, exportedAt: new Date().toISOString(), entries: state.entries };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { attrs: { href: url, download: `kakeibo-backup-${toYmd(new Date())}.json` } });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`${state.entries.length} 件を書き出しました`);
  }

  // 読み込むデータは信用せず、1件ずつ形式を検証して必要な項目だけを取り出す
  function sanitizeEntry(r) {
    if (!r || typeof r !== 'object') return null;
    const { id, date, type, category, amount, createdAt, updatedAt } = r;
    if (typeof id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(id)) return null;
    if (!isValidYmd(date)) return null;
    if (!isType(type) || !CATEGORIES[type].includes(category)) return null;
    if (!Number.isInteger(amount) || amount < 1 || amount > MAX_AMOUNT) return null;
    if (!isIso(createdAt)) return null;
    if (updatedAt != null && !isIso(updatedAt)) return null;
    return {
      id, date, type, category, amount,
      createdAt: new Date(createdAt).toISOString(),
      updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
    };
  }

  async function importFile(file) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast('ファイルが大きすぎます（10MBまで）'); return; }
    let data;
    try { data = JSON.parse(await file.text()); } catch { toast('バックアップファイルとして読み込めませんでした'); return; }
    const list = data && Array.isArray(data.entries) ? data.entries : null;
    if (!list) { toast('バックアップファイルの形式が正しくありません'); return; }
    const valid = [];
    let invalid = 0;
    for (const raw of list) { const e = sanitizeEntry(raw); if (e) valid.push(e); else invalid++; }
    if (!valid.length) { toast('読み込めるデータがありませんでした'); return; }
    const ok = await confirmDialog(
      `${valid.length} 件のデータを読み込みます。` + (invalid ? `\n（形式が不正な ${invalid} 件は除外します）` : '')
      + '\n同じデータが既にある場合は上書きされます。よろしいですか？',
    );
    if (!ok) return;
    try {
      await DB.putMany(valid);
      const map = new Map(state.entries.map((e) => [e.id, e]));
      for (const e of valid) map.set(e.id, e);
      state.entries = [...map.values()];
      renderCalendar();
      closeModal('data-modal');
      toast(`${valid.length} 件読み込みました`);
    } catch (e) {
      console.error(e);
      toast('読み込みに失敗しました');
    }
  }

  // ---------- グラフ ----------
  const radioValue = (name) => document.querySelector(`input[name="${name}"]:checked`).value;

  function applyPreset() {
    const p = $('g-preset').value;
    const t = new Date();
    const y = t.getFullYear();
    const m = t.getMonth();
    let s;
    let e;
    switch (p) {
      case 'thisMonth': s = new Date(y, m, 1); e = new Date(y, m + 1, 0); break;
      case 'lastMonth': s = new Date(y, m - 1, 1); e = new Date(y, m, 0); break;
      case 'thisYear': s = new Date(y, 0, 1); e = new Date(y, 11, 31); break;
      case 'last12': s = new Date(y, m - 11, 1); e = new Date(y, m + 1, 0); break;
      case 'all': {
        const ds = state.entries.map((x) => x.date).sort();
        s = ds.length ? parseYmd(ds[0]) : new Date(y, m, 1);
        e = ds.length ? parseYmd(ds[ds.length - 1]) : t;
        if (e < t) e = t;
        break;
      }
      default: return; // custom
    }
    $('g-start').value = toYmd(s);
    $('g-end').value = toYmd(e);
  }

  function renderCatChips() {
    const type = radioValue('g-type');
    const cats = type === 'both' ? [...CATEGORIES.income, ...CATEGORIES.expense] : CATEGORIES[type];
    const box = $('g-cats');
    box.replaceChildren(...cats.map((c) => {
      const cb = el('input', { attrs: { type: 'checkbox', value: c } });
      cb.checked = state.graphCats.has(c);
      cb.addEventListener('change', () => { if (cb.checked) state.graphCats.add(c); else state.graphCats.delete(c); });
      const dot = el('span', { className: 'dot' });
      dot.style.backgroundColor = CAT_COLORS[c];
      return el('label', { className: 'chip' }, [cb, dot, el('span', { text: c })]);
    }));
  }

  function setAllCats(on) {
    $('g-cats').querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.checked = on;
      if (on) state.graphCats.add(cb.value); else state.graphCats.delete(cb.value);
    });
  }

  function makeBuckets(start, end, unit) {
    const keys = [];
    const labels = [];
    const e = parseYmd(end);
    let d = parseYmd(start);
    if (unit === 'day') {
      const sameYear = start.slice(0, 4) === end.slice(0, 4);
      while (d <= e) {
        if (keys.length >= MAX_DAY_BUCKETS) return null;
        keys.push(toYmd(d));
        labels.push(sameYear ? `${d.getMonth() + 1}/${d.getDate()}` : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`);
        d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      }
    } else if (unit === 'month') {
      const sameYear = start.slice(0, 4) === end.slice(0, 4);
      d = new Date(d.getFullYear(), d.getMonth(), 1);
      while (d <= e) {
        keys.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
        labels.push(sameYear ? `${d.getMonth() + 1}月` : `${d.getFullYear()}/${d.getMonth() + 1}`);
        d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      }
    } else {
      for (let y = d.getFullYear(); y <= e.getFullYear(); y++) { keys.push(String(y)); labels.push(`${y}年`); }
    }
    return { keys, labels };
  }
  const bucketKey = (date, unit) => (unit === 'day' ? date : unit === 'month' ? date.slice(0, 7) : date.slice(0, 4));

  function makeTable(headers, rows) {
    const table = el('table', { className: 'data-table' });
    table.append(el('thead', {}, [el('tr', {}, headers.map((h) => el('th', { text: h, attrs: { scope: 'col' } })))]));
    table.append(el('tbody', {}, rows.map((r) => el('tr', {}, r.map((c, i) => (
      i === 0
        ? el('th', { text: c.text, attrs: { scope: 'row' } })
        : el('td', { text: c.text, className: c.cls || '' })
    ))))));
    return el('div', { className: 'table-wrap' }, [table]);
  }

  function chartBox(out) {
    const wrap = el('div', { className: 'chart-wrap' });
    const canvas = el('canvas', { attrs: { role: 'img' } });
    wrap.append(canvas);
    out.append(wrap);
    return canvas;
  }

  function buildGraph(ev) {
    if (ev) ev.preventDefault();
    const errBox = $('graph-error');
    errBox.textContent = '';
    if ($('g-preset').value !== 'custom') applyPreset();
    const start = $('g-start').value;
    const end = $('g-end').value;
    const type = radioValue('g-type');
    const unit = radioValue('g-unit');
    const kind = radioValue('g-kind');
    const cats = [...$('g-cats').querySelectorAll('input:checked')].map((c) => c.value);

    if (!isValidYmd(start) || !isValidYmd(end)) { errBox.textContent = '期間（開始日・終了日）を正しく入力してください。'; return; }
    if (start > end) { errBox.textContent = '開始日は終了日以前の日付にしてください。'; return; }
    if (!cats.length) { errBox.textContent = '項目を1つ以上選択してください。'; return; }

    const catSet = new Set(cats);
    const match = (e) => (type === 'both' || e.type === type) && catSet.has(e.category);
    const inRange = state.entries.filter((e) => e.date >= start && e.date <= end && match(e));
    const out = $('graph-output');
    out.replaceChildren();
    state.redrawChart = null;

    const typeLabel = type === 'both' ? '入金・出金' : TYPE_LABEL[type];
    const unitLabel = { day: '日別', month: '月別', year: '年別' }[unit];
    out.append(el('p', {
      className: 'graph-caption',
      text: `${fmtYmdJa(start)} 〜 ${fmtYmdJa(end)}　／　${typeLabel}　／　${kind === 'pie' ? '項目別' : unitLabel}　／　${inRange.length} 件`,
    }));

    if (kind === 'pie') {
      const types = type === 'both' ? ['income', 'expense'] : [type];
      const draws = [];
      for (const t of types) {
        const slices = CATEGORIES[t]
          .filter((c) => catSet.has(c))
          .map((c) => ({
            label: c,
            color: CAT_COLORS[c],
            value: inRange.filter((e) => e.type === t && e.category === c).reduce((a, e) => a + e.amount, 0),
          }))
          .filter((s) => s.value > 0)
          .sort((a, b) => b.value - a.value);
        if (!slices.length) { out.append(el('p', { className: 'muted', text: `${TYPE_LABEL[t]}：対象のデータがありません。` })); continue; }
        const canvas = chartBox(out);
        canvas.setAttribute('aria-label', `${TYPE_LABEL[t]}の項目別円グラフ`);
        const draw = () => Charts.pie(canvas, { title: `${TYPE_LABEL[t]}の内訳`, slices });
        draws.push(draw);
        draw();
        const total = slices.reduce((a, s) => a + s.value, 0);
        out.append(makeTable(['項目', '金額', '割合'], slices.map((s) => [
          { text: s.label },
          { text: yen(s.value) + '円', cls: t === 'income' ? 'plus' : 'minus' },
          { text: (Math.round((s.value / total) * 1000) / 10) + '%' },
        ])));
      }
      state.redrawChart = () => draws.forEach((f) => f());
      return;
    }

    const bk = makeBuckets(start, end, unit);
    if (!bk) {
      out.replaceChildren();
      errBox.textContent = `日別は ${MAX_DAY_BUCKETS} 日以内の期間で指定してください（長い期間は月別・年別をご利用ください）。`;
      return;
    }
    const idx = new Map(bk.keys.map((k, i) => [k, i]));
    const n = bk.keys.length;
    const inc = new Array(n).fill(0);
    const exp = new Array(n).fill(0);
    for (const e of inRange) {
      const i = idx.get(bucketKey(e.date, unit));
      if (i == null) continue;
      if (e.type === 'income') inc[i] += e.amount; else exp[i] += e.amount;
    }

    if (kind === 'bar') {
      const series = [];
      if (type !== 'expense') series.push({ name: '入金', color: COLOR_INCOME, values: inc });
      if (type !== 'income') series.push({ name: '出金', color: COLOR_EXPENSE, values: exp });
      const canvas = chartBox(out);
      canvas.setAttribute('aria-label', `${unitLabel}の${typeLabel}推移棒グラフ`);
      const draw = () => Charts.bar(canvas, { labels: bk.labels, series });
      state.redrawChart = draw;
      draw();
      const headers = ['期間', ...series.map((s) => s.name)];
      if (type === 'both') headers.push('収支');
      out.append(makeTable(headers, bk.labels.map((l, i) => {
        const row = [{ text: l }];
        if (type !== 'expense') row.push({ text: yen(inc[i]), cls: inc[i] ? 'plus' : 'zero' });
        if (type !== 'income') row.push({ text: yen(exp[i]), cls: exp[i] ? 'minus' : 'zero' });
        if (type === 'both') row.push({ text: fmtSigned(inc[i] - exp[i]), cls: signClass(inc[i] - exp[i]) });
        return row;
      })));
      return;
    }

    // 折れ線：期間開始前の累計（同じ条件）を起点にした残高推移
    const prior = state.entries.filter((e) => e.date < start && match(e)).reduce((a, e) => a + signedAmount(e), 0);
    let run = prior;
    const cum = bk.keys.map((_, i) => (run += inc[i] - exp[i]));
    const canvas = chartBox(out);
    canvas.setAttribute('aria-label', `${unitLabel}の残高推移折れ線グラフ`);
    const draw = () => Charts.line(canvas, { labels: bk.labels, values: cum, color: COLOR_NET, name: '残高（累計収支）' });
    state.redrawChart = draw;
    draw();
    out.append(el('p', { className: 'muted', text: `期間開始前までの累計 ${fmtSigned(prior)}円（同じ条件）を起点にしています。` }));
    out.append(makeTable(['期間', '収支', '残高'], bk.labels.map((l, i) => [
      { text: l },
      { text: fmtSigned(inc[i] - exp[i]), cls: signClass(inc[i] - exp[i]) },
      { text: fmtSigned(cum[i]), cls: signClass(cum[i]) },
    ])));
  }

  function syncUnitAvailability() {
    const pie = radioValue('g-kind') === 'pie';
    $('g-unit-set').disabled = pie;
    $('g-unit-set').classList.toggle('is-disabled', pie);
  }

  // ---------- イベント登録 ----------
  function bind() {
    $('prev-month').addEventListener('click', () => moveMonth(-1));
    $('next-month').addEventListener('click', () => moveMonth(1));
    $('this-month').addEventListener('click', () => {
      const t = new Date();
      state.year = t.getFullYear();
      state.month = t.getMonth();
      renderCalendar();
    });
    $('day-back').addEventListener('click', () => { renderCalendar(); showView('calendar'); });
    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
      if (t.dataset.tab === 'calendar') renderCalendar();
      showView(t.dataset.tab);
    }));

    $('entry-form').addEventListener('submit', submitForm);
    $('entry-form').querySelectorAll('input[name="etype"]').forEach((r) => r.addEventListener('change', () => {
      fillCategories(r.value);
      $('form-error').textContent = '';
    }));
    $('form-cancel').addEventListener('click', () => closeModal('form-modal'));
    $('confirm-yes').addEventListener('click', () => answerConfirm(true));
    $('confirm-no').addEventListener('click', () => answerConfirm(false));

    $('btn-data').addEventListener('click', () => openModal('data-modal'));
    $('data-close').addEventListener('click', () => closeModal('data-modal'));
    $('btn-export').addEventListener('click', exportData);
    $('file-import').addEventListener('change', async (ev) => {
      const file = ev.target.files[0];
      ev.target.value = '';
      await importFile(file);
    });

    $('graph-form').addEventListener('submit', buildGraph);
    $('g-preset').addEventListener('change', applyPreset);
    ['g-start', 'g-end'].forEach((id) => $(id).addEventListener('change', () => { $('g-preset').value = 'custom'; }));
    document.querySelectorAll('input[name="g-type"]').forEach((r) => r.addEventListener('change', renderCatChips));
    document.querySelectorAll('input[name="g-kind"]').forEach((r) => r.addEventListener('change', syncUnitAvailability));
    $('g-cats-all').addEventListener('click', () => setAllCats(true));
    $('g-cats-none').addEventListener('click', () => setAllCats(false));

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (!$('view-graph').hidden && state.redrawChart) state.redrawChart(); }, 150);
    });
  }

  async function init() {
    bind();
    applyPreset();
    renderCatChips();
    syncUnitAvailability();
    try {
      const all = await DB.getAll();
      state.entries = all.map(sanitizeEntry).filter(Boolean);
    } catch (e) {
      console.error(e);
      toast('データの読み込みに失敗しました');
    }
    renderCalendar();
    DB.requestPersist();
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('service worker', e));
    }
  }

  init();
}());
