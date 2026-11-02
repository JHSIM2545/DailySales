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
  function chartSvg(data, key, title) {
    var names = Object.keys(data.reps);
    var W = 640, H = 230, L = 38, R = 8, T = 30, B = 40;
    var max = 0;
    names.forEach(function (n) { data.reps[n][key].forEach(function (v) { if (v > max) max = v; }); });
    if (max <= 0) return '<div style="color:#64748b;font-size:12px;padding:10px 0;">' + esc(title) + ': 표시할 실적이 없습니다.</div>';
    var step = Math.pow(10, Math.floor(Math.log10(max))), top = Math.ceil(max / step) * step;
    if (top / step < 2) top = step * 2;
    var pw = W - L - R, ph = H - T - B, gw = pw / names.length, bw = Math.min(22, (gw - 14) / 4);
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' + esc(title) + '" style="display:block;max-width:100%;font-family:inherit;">';
    s += '<text x="' + L + '" y="14" font-size="12" font-weight="700" fill="#0f172a">' + esc(title) + ' (천원)</text>';
    for (var g = 0; g <= 4; g++) {
      var gv = top * g / 4, gy = T + ph - ph * g / 4;
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + gy + '" y2="' + gy + '" stroke="#e2e8f0" stroke-width="1"/>' +
        '<text x="' + (L - 4) + '" y="' + (gy + 3) + '" font-size="9" text-anchor="end" fill="#64748b">' + fmt(gv) + '</text>';
    }
    names.forEach(function (n, ri) {
      var x0 = L + gw * ri + (gw - bw * 4 - 6) / 2;
      data.reps[n][key].forEach(function (v, i) {
        if (!hasData(data, i)) return;
        var h = ph * v / top, x = x0 + i * (bw + 2), y = T + ph - h;
        s += '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + Math.max(h, v > 0 ? 1 : 0) + '" rx="2" fill="' + COLORS[i] + '"/>';
        if (v > 0) s += '<text x="' + (x + bw / 2) + '" y="' + (y - 3) + '" font-size="8" text-anchor="middle" fill="#334155">' + fmt(v) + '</text>';
      });
      s += '<text x="' + (L + gw * ri + gw / 2) + '" y="' + (H - B + 14) + '" font-size="11" font-weight="700" text-anchor="middle" fill="#0f172a">' + esc(n) + '</text>';
    });
    // 범례
    data.months.forEach(function (mo, i) {
      if (!hasData(data, i)) return;
      var lx = L + i * 92;
      s += '<rect x="' + lx + '" y="' + (H - 12) + '" width="10" height="10" rx="2" fill="' + COLORS[i] + '"/><text x="' + (lx + 14) + '" y="' + (H - 3) + '" font-size="10" fill="#334155">' + esc(label(mo)) + '</text>';
    });
    return s + '</svg>';
  }

  // ---------------- 표 ----------------
  function tableHtml(data, c) {
    var names = Object.keys(data.reps);
    function head(k) { return data.months.map(function (mo) { return '<th>' + esc(label(mo)) + '</th>'; }).join('') + '<th>추세(3개월)</th>'; }
    function cells(arr, st) {
      return arr.map(function (v, i) { return '<td class="n" style="text-align:right;' + (i === 3 ? 'font-weight:800;' : '') + '">' + (hasData(data, i) ? fmt(v) : '-') + '</td>'; }).join('') +
        '<td style="color:' + st.tcol + ';font-weight:700;text-align:center;white-space:nowrap;">' + esc(st.trend) + '</td>';
    }
    var h = '<table class="ai-data-table" style="font-size:11px;width:100%;"><thead><tr><th rowspan="2">컨설턴트</th><th colspan="5">수주 (천원)</th><th colspan="5" style="border-left:2px solid #94a3b8;">개시 (천원)</th></tr><tr>' + head('ord') + head('start').replace('<th>', '<th style="border-left:2px solid #94a3b8;">') + '</tr></thead><tbody>';
    names.forEach(function (n) {
      var r = data.reps[n];
      h += '<tr><td style="font-weight:800;">' + esc(n) + '</td>' + cells(r.ord, stat(data, r.ord, c)) +
        cells(r.start, stat(data, r.start, c)).replace('<td', '<td style="border-left:2px solid #94a3b8;text-align:right;"') + '</tr>';
    });
    var to = data.total;
    h += '<tr class="sum" style="background:#eff6ff;font-weight:800;"><td>지사 합계</td>' + cells(to.ord, stat(data, to.ord, c)) +
      cells(to.start, stat(data, to.start, c)).replace('<td', '<td style="border-left:2px solid #94a3b8;text-align:right;"') + '</tr>';
    return h + '</tbody></table>';
  }

  // ---------------- 분석 문구 (DB 숫자만 사용) ----------------
  function analysis(data, c) {
    var out = [], names = Object.keys(data.reps), mo = data.months, wr = Number(c.workRatio) || 0;
    var okIdx = [0, 1, 2].filter(function (i) { return hasData(data, i); });
    if (okIdx.length < 2) return ['직전 3개월 중 일보 DB에 입력된 기간이 ' + okIdx.length + '개월뿐이라 추세 분석은 자료가 쌓인 뒤 가능합니다. (일보 DB 최초 수주일: ' + (data.firstYm || '자료 없음') + ')'];

    // 지사 전체
    var t = data.total, to = t.ord, ts = t.start;
    var seq = function (arr) { return okIdx.map(function (i) { return mo[i].m + '월 ' + fmt(arr[i]); }).join(' → '); };
    var tsOrd = stat(data, to, c), tsSt = stat(data, ts, c);
    var p = '지사 전체 수주는 ' + seq(to) + '천원(' + tsOrd.trend + '), 개시는 ' + seq(ts) + '천원(' + tsSt.trend + ')입니다.';
    if (tsOrd.avg != null) {
      var cu = to[3], pr = tsOrd.avg ? Math.round(cu / tsOrd.avg * 100) : null;
      p += ' ' + mo[3].m + '월 ' + (c.isCurMonth ? '현재까지 ' : '') + '수주 ' + fmt(cu) + '천원은 직전 ' + tsOrd.n + '개월 평균(' + fmt(tsOrd.avg) + '천원)의 ' + (pr == null ? '-' : pr + '%') + '입니다.' +
        (c.isCurMonth && pr != null ? ' 영업일 진척률 ' + wr + '% 대비 ' + (pr >= wr ? '평균 페이스 이상입니다.' : '평균 페이스에 못 미칩니다.') : '');
    }
    out.push(p);

    // 컨설턴트별
    names.forEach(function (n) {
      var r = data.reps[n], so = stat(data, r.ord, c), ss = stat(data, r.start, c);
      if (r.ord.every(function (v) { return v === 0; }) && r.start.every(function (v) { return v === 0; })) { out.push(n + ': 조회 기간 수주·개시 실적이 없습니다.'); return; }
      var line = n + ': 수주 ' + seq(r.ord) + '천원(' + so.trend + ')';
      if (so.avg != null) {
        var pr2 = so.avg ? Math.round(r.ord[3] / so.avg * 100) : null;
        line += ', ' + mo[3].m + '월 ' + (c.isCurMonth ? '현재 ' : '') + fmt(r.ord[3]) + '천원' + (pr2 != null ? '(3개월 평균의 ' + pr2 + '%' + (c.isCurMonth ? (pr2 >= wr ? ', 진척률 이상' : ', 진척률 미달') : '') + ')' : '');
      }
      line += '. 개시 ' + seq(r.start) + '천원(' + ss.trend + ').';
      if (so.trend.indexOf('하락') === 0) line += ' 3개월 전보다 수주가 줄어든 상태라 가망 안건 점검과 동행 지원이 필요합니다.';
      else if (so.trend.indexOf('상승') === 0 || so.trend === '신규 상승') line += ' 상승 흐름을 유지하도록 클로징 안건을 우선 지원하세요.';
      var gap = so.avg != null && ss.avg != null && so.avg > 0 ? Math.round(ss.avg / so.avg * 100) : null;
      if (gap != null && gap < 60) line += ' 개시가 수주 평균의 ' + gap + '%에 그쳐 수주→개시 전환 일정 점검이 필요합니다.';
      out.push(line);
    });

    // 최다/최저
    var sorted = names.slice().sort(function (a, b) { return sum3(data.reps[b].ord) - sum3(data.reps[a].ord); });
    function sum3(a) { return okIdx.reduce(function (s, i) { return s + a[i]; }, 0); }
    if (sorted.length > 1 && sum3(data.reps[sorted[0]].ord) > 0) out.push('직전 ' + okIdx.length + '개월 누적 수주 1위는 ' + sorted[0] + '(' + fmt(sum3(data.reps[sorted[0]].ord)) + '천원)이며, 가장 낮은 컨설턴트는 ' + sorted[sorted.length - 1] + '(' + fmt(sum3(data.reps[sorted[sorted.length - 1]].ord)) + '천원)입니다.');

    out.push('※ 법인 건과 영업동기가 전략영업인 건은 사업팀 전략영업 실적이므로 제외했습니다' + (data.strat && (data.strat.ord || data.strat.start) ? ' (조회 기간 제외분: 수주 ' + fmt(data.strat.ord) + '천원, 개시 ' + fmt(data.strat.start) + '천원)' : '') + '. 개시는 기산일 기준이며' + (c.isCurMonth ? ', 당월은 오늘까지 집계된 누계라 마감 월과 단순 비교할 수 없습니다.' : '입니다.') + (data.firstYm ? ' 일보 DB는 ' + data.firstYm + ' 이후 자료만 있습니다.' : ''));
    return out;
  }

  function noteText(data, c) {
    var st = data.strat || {};
    return '전략영업·법인 제외' + ((st.ord || st.start) ? '(제외분 수주 ' + fmt(st.ord) + ' · 개시 ' + fmt(st.start) + ')' : '') + ' · 개시는 기산일 기준' + (c.isCurMonth ? ' · 당월은 오늘까지 누계' : '');
  }

  function cardHtml(data, c) {
    if (!data) return '<div style="font-size:12px;color:#64748b;">최근 3개월 실적 추이를 불러오지 못했습니다.</div>';
    return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px;">' +
      '<div>' + chartSvg(data, 'ord', '컨설턴트별 수주 추이') + '</div><div>' + chartSvg(data, 'start', '컨설턴트별 개시 추이') + '</div></div>' +
      '<div style="margin-top:10px;overflow-x:auto;">' + tableHtml(data, c) + '</div>' +
      '<div style="margin-top:6px;font-size:11px;color:#64748b;">' + esc(noteText(data, c)) + '</div>';
  }

  function reportParts(data, c) {
    if (!data) return [];
    return ['<div class="blk"><h3 class="s">4.3 컨설턴트별 최근 3개월 수주·개시 추이 (천원)</h3>' + chartSvg(data, 'ord', '컨설턴트별 수주 추이') + chartSvg(data, 'start', '컨설턴트별 개시 추이') + tableHtml(data, c) + '<p class="note">' + esc(noteText(data, c)) + '</p></div>'];
  }

  window.repTrend_ = { load: load, cardHtml: cardHtml, reportParts: reportParts, analysis: analysis };

  // ---------------- 화면 슬롯 채우기 ----------------
  function fill(slot) {
    slot.dataset.rt = '1';
    var c = window.DASH_REPORT_CTX_;
    if (!c) { slot.innerHTML = ''; return; }
    slot.innerHTML = '<div style="font-size:12px;color:#64748b;">최근 3개월 실적 추이를 불러오는 중…</div>';
    load(c).then(function (d) { if (document.body.contains(slot)) slot.innerHTML = cardHtml(d, c); });
  }
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
