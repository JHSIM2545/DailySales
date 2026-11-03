/**
 * 북서울지사 영업일보 포털 - 컨설턴트별 최근 3개월 실적 추이 (Admin.html / User.html 공용)
 *
 *  - 직전 3개월 + 선택한 달(당월) 의 컨설턴트별 수주·개시 실적을 daily_orders 에서 직접 집계한다.
 *  - 법인(gross_type) 건과 영업동기 '전략영업' 건은 지사 고유 실적이 아니므로 뺀다. (천원 단위)
 *      수주 = contract_date 기준, 개시 = billing_date(기산일) 기준. 진행 중인 달의 개시는 오늘까지만.
 *  - 차트(SVG)·표·분석 문구는 모두 DB 숫자로만 만든다. 원인은 추측하지 않는다.
 *  - 화면: 대시보드/코칭 리포트의 <div class="rt-slot"> 를 찾아 채운다. PDF: window.repTrend_.reportParts(data, c)
 *
 *  window.repTrend_.load(c) -> Promise<data|null>
 *  window.repTrend_.cardHtml(data, c) -> 화면용 카드 HTML
 *  window.repTrend_.reportParts(data, c) -> PDF 용 블록 HTML 배열
 */
(function () {
  'use strict';
  if (window.__rtLoaded) return;
  window.__rtLoaded = true;

  var BASE = 'https://gpqlximhoqdybcewdfde.supabase.co/rest/v1/';
  var KEY = 'sb_publishable_xUnGxyLCc5TB5nv4keVQVw__grqGJkP';
  var COLORS = ['#cbd5e1', '#94a3b8', '#64748b', '#2563eb'];   // 3개월 전 → 당월
  var cache = {};

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(v) { return String(Math.round(Number(v) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function r1(v) { return Math.round(v * 10) / 10; }
  function pad(n) { return String(n).padStart(2, '0'); }

  function monthsOf(c) {
    var out = [];
    for (var i = 3; i >= 0; i--) {
      var y = c.y, m = c.m - i;
      while (m < 1) { m += 12; y--; }
      out.push({ ym: y + '-' + pad(m), y: y, m: m, cur: i === 0 });
    }
    return out;
  }

  function get(path) {
    return fetch(BASE + path, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  function load(c) {
    if (!c || !c.y || !c.m || c.isFutureMonth) return Promise.resolve(null);
    var ms = monthsOf(c), ck = ms[0].ym + '~' + ms[3].ym + '|' + (c.todayDs || '');
    var hit = cache[ck];
    if (hit && Date.now() - hit.t < 5 * 60 * 1000) return Promise.resolve(hit.d);
    var from = ms[0].ym + '-01';
    var q = 'daily_orders?select=rep_name,contract_date,billing_date,monthly_fee,gross_type,sales_motive&or=' +
      encodeURIComponent('(contract_date.gte.' + from + ',billing_date.gte.' + from + ')') + '&limit=5000';
    var q0 = 'daily_orders?select=contract_date&contract_date=not.is.null&order=contract_date.asc&limit=1';
    return Promise.all([get(q), get(q0)]).then(function (res) {
      var rows = res[0], first = res[1] && res[1][0] ? String(res[1][0].contract_date).slice(0, 7) : '';
      var today = c.todayDs || '';
      var reps = (c.reps || []).map(function (r) { return r.name; });
      var data = { months: ms, firstYm: first, reps: {}, total: {} };
      function slot(name) {
        if (!data.reps[name]) { data.reps[name] = { ord: [0, 0, 0, 0], start: [0, 0, 0, 0], ordN: [0, 0, 0, 0] }; }
        return data.reps[name];
      }
      reps.forEach(slot);
      data.total = { ord: [0, 0, 0, 0], start: [0, 0, 0, 0] };
      var strat = { ord: 0, start: 0 };
      rows.forEach(function (r) {
        if (r.gross_type === '법인') return;
        var k = (Number(r.monthly_fee) || 0) / 1000;
        var isStrat = String(r.sales_motive || '').indexOf('전략영업') >= 0;
        var cd = r.contract_date ? String(r.contract_date).slice(0, 7) : '', bd = r.billing_date ? String(r.billing_date).slice(0, 7) : '';
        ms.forEach(function (mo, i) {
          var rep = r.rep_name || '(미지정)';
          if (cd === mo.ym) {
            if (isStrat) { strat.ord += k; }
            else { var s = slot(rep); s.ord[i] += k; s.ordN[i] += 1; data.total.ord[i] += k; }
          }
          if (bd === mo.ym && (!(mo.cur && c.isCurMonth) || !today || String(r.billing_date) <= today)) {
            if (isStrat) { strat.start += k; }
            else { slot(rep).start[i] += k; data.total.start[i] += k; }
          }
        });
      });
      data.strat = { ord: Math.round(strat.ord), start: Math.round(strat.start) };
      cache[ck] = { t: Date.now(), d: data };
      return data;
    }).catch(function (e) { console.warn('[실적 추이] 조회 실패:', e && e.message); return null; });
  }

  function hasData(data, i) { return !data.firstYm || data.months[i].ym >= data.firstYm; }
  function label(mo) { return mo.m + '월' + (mo.cur ? '(당월)' : ''); }

  // 직전 3개월 평균·추세 (데이터가 있는 달만)
  function stat(data, arr, c) {
    var idx = [0, 1, 2].filter(function (i) { return hasData(data, i); });
    var vals = idx.map(function (i) { return arr[i]; });
    var avg = vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : null;
    var trend = '자료 부족', tcol = '#64748b';
    if (vals.length >= 2) {
      var a = vals[0], b = vals[vals.length - 1];
      if (a === 0 && b === 0) { trend = '실적 없음'; }
      else if (a === 0) { trend = '신규 상승'; tcol = '#0f766e'; }
      else {
        var ch = (b - a) / a * 100;
        if (ch >= 20) { trend = '상승 +' + Math.round(ch) + '%'; tcol = '#0f766e'; }
        else if (ch <= -20) { trend = '하락 ' + Math.round(ch) + '%'; tcol = '#b91c1c'; }
        else { trend = '횡보 ' + (ch >= 0 ? '+' : '') + Math.round(ch) + '%'; tcol = '#475569'; }
      }
    }
    return { avg: avg, trend: trend, tcol: tcol, n: vals.length };
  }

  // ---------------- 차트 (그룹 막대, 인라인 SVG) ----------------
  function chartSvg(data, key, title, W0, anim) {
    var names = Object.keys(data.reps);
    var W = W0 || 640, H = 168, L = 38, R = 8, T = 22, B = 22;
    var max = 0;
    names.forEach(function (n) { data.reps[n][key].forEach(function (v) { if (v > max) max = v; }); });
    if (max <= 0) return '<div style="color:#64748b;font-size:12px;padding:10px 0;">' + esc(title) + ': 표시할 실적이 없습니다.</div>';
    var step = Math.pow(10, Math.floor(Math.log10(max))), top = Math.ceil(max / step) * step;
    if (top / step < 2) top = step * 2;
    var pw = W - L - R, ph = H - T - B, gw = pw / names.length, bw = Math.min(anim ? 34 : 22, (gw - 14) / 4);
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' + esc(title) + '" style="display:block;width:100%;' + (anim ? '' : 'max-width:440px;') + 'font-family:inherit;">';
    s += '<text x="' + L + '" y="14" font-size="12" font-weight="700" fill="#0f172a">' + esc(title) + ' (천원)</text>';
    for (var g = 0; g <= 2; g++) {
      var gv = top * g / 2, gy = T + ph - ph * g / 2;
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + gy + '" y2="' + gy + '" stroke="#e2e8f0" stroke-width="1"/>' +
        '<text x="' + (L - 4) + '" y="' + (gy + 3) + '" font-size="9" text-anchor="end" fill="#64748b">' + fmt(gv) + '</text>';
    }
    names.forEach(function (n, ri) {
      var x0 = L + gw * ri + (gw - bw * 4 - 6) / 2;
      data.reps[n][key].forEach(function (v, i) {
        if (!hasData(data, i)) return;
        var h = ph * v / top, x = x0 + i * (bw + 2), y = T + ph - h;
        var dl = (ri * 90 + i * 70);
        s += '<rect' + (anim ? ' class="rt-bar" style="--d:' + dl + 'ms"' : '') + ' x="' + x + '" y="' + y + '" width="' + bw + '" height="' + Math.max(h, v > 0 ? 1 : 0) + '" rx="2" fill="' + COLORS[i] + '"/>';
        if (v > 0) s += '<text' + (anim ? ' class="rt-val" style="--d:' + dl + 'ms"' : '') + ' x="' + (x + bw / 2) + '" y="' + (y - 3) + '" font-size="' + (anim ? 9 : 8) + '" text-anchor="middle" fill="#334155">' + fmt(v) + '</text>';
      });
      s += '<text x="' + (L + gw * ri + gw / 2) + '" y="' + (H - B + 14) + '" font-size="11" font-weight="700" text-anchor="middle" fill="#0f172a">' + esc(n) + '</text>';
    });
    // 범례 (제목 줄 오른쪽)
    var lx0 = W - R - 4 * 66;
    data.months.forEach(function (mo, i) {
      if (!hasData(data, i)) return;
      var lx = lx0 + i * 66;
      s += '<rect x="' + lx + '" y="5" width="9" height="9" rx="2" fill="' + COLORS[i] + '"/><text x="' + (lx + 12) + '" y="13" font-size="9" fill="#334155">' + esc(mo.m + '월' + (mo.cur ? '·당월' : '')) + '</text>';
    });
    return s + '</svg>';
  }

  // ---------------- 표 (지표 하나씩) ----------------
  function tableOne(data, key, title, c) {
    var names = Object.keys(data.reps);
    function row(name, arr, sum) {
      var st = stat(data, arr, c);
      return '<tr' + (sum ? ' class="sum" style="background:#eff6ff;font-weight:800;"' : '') + '><td style="font-weight:800;white-space:nowrap;">' + esc(name) + '</td>' +
        arr.map(function (v, i) { return '<td class="n" style="text-align:right;' + (i === 3 ? 'font-weight:800;' : '') + '">' + (hasData(data, i) ? fmt(v) : '-') + '</td>'; }).join('') +
        '<td style="color:' + st.tcol + ';font-weight:700;text-align:center;white-space:nowrap;">' + esc(st.trend) + '</td></tr>';
    }
    var h = '<table class="ai-data-table" style="font-size:11.5px;width:100%;"><thead><tr><th>' + esc(title) + ' (천원)</th>' +
      data.months.map(function (mo) { return '<th>' + esc(label(mo)) + '</th>'; }).join('') + '<th>추세</th></tr></thead><tbody>';
    names.forEach(function (n) { h += row(n, data.reps[n][key], false); });
    return h + row('지사 합계', data.total[key], true) + '</tbody></table>';
  }

  // 차트(왼쪽) + 표(오른쪽) 한 줄
  function pairHtml(data, key, title, c, W, minw) {
    return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(' + minw + 'px,1fr));gap:12px;align-items:center;margin-bottom:6px;">' +
      '<div>' + chartSvg(data, key, title + ' 추이', W) + '</div><div style="overflow-x:auto;">' + tableOne(data, key, title, c) + '</div></div>';
  }

  function noteText(data, c) {
    var st = data.strat || {};
    return '전략영업·법인 제외' + ((st.ord || st.start) ? '(제외분 수주 ' + fmt(st.ord) + ' · 개시 ' + fmt(st.start) + ')' : '') + ' · 개시는 기산일 기준' + (c.isCurMonth ? ' · 당월은 오늘까지 누계' : '');
  }

  function cardHtml(data, c) {
    if (!data) return '<div style="font-size:12px;color:#64748b;">최근 3개월 실적 추이를 불러오지 못했습니다.</div>';
    function col(key, title) { return '<div style="min-width:0;"><div style="overflow-x:auto;">' + chartSvg(data, key, title + ' 추이', 560, true) + '</div><div style="margin-top:6px;overflow-x:auto;">' + tableOne(data, key, title, c) + '</div></div>'; }
    return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(400px,1fr));gap:16px;align-items:start;">' + col('ord', '수주') + col('start', '개시') + '</div>' +
      '<div style="margin-top:8px;font-size:11px;color:#64748b;">' + esc(noteText(data, c)) + '</div>';
  }

  function reportParts(data, c) {
    if (!data) return [];
    return ['<div class="blk"><h3 class="s">4.3 컨설턴트별 최근 3개월 수주·개시 추이 (천원)</h3>' + pairHtml(data, 'ord', '수주', c, 360, 300) + pairHtml(data, 'start', '개시', c, 360, 300) + '<p class="note">' + esc(noteText(data, c)) + '</p></div>'];
  }

  window.repTrend_ = { load: load, cardHtml: cardHtml, reportParts: reportParts };

  // ---------------- 화면 슬롯 채우기 ----------------
  function fill(slot) {
    slot.dataset.rt = '1';
    var c = window.DASH_REPORT_CTX_;
    if (!c) { slot.innerHTML = ''; return; }
    slot.innerHTML = '<div style="font-size:12px;color:#64748b;">최근 3개월 실적 추이를 불러오는 중…</div>';
    load(c).then(function (d) { if (document.body.contains(slot)) slot.innerHTML = cardHtml(d, c); slot.classList.remove('rt-go'); play(slot); });
  }
  var css = document.createElement('style');
  css.textContent = '.rt-bar{transform:scaleY(0);transform-box:fill-box;transform-origin:50% 100%;}' +
    '.rt-val{opacity:0;}' +
    '.rt-go .rt-bar{animation:rtGrow .75s cubic-bezier(.2,.8,.2,1) forwards;animation-delay:var(--d,0ms);}' +
    '.rt-go .rt-val{animation:rtFade .4s ease forwards;animation-delay:calc(var(--d,0ms) + 450ms);}' +
    '@keyframes rtGrow{from{transform:scaleY(0)}to{transform:scaleY(1)}}@keyframes rtFade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}' +
    '@media (prefers-reduced-motion:reduce){.rt-bar{transform:none;animation:none!important}.rt-val{opacity:1;animation:none!important}}';
  document.head.appendChild(css);
  var io = (typeof IntersectionObserver !== 'undefined') ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('rt-go'); io.unobserve(e.target); } });
  }, { threshold: 0.25 }) : null;
  function play(slot) { if (io) io.observe(slot); else slot.classList.add('rt-go'); }
  // 마우스를 올리면 막대 애니메이션 재생
  document.addEventListener('mouseover', function (ev) {
    var sl = ev.target && ev.target.closest && ev.target.closest('.rt-slot');
    if (!sl || !sl.classList.contains('rt-go')) return;
    var n = Date.now(); if (sl.__rtT && n - sl.__rtT < 1800) return; sl.__rtT = n;
    sl.classList.remove('rt-go'); void sl.offsetWidth; sl.classList.add('rt-go');
  });

  var pending = false;
  function scan() {
    pending = false;
    var s = document.querySelectorAll('.rt-slot');
    for (var i = 0; i < s.length; i++) if (!s[i].dataset.rt) fill(s[i]);
  }
  new MutationObserver(function () { if (!pending) { pending = true; requestAnimationFrame(scan); } })
    .observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(scan, 0);
})();
