'use strict';
/*
 * 外部ライブラリを使わない軽量グラフ描画（Canvas）。
 * オフラインでも動作し、外部CDNへの通信も発生しない。
 */
const Charts = (() => {
  const FONT = '12px system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif';
  const FONT_BOLD = 'bold 14px system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif';
  const TEXT = '#1f2328';
  const MUTED = '#5f6670';
  const GRID = '#e3e6ea';
  const AXIS = '#8a929c';

  const trim1 = (x) => String(Math.round(x * 10) / 10);
  function compact(v) {
    const a = Math.abs(v);
    const s = v < 0 ? '-' : '';
    if (a >= 1e8) return s + trim1(a / 1e8) + '億';
    if (a >= 1e4) return s + trim1(a / 1e4) + '万';
    return s + a.toLocaleString('ja-JP');
  }
  const yen = (v) => (v < 0 ? '-' : '') + Math.abs(v).toLocaleString('ja-JP') + '円';

  function setup(canvas, height) {
    const w = canvas.parentElement.clientWidth || 600;
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = w + 'px';
    canvas.style.height = height + 'px';
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, height);
    ctx.font = FONT;
    return { ctx, w, h: height };
  }

  function niceScale(min, max, count = 5) {
    if (min === max) {
      if (max === 0) max = 1;
      else if (max > 0) min = 0;
      else max = 0;
    }
    const raw = (max - min) / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = Math.max(1, (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag);
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v));
    return { lo, hi: hi === lo ? lo + step : hi, ticks };
  }

  function drawYAxis(ctx, sc, yAt, left, right) {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    for (const t of sc.ticks) {
      const y = Math.round(yAt(t)) + 0.5;
      ctx.strokeStyle = t === 0 ? AXIS : GRID;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.fillStyle = MUTED;
      ctx.fillText(compact(t), left - 6, y);
    }
  }

  function drawXLabels(ctx, labels, xAt, y, plotW) {
    const maxLabels = Math.max(1, Math.floor(plotW / 56));
    const step = Math.ceil(labels.length / maxLabels);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = MUTED;
    labels.forEach((l, i) => { if (i % step === 0) ctx.fillText(l, xAt(i), y); });
  }

  function drawLegend(ctx, items, x, y) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const it of items) {
      ctx.fillStyle = it.color;
      ctx.fillRect(x, y - 5, 10, 10);
      ctx.fillStyle = TEXT;
      ctx.fillText(it.name, x + 14, y);
      x += 14 + ctx.measureText(it.name).width + 16;
    }
  }

  // ---- ツールチップ（マウス移動・タップで値を表示） ----
  function attachTooltip(canvas) {
    if (canvas._tipBound) return;
    canvas._tipBound = true;
    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    canvas.parentElement.append(tip);
    const show = (ev) => {
      const r = canvas.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      const hit = (canvas._hits || []).find((h) => h.test(x, y));
      if (!hit) { tip.hidden = true; return; }
      tip.textContent = hit.text; // textContent で表示（HTMLとして解釈しない）
      tip.hidden = false;
      const left = Math.min(Math.max(0, x + 12), Math.max(0, r.width - tip.offsetWidth));
      let top = y - tip.offsetHeight - 10;
      if (top < 0) top = y + 16;
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    };
    canvas.addEventListener('pointermove', show);
    canvas.addEventListener('pointerdown', show);
    canvas.addEventListener('pointerleave', () => { tip.hidden = true; });
  }

  // ---- 棒グラフ ----
  function bar(canvas, { labels, series }) {
    const { ctx, w, h } = setup(canvas, 320);
    const P = { l: 58, r: 12, t: 34, b: 34 };
    const pw = w - P.l - P.r;
    const ph = h - P.t - P.b;
    const vals = series.flatMap((s) => s.values);
    const sc = niceScale(Math.min(0, ...vals), Math.max(0, ...vals));
    const yAt = (v) => P.t + ph * (sc.hi - v) / (sc.hi - sc.lo);

    drawYAxis(ctx, sc, yAt, P.l, w - P.r);
    drawLegend(ctx, series, P.l, 14);

    const n = labels.length;
    const band = pw / n;
    const gw = Math.min(band * 0.75, 36 * series.length);
    const bw = gw / series.length;
    const gap = bw > 4 ? 1 : 0;
    const hits = [];
    for (let i = 0; i < n; i++) {
      series.forEach((s, j) => {
        const v = s.values[i];
        if (!v) return;
        const x = P.l + band * i + (band - gw) / 2 + bw * j;
        const y0 = yAt(0);
        const y1 = yAt(v);
        ctx.fillStyle = s.color;
        ctx.fillRect(x + gap, Math.min(y0, y1), Math.max(1, bw - gap * 2), Math.max(1, Math.abs(y1 - y0)));
      });
      const x0 = P.l + band * i;
      hits.push({
        test: (px, py) => px >= x0 && px < x0 + band && py >= P.t && py <= P.t + ph,
        text: [labels[i], ...series.map((s) => `${s.name}: ${yen(s.values[i])}`)].join('\n'),
      });
    }
    drawXLabels(ctx, labels, (i) => P.l + band * (i + 0.5), P.t + ph + 8, pw);
    canvas._hits = hits;
    attachTooltip(canvas);
  }

  // ---- 折れ線グラフ ----
  function line(canvas, { labels, values, color, name }) {
    const { ctx, w, h } = setup(canvas, 320);
    const P = { l: 58, r: 16, t: 34, b: 34 };
    const pw = w - P.l - P.r;
    const ph = h - P.t - P.b;
    const sc = niceScale(Math.min(0, ...values), Math.max(0, ...values));
    const yAt = (v) => P.t + ph * (sc.hi - v) / (sc.hi - sc.lo);
    const n = values.length;
    const xAt = (i) => (n === 1 ? P.l + pw / 2 : P.l + pw * i / (n - 1));

    drawYAxis(ctx, sc, yAt, P.l, w - P.r);
    drawLegend(ctx, [{ name, color }], P.l, 14);

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    values.forEach((v, i) => (i ? ctx.lineTo(xAt(i), yAt(v)) : ctx.moveTo(xAt(i), yAt(v))));
    ctx.stroke();
    if (n <= 62) {
      ctx.fillStyle = color;
      values.forEach((v, i) => { ctx.beginPath(); ctx.arc(xAt(i), yAt(v), 3, 0, Math.PI * 2); ctx.fill(); });
    }

    const half = n === 1 ? pw / 2 : pw / (n - 1) / 2;
    canvas._hits = values.map((v, i) => ({
      test: (px, py) => Math.abs(px - xAt(i)) <= half && py >= P.t && py <= P.t + ph,
      text: `${labels[i]}\n${name}: ${yen(v)}`,
    }));
    drawXLabels(ctx, labels, xAt, P.t + ph + 8, pw);
    attachTooltip(canvas);
  }

  // ---- 円グラフ ----
  function pie(canvas, { title, slices }) {
    const W = canvas.parentElement.clientWidth || 600;
    const narrow = W < 520;
    const H = narrow ? 250 + slices.length * 24 : Math.max(280, 70 + slices.length * 26);
    const { ctx, w } = setup(canvas, H);
    const total = slices.reduce((a, s) => a + s.value, 0);

    ctx.font = FONT_BOLD;
    ctx.fillStyle = TEXT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`${title}（合計 ${yen(total)}）`, 4, 4);
    ctx.font = FONT;

    const r = narrow ? Math.min(w / 2 - 20, 100) : Math.min(110, (H - 60) / 2);
    const cx = narrow ? w / 2 : 24 + r;
    const cy = 34 + r;
    const hits = [];
    let a = -Math.PI / 2;
    for (const s of slices) {
      const sweep = (s.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, a, a + sweep);
      ctx.closePath();
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      const pct = (s.value / total) * 100;
      if (pct >= 6) {
        const mid = a + sweep / 2;
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold ' + FONT;
        ctx.fillText(trim1(pct) + '%', cx + Math.cos(mid) * r * 0.62, cy + Math.sin(mid) * r * 0.62);
        ctx.font = FONT;
      }
      const a0 = a + Math.PI / 2;
      const a1 = a0 + sweep;
      hits.push({
        test: (px, py) => {
          const dx = px - cx;
          const dy = py - cy;
          if (dx * dx + dy * dy > r * r) return false;
          const ang = (Math.atan2(dy, dx) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
          return ang >= a0 && ang < a1;
        },
        text: `${s.label}: ${yen(s.value)}（${trim1(pct)}%）`,
      });
      a += sweep;
    }

    // 凡例
    let lx = narrow ? 16 : cx + r + 32;
    let ly = narrow ? cy + r + 24 : 44;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const s of slices) {
      ctx.fillStyle = s.color;
      ctx.fillRect(lx, ly - 6, 12, 12);
      ctx.fillStyle = TEXT;
      ctx.fillText(`${s.label}  ${yen(s.value)}（${trim1((s.value / total) * 100)}%）`, lx + 18, ly);
      ly += narrow ? 24 : 26;
    }
    canvas._hits = hits;
    attachTooltip(canvas);
  }

  return { bar, line, pie, compact };
})();
