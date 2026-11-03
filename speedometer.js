/**
 * 북서울지사 영업일보 포털 - 영업 속도계 (Admin.html / User.html 공용)
 *
 *  종합대시보드 「1. 영업 현황」 아래 <div class="sp-slot"> 를 채운다.
 *  - 지사 전체(일반알람/휴엔/정보보안) 수주(계약)·개시·유지감소·유지증가 4개 지표를
 *    "영업일 진척률(경과 영업일 / 해당 월 전체 영업일)" 로 정규화해 비교한다.
 *      1) 최근 N개월(직전 3개월 중 월중 스냅샷이 충분한 달) 같은 영업일 시점의 달성률 평균 대비 빠른지/느린지  -> 속도계 바늘
 *         (달성률 차이 × 해당 월 영업일수 = "영업일 환산" 앞섬/뒤처짐)
 *      2) 목표 대비 진도(달성률 / 영업일 진척률), 지사 계획 대비 진도
 *      3) 타지사 15곳의 최근 N개월 같은 시점 평균 달성률과 비교
 *  - 데이터: public.biz_team_data (사업팀 지사별 일일 현황 스냅샷, 계획 = 사업팀 목표) + public.sales_targets_product (지사 계획)
 *  - 월중 스냅샷이 4건 미만인 달은 비교에서 빼고 화면에 그 사실을 표시한다. 원인은 추측하지 않는다.
 *
 *  window.speedo_ = { load(c), cardHtml(data, c) }
 */
(function () {
  'use strict';
  if (window.__spLoaded) return;
  window.__spLoaded = true;

  var BASE = 'https://gpqlximhoqdybcewdfde.supabase.co/rest/v1/';
  var KEY = 'sb_publishable_xUnGxyLCc5TB5nv4keVQVw__grqGJkP';
  var MINE = '북서울';
  var MIN_POINTS = 4;          // 한 달에 스냅샷이 이 개수 미만이면 비교 기준월에서 제외
  var RANGE = 5;               // 속도계 눈금 범위 (± 영업일)
  var HOL = {};
  ['2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-01', '2026-03-02', '2026-05-05', '2026-05-08', '2026-06-06', '2026-08-15', '2026-08-17',
    '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27', '2026-10-03', '2026-10-05', '2026-10-09', '2026-12-25',
    '2027-01-01', '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09', '2027-03-01', '2027-05-05', '2027-05-13', '2027-06-06', '2027-08-15', '2027-08-16',
    '2027-09-14', '2027-09-15', '2027-09-16', '2027-10-03', '2027-10-04', '2027-10-09', '2027-10-11', '2027-12-25', '2027-12-27'
  ].forEach(function (d) { HOL[d] = 1; });

  var PROD = { '일반알람': ['일반알람'], '휴엔': ['휴엔'], '정보보안': ['디지털(정보보안)'], '디지털': ['디지털(정보보안)'], '알람+휴엔': ['일반알람', '휴엔'] };
  var PLANP = { '일반알람': ['알람'], '휴엔': ['휴엔'], '정보보안': ['정보보안'], '디지털': ['정보보안'], '알람+휴엔': ['알람', '휴엔'] };
  var METRICS = [
    { key: 'ord', label: '수주', act: '계약실적', tgt: '계약계획', good: 1, up: '빠름', down: '느림' },
    { key: 'start', label: '개시', act: '개시실적', tgt: '개시계획', good: 1, up: '빠름', down: '느림' },
    { key: 'cancel', label: '유지감소', act: '유지감소실적', tgt: '유지감소계획', good: -1, up: '적음', down: '많음' },
    { key: 'net', label: '유지증가', act: '유지증가실적', tgt: '유지증가계획', good: 1, up: '많음', down: '적음' }
  ];
  var cache = {};

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmt(v) { return String(Math.round(Number(v) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function pc(v, d) { return v == null || !isFinite(v) ? '–' : (v * 100).toFixed(d == null ? 1 : d) + '%'; }
  function sg(v, d) { return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d == null ? 1 : d); }
  function num(s) { if (s == null) return null; var t = String(s).replace(/[,\s%]/g, ''); if (t === '' || /[^0-9.\-]/.test(t)) return null; var n = parseFloat(t); return isFinite(n) ? n : null; }
  function get(path) {
    return fetch(BASE + path, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  // ---------- 영업일 ----------
  var bizCache = {};
  function biz(ym) {
    if (bizCache[ym]) return bizCache[ym];
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7), n = new Date(y, m, 0).getDate(), list = [];
    for (var d = 1; d <= n; d++) {
      var ds = ym + '-' + pad(d), dow = new Date(y, m - 1, d).getDay();
      if (dow !== 0 && dow !== 6 && !HOL[ds]) list.push(ds);
    }
    return (bizCache[ym] = { list: list, total: list.length });
  }
  function elapsed(ds) { var b = biz(ds.slice(0, 7)), n = 0; for (var i = 0; i < b.list.length; i++) if (b.list[i] <= ds) n++; return n; }
  function pOf(ds) { var t = biz(ds.slice(0, 7)).total; return t ? elapsed(ds) / t : 0; }
  function addM(ym, k) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) + k; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return y + '-' + pad(m); }

  // ---------- 스냅샷 정리 ----------
  // snaps[ym] = { ds: { branch: { metricKey: {a, t} } } }
  function build(rows, prods) {
    var byDate = {};
    rows.forEach(function (r) {
      var ds = String(r.report_date).slice(0, 10), brs = r.branches_json || [], lab = {};
      (r.rows_json || []).forEach(function (x) { lab[x.label] = x.values || []; });
      var d = byDate[ds] || (byDate[ds] = { n: 0, br: {} });
      d.n++;
      brs.forEach(function (b, i) {
        var o = d.br[b] || (d.br[b] = {});
        METRICS.forEach(function (m) {
          var a = lab[m.act] ? num(lab[m.act][i]) : null, t = lab[m.tgt] ? num(lab[m.tgt][i]) : null;
          var q = o[m.key] || (o[m.key] = { a: 0, t: 0, ok: true });
          if (a == null || t == null) q.ok = false; else { q.a += a; q.t += t; }
        });
      });
    });
    var snaps = {};
    Object.keys(byDate).sort().forEach(function (ds) {
      if (byDate[ds].n !== prods.length) return;           // 상품 전체가 있는 날만 사용
      (snaps[ds.slice(0, 7)] = snaps[ds.slice(0, 7)] || {})[ds] = byDate[ds].br;
    });
    return snaps;
  }
  // 한 달의 (지사, 지표) 시계열: [{p, a}] + 월 목표 t
  function series(snaps, ym, br, mk) {
    var mo = snaps[ym]; if (!mo) return null;
    var pts = [], t = null, byP = {};
    Object.keys(mo).sort().forEach(function (ds) {
      var q = mo[ds][br] && mo[ds][br][mk]; if (!q || !q.ok) return;
      var p = pOf(ds); byP[p] = { p: p, a: q.a, ds: ds }; t = q.t;
    });
    Object.keys(byP).forEach(function (k) { pts.push(byP[k]); });
    pts.sort(function (x, y) { return x.p - y.p; });
    return { pts: pts, t: t };
  }
  function valueAt(s, p) {
    var pts = s.pts; if (!pts.length) return null;
    if (p > pts[pts.length - 1].p + 0.04) return null;    // 그 시점까지 자료가 없으면 비교 불가
    var prev = { p: 0, a: 0 };
    for (var i = 0; i < pts.length; i++) {
      if (pts[i].p >= p - 1e-9) {
        if (pts[i].p - p < 1e-9) return pts[i].a;
        var w = (p - prev.p) / (pts[i].p - prev.p); return prev.a + (pts[i].a - prev.a) * w;
      }
      prev = pts[i];
    }
    return pts[pts.length - 1].a;
  }
  function rateAt(snaps, ym, br, mk, p) {
    var s = series(snaps, ym, br, mk); if (!s || !s.pts.length || !s.t || Math.abs(s.t) < 1) return null;
    var a = valueAt(s, p); return a == null ? null : a / s.t;
  }
  function mean(a) { if (!a.length) return null; var t = 0; a.forEach(function (x) { t += x; }); return t / a.length; }

  // ---------- 분석 ----------
  function analyze(snaps, plan, c, prods) {
    var ym = c.ym || (c.y + '-' + pad(c.m)), mo = snaps[ym];
    if (!mo) return { err: ym + ' 사업팀 일일 현황 스냅샷이 없습니다.' };
    var limit = c.isPastMonth ? '9999-12-31' : (c.todayDs || '9999-12-31');
    var dates = Object.keys(mo).filter(function (d) { return d <= limit; }).sort();
    if (!dates.length) return { err: ym + ' 사업팀 일일 현황 스냅샷이 아직 없습니다.' };
    var curDs = dates[dates.length - 1], p = pOf(curDs), tot = biz(ym).total, el = elapsed(curDs);
    // 기준월: 직전 3개월 중 월중 스냅샷이 충분한 달
    var base = [], skipped = [];
    for (var k = 1; k <= 3; k++) {
      var bm = addM(ym, -k), cnt = snaps[bm] ? Object.keys(snaps[bm]).length : 0;
      if (cnt >= MIN_POINTS) base.push(bm); else skipped.push({ ym: bm, cnt: cnt });
    }
    var brs = Object.keys(mo[curDs]);
    var out = { ym: ym, curDs: curDs, p: p, el: el, tot: tot, base: base.reverse(), skipped: skipped, peers: brs.length - 1, metrics: [], cat: c.cat };
    METRICS.forEach(function (m) {
      var q = mo[curDs][MINE] && mo[curDs][MINE][m.key];
      if (!q || !q.ok || !q.t || Math.abs(q.t) < 1) { out.metrics.push({ m: m, na: true }); return; }
      var rCur = q.a / q.t, res = { m: m, act: q.a, tgt: q.t, rCur: rCur };
      // 1) 내 최근 N개월 같은 영업일 시점 평균
      var mine = [];
      out.base.forEach(function (bm) { var r = rateAt(snaps, bm, MINE, m.key, p); if (r != null) mine.push({ ym: bm, r: r }); });
      res.mine = mine; res.rAvg = mean(mine.map(function (x) { return x.r; }));
      if (res.rAvg != null) { res.lead = (rCur - res.rAvg) * tot * m.good; res.diff = (rCur - res.rAvg); }
      // 2) 목표·계획 대비 진도
      res.paceT = p > 0 ? rCur / p : null;
      var pl = plan && plan[m.key];
      if (pl && Math.abs(pl) > 0) { res.plan = pl; res.rPlan = q.a / pl; res.paceP = p > 0 ? res.rPlan / p : null; }
      // 3) 타지사
      var peerAvg = [], peerCur = [], names = [];
      brs.forEach(function (b) {
        var x = mo[curDs][b] && mo[curDs][b][m.key]; if (!x || !x.ok || !x.t || Math.abs(x.t) < 1) return;
        peerCur.push({ b: b, r: x.a / x.t });
        if (b === MINE) return;
        var rs = []; out.base.forEach(function (bm) { var r = rateAt(snaps, bm, b, m.key, p); if (r != null) rs.push(r); });
        if (rs.length) { peerAvg.push(mean(rs)); names.push(b); }
      });
      if (peerAvg.length) {
        res.peer = { avg: mean(peerAvg), min: Math.min.apply(null, peerAvg), max: Math.max.apply(null, peerAvg), n: peerAvg.length };
        res.peer.gap = rCur - res.peer.avg;
      }
      var sorted = peerCur.slice().sort(function (x, y) { return m.good > 0 ? y.r - x.r : x.r - y.r; });
      res.rank = sorted.map(function (x) { return x.b; }).indexOf(MINE) + 1; res.rankN = sorted.length;
      var cu = peerCur.filter(function (x) { return x.b !== MINE; }).map(function (x) { return x.r; });
      res.peerCurAvg = mean(cu);
      out.metrics.push(res);
    });
    return out;
  }

  function load(c) {
    if (!c || !c.y || !c.m || c.isFutureMonth) return Promise.resolve(null);
    var cat = c.cat || '일반알람', prods = PROD[cat];
    if (!prods) return Promise.resolve({ unsupported: cat });
    var ym = c.ym || (c.y + '-' + pad(c.m)), ck = ym + '|' + cat + '|' + (c.todayDs || '');
    var hit = cache[ck]; if (hit && Date.now() - hit.t < 5 * 60 * 1000) return Promise.resolve(hit.d);
    var from = addM(ym, -3) + '-01', to = ym + '-31';
    var inList = '(' + prods.map(function (p) { return '"' + p + '"'; }).join(',') + ')';
    var q1 = 'biz_team_data?select=report_date,product_type,branches_json,rows_json&product_type=in.' + encodeURIComponent(inList) +
      '&report_date=gte.' + from + '&report_date=lte.' + to + '&order=report_date.asc&limit=2000';
    var q2 = 'sales_targets_product?select=*&year_month=eq.' + ym;
    return Promise.all([get(q1), get(q2)]).then(function (res) {
      var snaps = build(res[0] || [], prods), plan = null, pp = PLANP[cat] || [];
      var rows = (res[1] || []).filter(function (r) { return pp.indexOf(r.product_type) !== -1; });
      if (rows.length) {
        var s = function (k) { var t = 0; rows.forEach(function (r) { t += Number(r[k]) || 0; }); return t; };
        plan = { ord: s('plan_order'), start: s('plan_start'), cancel: s('plan_cancel') };
        plan.net = plan.start - plan.cancel;
      }
      var d = analyze(snaps, plan, c, prods); d.planYm = ym;
      cache[ck] = { t: Date.now(), d: d };
      return d;
    });
  }

  // ---------- 그리기 ----------
  function zones() {
    return [[-RANGE, -2.5, '#dc2626'], [-2.5, -0.5, '#f59e0b'], [-0.5, 0.5, '#94a3b8'], [0.5, 2.5, '#84cc16'], [2.5, RANGE, '#16a34a']];
  }
  var CX = 130, CY = 128, R0 = 100, TH = 20;
  function pt(v, r) { var th = Math.PI * (1 - (v + RANGE) / (2 * RANGE)); return [CX + r * Math.cos(th), CY - r * Math.sin(th)]; }
  function arc(v1, v2, r1, r2) {
    var a = pt(v1, r2), b = pt(v2, r2), c = pt(v2, r1), d = pt(v1, r1);
    return 'M' + a[0].toFixed(1) + ' ' + a[1].toFixed(1) + ' A' + r2 + ' ' + r2 + ' 0 0 1 ' + b[0].toFixed(1) + ' ' + b[1].toFixed(1) +
      ' L' + c[0].toFixed(1) + ' ' + c[1].toFixed(1) + ' A' + r1 + ' ' + r1 + ' 0 0 0 ' + d[0].toFixed(1) + ' ' + d[1].toFixed(1) + ' Z';
  }
  function verdict(res) {
    var m = res.m, v = res.lead;
    if (v == null) return { t: '비교 기준 없음', col: '#64748b' };
    var w = v > 0 ? m.up : m.down, a = Math.abs(v);
    if (a < 0.5) return { t: '3개월 평균 수준', col: '#64748b' };
    var strong = a >= 2.5 ? '크게 ' : '';
    return { t: '평균보다 ' + strong + w + (m.good === -1 ? (v > 0 ? ' (양호)' : ' (주의)') : (v > 0 ? '' : '')), col: v > 0 ? '#15803d' : (a >= 2.5 ? '#dc2626' : '#d97706') };
  }
  function gauge(res, idx) {
    var v = res.lead == null ? 0 : Math.max(-RANGE, Math.min(RANGE, res.lead));
    var s = '<svg viewBox="0 0 260 158" width="100%" style="max-width:290px;display:block;margin:0 auto;" role="img" aria-label="' + esc(res.m.label) + ' 속도계">';
    zones().forEach(function (z) { s += '<path d="' + arc(z[0], z[1], R0 - TH, R0) + '" fill="' + z[2] + '" opacity=".92"/>'; });
    for (var t = -RANGE; t <= RANGE; t++) {
      var a = pt(t, R0 + 3), b = pt(t, R0 + (t % 5 === 0 || t === 0 ? 10 : 7));
      s += '<line x1="' + a[0].toFixed(1) + '" y1="' + a[1].toFixed(1) + '" x2="' + b[0].toFixed(1) + '" y2="' + b[1].toFixed(1) + '" stroke="#475569" stroke-width="' + (t === 0 ? 2 : 1) + '"/>';
    }
    [[-RANGE, '−' + RANGE], [0, '0'], [RANGE, '+' + RANGE]].forEach(function (L) {
      var q = pt(L[0], R0 + 20); s += '<text x="' + q[0].toFixed(1) + '" y="' + (q[1] + 4).toFixed(1) + '" text-anchor="middle" font-size="10" fill="#475569">' + L[1] + '</text>';
    });
    var l1 = pt(-RANGE, R0 - TH - 8), l2 = pt(RANGE, R0 - TH - 8);
    s += '<text x="' + l1[0].toFixed(1) + '" y="' + (l1[1] + 16).toFixed(1) + '" text-anchor="middle" font-size="10" fill="#b91c1c" font-weight="700">' + esc(res.m.good > 0 ? '느림' : '많음') + '</text>';
    s += '<text x="' + l2[0].toFixed(1) + '" y="' + (l2[1] + 16).toFixed(1) + '" text-anchor="middle" font-size="10" fill="#15803d" font-weight="700">' + esc(res.m.good > 0 ? '빠름' : '적음') + '</text>';
    var deg = (v / RANGE) * 90;
    s += '<g class="sp-needle" data-deg="' + deg.toFixed(1) + '" style="transform-origin:' + CX + 'px ' + CY + 'px;transform:rotate(' + deg.toFixed(1) + 'deg);">' +
      '<polygon points="' + (CX - 4) + ',' + CY + ' ' + (CX + 4) + ',' + CY + ' ' + CX + ',' + (CY - (R0 - 6)) + '" fill="#0f172a"/></g>';
    s += '<circle cx="' + CX + '" cy="' + CY + '" r="9" fill="#0f172a"/><circle cx="' + CX + '" cy="' + CY + '" r="3.5" fill="#f8fafc"/>';
    s += '</svg>';
    return s;
  }
  function bar(label, fillRatio, markRatio, color, text, maxR) {
    maxR = maxR || 1.5;
    var f = Math.max(0, Math.min(1, fillRatio / maxR)) * 100, mk = markRatio == null ? null : Math.max(0, Math.min(1, markRatio / maxR)) * 100;
    return '<div style="margin-top:7px;"><div style="display:flex;justify-content:space-between;font-size:11.5px;color:#334155;margin-bottom:2px;"><b>' + esc(label) + '</b><span>' + text + '</span></div>' +
      '<div style="position:relative;height:10px;background:#e2e8f0;border-radius:5px;">' +
      '<div class="sp-fill" data-w="' + f.toFixed(1) + '" style="position:absolute;left:0;top:0;bottom:0;width:0;background:' + color + ';border-radius:5px;transition:width 1.1s cubic-bezier(.2,.8,.2,1);"></div>' +
      (mk == null ? '' : '<div title="영업일 진척" style="position:absolute;left:' + mk.toFixed(1) + '%;top:-3px;bottom:-3px;width:2px;background:#0f172a;"></div>') +
      '</div></div>';
  }
  function peerBar(res) {
    var pe = res.peer; if (!pe) return '';
    var mx = Math.max(pe.max, res.rCur, res.rAvg || 0, 0.3) * 1.15, mn = Math.min(0, pe.min, res.rCur);
    var span = mx - mn, X = function (v) { return Math.max(0, Math.min(100, (v - mn) / span * 100)); };
    var better = res.m.good > 0 ? res.rCur >= pe.avg : res.rCur <= pe.avg;
    var col = better ? '#16a34a' : '#dc2626';
    return '<div style="margin-top:9px;"><div style="display:flex;justify-content:space-between;font-size:11.5px;color:#334155;margin-bottom:2px;"><b>타지사 ' + pe.n + '곳 3개월 평균 대비</b><span style="color:' + col + ';font-weight:700;">' + sg(res.peer.gap * 100) + '%p</span></div>' +
      '<div style="position:relative;height:14px;background:#f1f5f9;border-radius:7px;">' +
      '<div title="타지사 최소~최대" style="position:absolute;left:' + X(pe.min).toFixed(1) + '%;width:' + Math.max(1, X(pe.max) - X(pe.min)).toFixed(1) + '%;top:3px;bottom:3px;background:#cbd5e1;border-radius:4px;"></div>' +
      '<div title="타지사 평균" style="position:absolute;left:' + X(pe.avg).toFixed(1) + '%;top:0;bottom:0;width:2px;background:#475569;"></div>' +
      '<div class="sp-dot" data-l="' + X(res.rCur).toFixed(1) + '" title="북서울 현재" style="position:absolute;left:0;top:1px;width:12px;height:12px;margin-left:-6px;border-radius:50%;background:' + col + ';border:2px solid #fff;box-shadow:0 0 0 1px ' + col + ';transition:left 1.1s cubic-bezier(.2,.8,.2,1);"></div>' +
      '</div><div style="font-size:10.5px;color:#64748b;margin-top:2px;">타지사 ' + pc(pe.min) + ' ~ ' + pc(pe.max) + ' (평균 ' + pc(pe.avg) + ') · 북서울 현재 ' + pc(res.rCur) + ' · 이번 달 순위 ' + res.rank + '/' + res.rankN + '</div></div>';
  }
  function paceColor(ratio, good) { if (ratio == null) return '#94a3b8'; var ok = good > 0 ? ratio >= 1 : ratio <= 1; var near = good > 0 ? ratio >= 0.85 : ratio <= 1.15; return ok ? '#16a34a' : (near ? '#f59e0b' : '#dc2626'); }
  function card(res, i) {
    var m = res.m;
    if (res.na) return '<div class="sp-card"><b>' + esc(m.label) + '</b><div style="font-size:12px;color:#64748b;margin-top:6px;">목표 또는 실적 데이터가 없어 계산하지 못했습니다.</div></div>';
    var early = res.p__ != null && res.p__ < 0.15;
    var vd = verdict(res), leadTxt = res.lead == null ? '–' : sg(res.lead) + '영업일';
    var h = '<div class="sp-card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;"><b style="font-size:15px;color:#0f172a;">' + esc(m.label) + '</b>' +
      '<span style="font-size:11.5px;font-weight:700;color:#fff;background:' + (early ? '#94a3b8' : vd.col) + ';padding:2px 8px;border-radius:10px;">' + esc(early ? '월초 참고' : vd.t) + '</span></div>';
    h += '<div style="' + (early ? 'opacity:.5;' : '') + '">' + gauge(res, i) + '</div>';
    h += '<div style="text-align:center;margin-top:-4px;"><div class="sp-num" data-v="' + (res.lead == null ? '' : res.lead.toFixed(2)) + '" style="font-size:24px;font-weight:800;color:' + vd.col + ';">' + leadTxt + '</div>' +
      '<div style="font-size:11px;color:#64748b;">같은 영업일 3개월 평균 대비 (달성률 ' + pc(res.rCur) + ' vs 평균 ' + pc(res.rAvg) + ')</div></div>';
    var tl = m.good < 0 ? '목표 소진 속도' : '목표 대비 진도';
    h += bar(tl, res.rCur, res.paceT != null ? res.p : null, paceColor(res.paceT, m.good), '달성 ' + pc(res.rCur) + ' / 진척 ' + pc(res.p__) + ' → ' + (res.paceT == null ? '–' : '<b>' + Math.round(res.paceT * 100) + '%</b>'));
    if (res.rPlan != null) h += bar(m.good < 0 ? '계획 소진 속도' : '계획 대비 진도', res.rPlan, res.p__, paceColor(res.paceP, m.good), '달성 ' + pc(res.rPlan) + ' → <b>' + (res.paceP == null ? '–' : Math.round(res.paceP * 100) + '%') + '</b>');
    else h += '<div style="margin-top:7px;font-size:11px;color:#94a3b8;">계획 대비: 이번 달 지사 계획 미입력</div>';
    h += peerBar(res);
    h += '<div style="margin-top:6px;font-size:10.5px;color:#64748b;">실적 ' + fmt(res.act) + ' / 목표 ' + fmt(res.tgt) + ' (천원)' + (res.plan ? ' · 계획 ' + fmt(res.plan) : '') + '</div></div>';
    return h;
  }
  function cardHtml(d, c) {
    if (!d) return '<div style="font-size:12px;color:#64748b;">속도계를 계산하지 못했습니다.</div>';
    if (d.unsupported) return '<div style="font-size:12px;color:#64748b;">' + esc(d.unsupported) + ' 구분은 속도계 대상이 아닙니다. (일반알람·휴엔·정보보안·알람+휴엔)</div>';
    if (d.err) return '<div style="font-size:12px;color:#64748b;">' + esc(d.err) + '</div>';
    d.metrics.forEach(function (r) { r.p__ = d.p; r.p = d.p; });
    var baseTxt = d.base.length ? d.base.map(function (b) { return +b.slice(5) + '월'; }).join('·') + ' (' + d.base.length + '개월)' : '없음';
    var h = '<div style="display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;margin-bottom:8px;font-size:12px;color:#334155;">' +
      '<span><b>' + d.curDs + '</b> 기준 · 영업일 <b>' + d.el + '/' + d.tot + '일 (' + pc(d.p, 0) + ')</b></span>' +
      '<span>비교 기준월: <b>' + esc(baseTxt) + '</b></span>' +
      '<span style="color:#64748b;">바늘이 오른쪽일수록 3개월 평균보다 좋은 방향(수주·개시·유지증가는 빠름·많음, 유지감소는 적음)</span></div>';
    if (!d.base.length) { h += '<div style="padding:10px;background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;font-size:12px;color:#9a3412;">비교할 과거 월의 월중 스냅샷(월 ' + MIN_POINTS + '건 이상)이 없어 속도계를 그릴 수 없습니다.</div>'; return h; }
    h += '<div class="sp-grid">' + d.metrics.map(card).join('') + '</div>';
    // 요약표
    h += '<div style="overflow-x:auto;margin-top:10px;"><table class="sp-tbl"><thead><tr><th>지표</th><th>3개월 평균 대비</th><th>목표 진도</th><th>계획 진도</th><th>타지사 3개월 평균 대비</th><th>이번 달 타지사 순위</th></tr></thead><tbody>';
    d.metrics.forEach(function (r) {
      if (r.na) return;
      h += '<tr><td><b>' + esc(r.m.label) + '</b></td><td>' + (r.lead == null ? '–' : sg(r.lead) + '영업일') + '</td><td>' + (r.paceT == null ? '–' : Math.round(r.paceT * 100) + '%') + '</td><td>' +
        (r.paceP == null ? '–' : Math.round(r.paceP * 100) + '%') + '</td><td>' + (r.peer ? sg(r.peer.gap * 100) + '%p' : '–') + '</td><td>' + r.rank + ' / ' + r.rankN + '위</td></tr>';
    });
    h += '</tbody></table></div>';
    var notes = ['진도 = 달성률 ÷ 영업일 진척률 (100% = 목표·계획 페이스, 유지감소는 100% 이하가 양호)'];
    if (d.skipped.length) notes.push(d.skipped.map(function (s) { return +s.ym.slice(5) + '월'; }).join('·') + '은 월중 스냅샷 ' + MIN_POINTS + '건 미만(' + d.skipped.map(function (s) { return s.cnt + '건'; }).join('·') + ')이라 비교에서 제외');
    if (d.p < 0.15) notes.push('월초(영업일 진척 ' + pc(d.p, 0) + ')라 하루 실적에도 수치가 크게 움직여 해석에 주의');
    notes.push('출처: 사업팀 지사별 일일 현황(타지사 15곳 동일 기준), 계획=지사 계획(sales_targets_product) · 금액 천원');
    h += '<div style="margin-top:6px;font-size:10.5px;color:#64748b;line-height:1.6;">' + notes.map(esc).join('<br>') + '</div>';
    return h;
  }

  // ---------- 화면 슬롯 / 애니메이션 ----------
  function animate(slot) {
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var needles = slot.querySelectorAll('.sp-needle'), fills = slot.querySelectorAll('.sp-fill'), dots = slot.querySelectorAll('.sp-dot'), nums = slot.querySelectorAll('.sp-num');
    if (reduce) { fills.forEach(function (f) { f.style.width = f.dataset.w + '%'; }); dots.forEach(function (d) { d.style.left = d.dataset.l + '%'; }); return; }
    needles.forEach(function (n) { n.style.transition = 'none'; n.style.transform = 'rotate(-90deg)'; });
    fills.forEach(function (f) { f.style.transition = 'none'; f.style.width = '0'; });
    dots.forEach(function (d) { d.style.transition = 'none'; d.style.left = '0%'; });
    void slot.offsetWidth;
    requestAnimationFrame(function () {
      needles.forEach(function (n, i) { n.style.transition = 'transform 1.6s cubic-bezier(.2,1.35,.35,1) ' + (i * 120) + 'ms'; n.style.transform = 'rotate(' + n.dataset.deg + 'deg)'; });
      fills.forEach(function (f) { f.style.transition = 'width 1.1s cubic-bezier(.2,.8,.2,1) 250ms'; f.style.width = f.dataset.w + '%'; });
      dots.forEach(function (d) { d.style.transition = 'left 1.1s cubic-bezier(.2,.8,.2,1) 250ms'; d.style.left = d.dataset.l + '%'; });
    });
    nums.forEach(function (el, i) {
      var v = parseFloat(el.dataset.v); if (isNaN(v)) return;
      var t0 = null, dur = 1300, delay = i * 120;
      function step(ts) {
        if (t0 == null) t0 = ts + delay; if (ts < t0) { requestAnimationFrame(step); return; }
        var k = Math.min(1, (ts - t0) / dur), e = 1 - Math.pow(1 - k, 3), cur = v * e;
        el.textContent = sg(cur) + '영업일'; if (k < 1) requestAnimationFrame(step); else el.textContent = sg(v) + '영업일';
      }
      requestAnimationFrame(step);
    });
  }
  var io = (typeof IntersectionObserver !== 'undefined') ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { animate(e.target); io.unobserve(e.target); } });
  }, { threshold: 0.2 }) : null;

  function fill(slot) {
    slot.dataset.sp = '1';
    var c = window.DASH_REPORT_CTX_;
    if (!c) { slot.innerHTML = ''; return; }
    slot.innerHTML = '<div style="font-size:12px;color:#64748b;">영업 속도계를 계산하는 중…</div>';
    load(c).then(function (d) {
      if (!document.body.contains(slot)) return;
      slot.innerHTML = cardHtml(d, c);
      if (io) io.observe(slot); else animate(slot);
    }).catch(function (e) {
      console.warn('속도계 실패', e);
      if (document.body.contains(slot)) slot.innerHTML = '<div style="font-size:12px;color:#64748b;">영업 속도계를 불러오지 못했습니다. (' + esc(e && e.message) + ')</div>';
    });
  }
  var css = document.createElement('style');
  css.textContent = '.sp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:12px;}' +
    '.sp-card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;min-width:0;}' +
    '.sp-tbl{border-collapse:collapse;font-size:12px;width:100%;}.sp-tbl th,.sp-tbl td{border:1px solid #cbd5e1;padding:4px 8px;text-align:center;white-space:nowrap;}.sp-tbl th{background:#f1f5f9;}';
  document.head.appendChild(css);
  window.speedo_ = { load: load, cardHtml: cardHtml };

  var pending = false;
  function scan() {
    pending = false;
    var s = document.querySelectorAll('.sp-slot');
    for (var i = 0; i < s.length; i++) if (!s[i].dataset.sp) fill(s[i]);
  }
  new MutationObserver(function () { if (!pending) { pending = true; requestAnimationFrame(scan); } })
    .observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(scan, 0);
})();
