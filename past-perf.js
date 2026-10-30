/**
 * 북서울지사 영업일보 포털 - 「과거실적」 화면 (Admin.html / User.html 공용)
 *
 *  - 종합대시보드의 [사업팀] 버튼 왼쪽 [과거실적] 버튼 -> dashShowPastPerfView_() 로 종합대시보드 내부 화면 전환.
 *  - 데이터: Supabase 테이블 public.seoul_perf_history
 *      (서울사업팀 누계 실적 현황 엑셀의 23~25년 시트에서 일반·휴엔·디지털·안전상품만 적재, 목표/실적, month=0 은 연간 누계)
 *  - 필터: 연도 / 월(1~12, 연간 누계) / 상품 / 지표, 보기(대시보드 | 원본 표), 전년동기 비교
 *  - 달성률 = 실적/목표. 유지감소만 원본 확인 3개 셀 기준 2 - 실적/목표 추정식.
 */
(function () {
  'use strict';
  if (window.__ppLoaded) return;
  window.__ppLoaded = true;

  var SUPABASE_URL = 'https://gpqlximhoqdybcewdfde.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_xUnGxyLCc5TB5nv4keVQVw__grqGJkP';
  var TABLE = 'seoul_perf_history';
  var BR = ['강남광역','강북광역','서초','구로','강서','영등포','남양주','송파','제주','서울동부','강동','서강','성북','동서울','서서울','북서울','서울사업팀'];
  var TEAM = 16, MINE = '북서울';
  var PRODS = { '일반': ['계약','개시','유지감소','유지증가'], '휴엔': ['계약','개시','유지감소','유지증가'], '디지털': ['계약','개시','유지감소','유지증가'], '안전상품': ['수주','매출','손익'] };
  var YEARS = [2023, 2024, 2025];

  var S = { v: 'd', y: 2025, m: 0, p: '일반', k: '계약', br: TEAM, cmp: false, sort: 'rate', dir: -1 };
  var DATA = null, LOADING = false, ERR = '';
  var client = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(v) { if (v == null) return '–'; if (v === 0) return '0'; var a = Math.abs(v); return a >= 1000 ? Math.round(v).toLocaleString('ko-KR') : a >= 100 ? v.toFixed(0) : v.toFixed(1); }
  function pct(v) { return v == null ? '–' : (v * 100).toFixed(1) + '%'; }
  function sgn(v) { return v >= 0 ? '+' : ''; }
  function idx(m) { return m === 0 ? 12 : m - 1; }
  function get(y, p, k) { return DATA && DATA[y] && DATA[y][p] && DATA[y][p][k]; }
  function rate(k, t, a) { if (t == null || a == null || t <= 0) return null; return k === '유지감소' ? 2 - a / t : a / t; }
  function col(r) { return r == null ? '#64748b' : r >= 1 ? '#15803d' : r >= 0.9 ? '#b45309' : '#dc2626'; }

  function getClient() {
    if (client) return client;
    if (!window.supabase || !window.supabase.createClient) throw new Error('Supabase 라이브러리를 불러오지 못했습니다.');
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    return client;
  }

  function emptyGrid() { var g = []; for (var i = 0; i < 17; i++) g.push(new Array(13).fill(null)); return g; }

  function load() {
    if (DATA || LOADING) return;
    LOADING = true; ERR = '';
    var c;
    try { c = getClient(); } catch (e) { ERR = e.message; LOADING = false; render(); return; }
    var PAGE = 1000, all = [];
    function page(from) {
      return c.from(TABLE).select('year,month,product,metric,branch,target,actual').order('id', { ascending: true }).range(from, from + PAGE - 1).then(function (r) {
        if (r.error) throw new Error(r.error.message);
        all = all.concat(r.data || []);
        if ((r.data || []).length === PAGE) return page(from + PAGE);
      });
    }
    page(0).then(function () {
      if (!all.length) throw new Error('과거실적 데이터가 없습니다. (조회 권한 또는 적재 여부를 확인하세요)');
      var D = {};
      all.forEach(function (r) {
        var b = BR.indexOf(r.branch); if (b < 0) return;
        var mi = idx(r.month);
        var y = D[r.year] = D[r.year] || {}, p = y[r.product] = y[r.product] || {}, k = p[r.metric] = p[r.metric] || { t: emptyGrid(), a: emptyGrid() };
        k.t[b][mi] = r.target == null ? null : Number(r.target);
        k.a[b][mi] = r.actual == null ? null : Number(r.actual);
      });
      DATA = D; LOADING = false; render();
    }).catch(function (e) { ERR = e.message || String(e); LOADING = false; render(); });
  }

  function btn(label, on, active, extra) {
    return '<button type="button" onclick="' + on + '" style="font-size:12.5px; padding:4px 11px; border-radius:5px; cursor:pointer; border:1px solid ' + (active ? '#1e3a8a' : '#cbd5e1') + '; background:' + (active ? '#1e3a8a' : '#fff') + '; color:' + (active ? '#fff' : '#1e293b') + '; font-weight:' + (active ? 700 : 500) + ';' + (extra || '') + '">' + esc(label) + '</button>';
  }
  function row(label, inner) { return '<div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-bottom:6px;"><span style="width:40px; font-size:12px; color:#64748b; font-weight:700;">' + label + '</span>' + inner + '</div>'; }

  function chartHtml(d, pa) {
    var b = S.br, t = d.t[b].slice(0, 12), a = d.a[b].slice(0, 12);
    var W = 800, H = 250, L = 52, R = 8, Tp = 10, Bt = 26, w = W - L - R, h = H - Tp - Bt;
    var vals = t.concat(a, pa || []).filter(function (v) { return v != null; });
    var mx = Math.max.apply(null, [0].concat(vals)), mn = Math.min.apply(null, [0].concat(vals)); if (mx === mn) mx = 1;
    function nice(x) { var e = Math.pow(10, Math.floor(Math.log10(x))), f = x / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e; }
    var top = nice(mx), bot = mn < 0 ? -nice(-mn) : 0;
    function y(v) { return Tp + h - (v - bot) / (top - bot) * h; }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%; height:auto; display:block;">';
    for (var g = 0; g <= 4; g++) { var v = bot + (top - bot) * g / 4, yy = y(v); s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '" stroke="#e2e8f0"/><text x="' + (L - 6) + '" y="' + (yy + 4) + '" text-anchor="end" font-size="11" fill="#64748b">' + fmt(v) + '</text>'; }
    var bw = w / 12;
    for (var m = 0; m < 12; m++) {
      var x = L + m * bw, sel = S.m === m + 1;
      if (sel) s += '<rect x="' + x + '" y="' + Tp + '" width="' + bw + '" height="' + h + '" fill="#dbeafe"/>';
      if (a[m] != null) { var y0 = y(0), y1 = y(a[m]); s += '<rect x="' + (x + bw * 0.2) + '" y="' + Math.min(y0, y1) + '" width="' + (bw * 0.6) + '" height="' + Math.abs(y0 - y1) + '" fill="#1e3a8a" opacity="' + (S.m && !sel ? 0.55 : 1) + '" rx="2"><title>' + S.y + '년 ' + (m + 1) + '월 실적 ' + fmt(a[m]) + '</title></rect>'; }
      if (t[m] != null) s += '<line x1="' + (x + bw * 0.1) + '" x2="' + (x + bw * 0.9) + '" y1="' + y(t[m]) + '" y2="' + y(t[m]) + '" stroke="#94a3b8" stroke-width="3" stroke-linecap="round"><title>' + (m + 1) + '월 목표 ' + fmt(t[m]) + '</title></line>';
      s += '<text x="' + (x + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" fill="#64748b">' + (m + 1) + '월</text>';
      s += '<rect x="' + x + '" y="' + Tp + '" width="' + bw + '" height="' + h + '" fill="transparent" style="cursor:pointer" onclick="__pp.set(\'m\',' + (m + 1) + ')"/>';
    }
    s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="#64748b" stroke-width=".8"/>';
    if (pa) {
      var pts = [];
      pa.forEach(function (v, m) { if (v != null) pts.push([L + m * bw + bw / 2, y(v), m, v]); });
      s += '<polyline points="' + pts.map(function (p) { return p[0] + ',' + p[1]; }).join(' ') + '" fill="none" stroke="#d97706" stroke-width="2" stroke-dasharray="5 3"/>';
      pts.forEach(function (p) { s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3.5" fill="#d97706"><title>' + (S.y - 1) + '년 ' + (p[2] + 1) + '월 실적 ' + fmt(p[3]) + '</title></circle>'; });
    }
    return s + '</svg>';
  }

  function dashboardBody() {
    var d = get(S.y, S.p, S.k); if (!d) return '<div class="denied">해당 조건의 데이터가 없습니다.</div>';
    var i = idx(S.m), per = S.m === 0 ? S.y + '년 연간 누계' : S.y + '년 ' + S.m + '월';
    var T = d.t[TEAM][i], A = d.a[TEAM][i], R = rate(S.k, T, A);
    var prev = S.y > 2023 ? get(S.y - 1, S.p, S.k) : null;
    var pd = prev ? prev.a[TEAM][i] : null;
    var yoy = (pd != null && pd !== 0 && A != null) ? A / pd - 1 : null;
    var card = function (k, v, n, c) { return '<div style="flex:1 1 190px; min-width:170px; background:#fff; border:1px solid #cbd5e1; border-radius:8px; padding:10px 14px;"><div style="font-size:12px; color:#64748b;">' + k + '</div><div style="font-size:24px; font-weight:800; color:' + (c || '#0f172a') + '; font-variant-numeric:tabular-nums;">' + v + '</div><div style="font-size:11.5px; color:#64748b;">' + n + '</div></div>'; };
    var h = '<div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px;">' +
      card(esc(S.p + ' ' + S.k) + ' 목표', fmt(T), '서울사업팀 · ' + per + (S.cmp && prev ? ' · 전년 ' + fmt(prev.t[TEAM][i]) : '')) +
      card(esc(S.p + ' ' + S.k) + ' 실적', fmt(A), '서울사업팀 · ' + per + (S.cmp && prev ? ' · 전년 ' + fmt(pd) : '')) +
      card('달성률' + (S.k === '유지감소' ? ' (추정식)' : ''), pct(R), T != null && A != null ? '목표 대비 ' + sgn(A - T) + fmt(A - T) : '목표 없음', col(R)) +
      card('전년 동기 대비 실적', yoy == null ? '–' : sgn(yoy) + (yoy * 100).toFixed(1) + '%', pd == null ? (S.y === 2023 ? '2022년 데이터 없음' : '전년 실적 없음') : (S.y - 1) + '년 ' + fmt(pd), yoy == null ? '' : yoy >= 0 ? '#15803d' : '#dc2626') + '</div>';

    var pa = (S.cmp && prev) ? prev.a[S.br].slice(0, 12) : null;
    h += '<div class="dash-section"><div class="dash-section-title"><span>' + esc(BR[S.br]) + ' · ' + esc(S.p + ' ' + S.k) + ' 월별 추이 (' + S.y + '년)</span><span style="font-size:12px; color:#64748b; font-weight:normal;">' +
      '<b style="color:#1e3a8a">■</b> 실적 &nbsp;<b style="color:#94a3b8">━</b> 목표' + (pa ? ' &nbsp;<b style="color:#d97706">●</b> 전년 실적' : '') + ' · 월을 누르면 해당 월로 이동</span></div>' + chartHtml(d, pa) + '</div>';

    var rows = BR.map(function (n, b) {
      var t = d.t[b][i], a = d.a[b][i], pv = prev ? prev.a[b][i] : null;
      return { b: b, n: n, t: t, a: a, r: rate(S.k, t, a), py: pv, df: (a != null && pv != null) ? a - pv : null, y: (pv != null && pv !== 0 && a != null) ? a / pv - 1 : null };
    });
    var br = rows.slice(0, TEAM);
    var rk = br.filter(function (x) { return x.r != null; }).sort(function (x, y) { return y.r - x.r; });
    rk.forEach(function (x, j) { x.rank = j + 1; });
    var sortKey = S.sort; if (!S.cmp && (sortKey === 'py' || sortKey === 'df')) { sortKey = S.sort = 'rate'; S.dir = -1; }
    var kf = { n: 'n', t: 't', a: 'a', rate: 'r', py: 'py', df: 'df', yoy: 'y' }[sortKey];
    br.sort(function (x, y) { var p = x[kf], q = y[kf]; if (p == null && q == null) return 0; if (p == null) return 1; if (q == null) return -1; return (p > q ? 1 : p < q ? -1 : 0) * S.dir; });
    var cols = [['n', '지사'], ['t', '목표'], ['a', '실적'], ['rate', '달성률']].concat(S.cmp && prev ? [['py', (S.y - 1) + '년 실적'], ['df', '증감']] : [], [['yoy', '전년 동기 대비']]);
    var th = 'padding:6px 8px; border-bottom:1px solid #cbd5e1; background:#f1f5f9; font-size:12px; color:#475569; white-space:nowrap; cursor:pointer;';
    var tb = '<table style="border-collapse:collapse; width:100%; min-width:640px; font-variant-numeric:tabular-nums;"><thead><tr>' + cols.map(function (c) {
      return '<th style="' + th + 'text-align:' + (c[0] === 'n' ? 'left' : 'right') + ';" onclick="__pp.sort(\'' + c[0] + '\')">' + c[1] + (sortKey === c[0] ? (S.dir < 0 ? ' ▼' : ' ▲') : '') + '</th>';
    }).join('') + '</tr></thead><tbody>';
    var td = 'padding:6px 8px; border-bottom:1px solid #e2e8f0; text-align:right; white-space:nowrap;';
    function line(x, tot) {
      var bg = tot ? '#eef2ff' : x.n === MINE ? '#fef9c3' : (S.br === x.b ? '#dbeafe' : '');
      var rb = '<div style="display:inline-block; width:80px; height:7px; background:#e2e8f0; border-radius:4px; overflow:hidden; vertical-align:middle; margin-right:8px;"><b style="display:block; height:100%; width:' + (x.r == null ? 0 : Math.min(x.r, 1.5) / 1.5 * 100) + '%; background:' + col(x.r) + ';"></b></div>';
      return '<tr style="cursor:pointer;' + (bg ? 'background:' + bg + ';' : '') + (tot ? 'font-weight:800;' : '') + '" onclick="__pp.set(\'br\',' + x.b + ')"><td style="' + td + 'text-align:left;">' + esc(x.n) + (!tot && x.rank ? '<span style="color:#94a3b8; font-size:11px; margin-left:6px;">' + x.rank + '위</span>' : '') + '</td><td style="' + td + '">' + fmt(x.t) + '</td><td style="' + td + '">' + fmt(x.a) + '</td>' +
        '<td style="' + td + '">' + rb + '<span style="color:' + col(x.r) + '; display:inline-block; min-width:52px;">' + pct(x.r) + '</span></td>' +
        (S.cmp && prev ? '<td style="' + td + '">' + fmt(x.py) + '</td><td style="' + td + 'color:' + (x.df == null ? '#64748b' : x.df >= 0 ? '#15803d' : '#dc2626') + ';">' + (x.df == null ? '–' : sgn(x.df) + fmt(x.df)) + '</td>' : '') +
        '<td style="' + td + 'color:' + (x.y == null ? '#64748b' : x.y >= 0 ? '#15803d' : '#dc2626') + ';">' + (x.y == null ? '–' : sgn(x.y) + (x.y * 100).toFixed(1) + '%') + '</td></tr>';
    }
    tb += line(rows[TEAM], true) + br.map(function (x) { return line(x, false); }).join('') + '</tbody></table>';
    return h + '<div class="dash-section" style="margin-top:12px;"><div class="dash-section-title"><span>지사별 현황 · ' + esc(S.p + ' ' + S.k) + ' · ' + per + '</span><span style="font-size:12px; color:#64748b; font-weight:normal;">행을 누르면 위 차트가 해당 지사로 바뀝니다 · 북서울 노란색 표시</span></div><div style="overflow-x:auto;">' + tb + '</div></div>';
  }

  function rawBody() {
    var i = idx(S.m), per = S.m === 0 ? S.y + '년 연간 누계' : S.y + '년 ' + S.m + '월', ks = PRODS[S.p], cmp = S.cmp && S.y > 2023;
    var th = 'padding:6px 8px; border-bottom:1px solid #cbd5e1; background:#f1f5f9; font-size:12px; color:#475569; white-space:nowrap; text-align:right;';
    var td = 'padding:6px 8px; border-bottom:1px solid #e2e8f0; text-align:right; white-space:nowrap;';
    var bl = 'border-left:1px solid #cbd5e1;';
    var h = '<table style="border-collapse:collapse; width:100%; min-width:' + (ks.length * (cmp ? 400 : 260) + 90) + 'px; font-variant-numeric:tabular-nums;"><thead><tr><th rowspan="2" style="' + th + 'text-align:left;">지사</th>' +
      ks.map(function (k) { return '<th colspan="' + (cmp ? 5 : 3) + '" style="' + th + 'text-align:center;' + bl + '">' + esc(k) + '</th>'; }).join('') + '</tr><tr>' +
      ks.map(function () { return ['목표', '실적', '달성률'].concat(cmp ? [(S.y - 1) + '년 실적', '증감률'] : []).map(function (l, j) { return '<th style="' + th + (j === 0 ? bl : '') + '">' + l + '</th>'; }).join(''); }).join('') + '</tr></thead><tbody>';
    BR.forEach(function (n, b) {
      var tot = b === TEAM;
      h += '<tr style="' + (tot ? 'font-weight:800; background:#eef2ff;' : n === MINE ? 'background:#fef9c3;' : '') + '"><td style="' + td + 'text-align:left;">' + esc(n) + '</td>' + ks.map(function (k) {
        var d = get(S.y, S.p, k); if (!d) return '<td colspan="' + (cmp ? 5 : 3) + '" style="' + td + bl + '">–</td>';
        var t = d.t[b][i], a = d.a[b][i], r = rate(k, t, a);
        var s = '<td style="' + td + bl + '">' + fmt(t) + '</td><td style="' + td + '">' + fmt(a) + '</td><td style="' + td + 'color:' + col(r) + ';">' + pct(r) + '</td>';
        if (cmp) {
          var pd = get(S.y - 1, S.p, k), pv = pd ? pd.a[b][i] : null, g = (pv && a != null) ? a / pv - 1 : null;
          s += '<td style="' + td + '">' + fmt(pv) + '</td><td style="' + td + 'color:' + (g == null ? '#64748b' : g >= 0 ? '#15803d' : '#dc2626') + ';">' + (g == null ? '–' : sgn(g) + (g * 100).toFixed(1) + '%') + '</td>';
        }
        return s;
      }).join('') + '</tr>';
    });
    return '<div class="dash-section"><div class="dash-section-title"><span>' + esc(S.p) + ' · ' + per + ' 지사별 목표·실적 (원본 표)</span><span style="font-size:12px; color:#64748b; font-weight:normal;">원본 엑셀과 같은 지사 순서</span></div><div style="overflow-x:auto;">' + h + '</tbody></table></div></div>';
  }

  function render() {
    var contentEl = document.getElementById('content'); if (!contentEl) return;
    if (typeof DASH_VIEW_ !== 'undefined' && DASH_VIEW_ !== 'past_perf') return;
    var cmpOk = S.y > 2023;
    var head = '<div class="dash-head"><button onclick="dashShowMainView_()" style="margin-right:10px;">◀ 종합대시보드</button><h2>과거실적</h2>' +
      '<span style="font-size:12px; color:#64748b;">서울사업팀 16개 지사 · 2023~2025년 · 출처 서울사업팀 누계 실적 현황(20261028) · 단위는 원본에 표기 없음</span></div>';
    var body;
    if (ERR) body = '<div class="denied">' + esc(ERR) + '</div>';
    else if (!DATA) { body = '<div style="padding:40px; text-align:center; color:#64748b;">과거실적 데이터를 불러오는 중입니다...</div>'; load(); }
    else {
      if (!PRODS[S.p].includes(S.k)) S.k = PRODS[S.p][0];
      var f = row('보기', btn('대시보드', "__pp.set('v','d')", S.v === 'd') + btn('원본 표', "__pp.set('v','r')", S.v === 'r') + '<span style="width:10px;"></span>' +
        (cmpOk ? btn('전년동기 비교', '__pp.toggleCmp()', S.cmp) : '<button type="button" disabled title="2022년 데이터가 없어 2023년은 비교할 수 없습니다" style="font-size:12.5px; padding:4px 11px; border-radius:5px; border:1px solid #e2e8f0; background:#f8fafc; color:#94a3b8;">전년동기 비교</button>')) +
        row('연도', YEARS.map(function (y) { return btn(y + '년', "__pp.set('y'," + y + ')', S.y === y); }).join('')) +
        row('기간', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (m) { return btn(m + '월', "__pp.set('m'," + m + ')', S.m === m); }).join('') + btn('연간 누계', "__pp.set('m',0)", S.m === 0)) +
        row('상품', Object.keys(PRODS).map(function (p) { return btn(p, "__pp.set('p','" + p + "')", S.p === p); }).join('')) +
        (S.v === 'd' ? row('지표', PRODS[S.p].map(function (k) { return btn(k, "__pp.set('k','" + k + "')", S.k === k); }).join('')) : '');
      var foot = '<div style="font-size:12px; color:#64748b; margin-top:10px; line-height:1.6;">달성률 = 실적 ÷ 목표 (목표가 없거나 0 이하이면 –). 유지감소 달성률은 2 − 실적/목표 추정식이며 전체 셀 검증은 하지 않았습니다.<br>안전상품 매출 목표는 원본이 비어 있어 수주 목표와 동일하게 적재한 값입니다. 금액·건수 단위는 원본에 표기가 없어 확인되지 않았습니다.</div>';
      body = '<div style="background:#fff; border:1px solid #cbd5e1; border-radius:8px; padding:10px 14px; margin-bottom:12px;">' + f + '</div>' + (S.v === 'r' ? rawBody() : dashboardBody()) + foot;
    }
    contentEl.innerHTML = '<div class="dash-wrap dashboard-view">' + head + '<div class="dash-scroll">' + body + '</div></div>';
  }

  window.__pp = {
    set: function (k, v) { S[k] = v; if (k === 'y' && v === 2023) S.cmp = false; render(); },
    toggleCmp: function () { S.cmp = !S.cmp; render(); },
    sort: function (k) { if (S.sort === k) S.dir *= -1; else { S.sort = k; S.dir = k === 'n' ? 1 : -1; } render(); }
  };

  /* ===================== 영업현황 화면 - 전년동기 비교 =====================
   * 영업현황(sales_status) 탭의 [전년동기 비교] 버튼. 선택한 년월(statusYearMonth)의 북서울지사 실적을
   * 전년 같은 월(seoul_perf_history, 북서울 행)과 비교한다.
   *  - 상품 매핑: 일반알람=일반 / 알람+휴엔=일반+휴엔 합산 / 정보보안=디지털
   *  - 지표 매핑: 수주=엑셀 '계약'(대응 관계 미확인), 개시, 유지감소, 유지증가
   *  - 전년 값은 그 달 전체(월말) 값이다. 올해 실적은 영업현황 집계표와 같은 월말 기준(STATUS_ACTUAL_END)을 쓴다.
   */
  var YOY_ON = false, YOY_CACHE = {};
  var YOY_PRODS = { '일반알람': ['일반'], '알람+휴엔': ['일반', '휴엔'], '정보보안': ['디지털'] };
  var YOY_METRICS = [['수주', '계약', '목표_수주금액'], ['개시', '개시', '목표_개시금액'], ['유지감소', '유지감소', '목표_유지감소'], ['유지증가', '유지증가', '목표_유지증가']];

  function yoyFetch(py, m, prods) {
    var key = py + '|' + m + '|' + prods.join(',');
    if (YOY_CACHE[key]) return Promise.resolve(YOY_CACHE[key]);
    var c;
    try { c = getClient(); } catch (e) { return Promise.reject(e); }
    return c.from(TABLE).select('product,metric,target,actual').eq('year', py).eq('month', m).eq('branch', MINE).in('product', prods).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      var out = {};
      (r.data || []).forEach(function (x) {
        var o = out[x.metric] = out[x.metric] || { t: null, a: null };
        if (x.target != null) o.t = (o.t || 0) + Number(x.target);
        if (x.actual != null) o.a = (o.a || 0) + Number(x.actual);
      });
      if (!Object.keys(out).length) throw new Error('전년 동월 과거실적 데이터가 없습니다.');
      YOY_CACHE[key] = out; return out;
    });
  }

  function yoyBtnStyle() {
    return 'padding:4px 12px; border-radius:4px; cursor:pointer; font-size:13px; font-weight:700; ' +
      (YOY_ON ? 'background:#1e3a8a; color:#fff; border:1px solid #172554;' : 'background:#f4f6f8; color:#1e3a8a; border:1px solid #c7cfd8;');
  }

  function yoyRender() {
    var head = document.querySelector('.status-wrap .status-head'); if (!head) return;
    var btn = document.getElementById('statusYoyBtn');
    if (!btn) {
      btn = document.createElement('button'); btn.id = 'statusYoyBtn'; btn.type = 'button'; btn.textContent = '전년동기 비교';
      btn.onclick = function () { YOY_ON = !YOY_ON; yoyRender(); };
      head.appendChild(btn);
    }
    btn.style.cssText = yoyBtnStyle();
    var box = document.getElementById('statusYoyBox');
    if (!YOY_ON) { if (box) box.remove(); return; }
    if (!box) { box = document.createElement('div'); box.id = 'statusYoyBox'; head.insertAdjacentElement('afterend', box); }
    var parts = String(window.statusYearMonth || '').split('-').map(Number), y = parts[0], m = parts[1];
    var prods = YOY_PRODS[window.statusProductFilter] || ['일반'];
    var py = y - 1;
    var wrap = function (inner) { return '<div class="status-target" style="margin-bottom:12px; background:#f8fafc;">' + inner + '</div>'; };
    if (py < 2023) { box.innerHTML = wrap('<div class="status-target-title">전년동기 비교</div><div style="padding:8px 4px; color:#64748b;">과거실적은 2023년부터 있어 ' + y + '년은 전년 비교 대상이 없습니다.</div>'); return; }
    box.innerHTML = wrap('<div style="padding:10px; color:#64748b;">전년 동월 과거실적을 불러오는 중입니다...</div>');
    var stamp = y + '-' + m + '|' + window.statusProductFilter;
    box.dataset.stamp = stamp;
    yoyFetch(py, m, prods).then(function (prev) {
      var cur = document.getElementById('statusYoyBox'); if (!cur || cur.dataset.stamp !== stamp) return;
      var T = window.STATUS_TARGET || {}, A = window.STATUS_ACTUAL_END || window.STATUS_ACTUAL || {};
      var K = typeof fmtK === 'function' ? fmtK : function (v) { return Math.round(Number(v) || 0).toLocaleString('ko-KR'); };
      var cellS = 'text-align:right !important; text-align-last:right !important; padding-right:0.7em !important;';
      var R = function (cells) { return cells.map(function (c) { return '<td class="num" style="' + cellS + '">' + c + '</td>'; }).join(''); };
      var cols = YOY_METRICS.map(function (d) {
        var p = prev[d[1]] || { t: null, a: null };
        var ta = Number(T[d[2]]) || 0, a = Number(A[d[0]]) || 0;
        var diff = p.a != null ? a - p.a : null, g = (p.a != null && p.a !== 0) ? a / p.a - 1 : null;
        return { k: d[0], ta: ta, a: a, pt: p.t, pa: p.a, pr: rate(d[1], p.t, p.a), diff: diff, g: g };
      });
      var clr = function (v, k) { if (v == null || v === 0) return ''; var good = k === '유지감소' ? v < 0 : v > 0; return ' style="' + cellS + 'color:' + (good ? '#15803d' : '#dc2626') + ';"'; };
      var n = function (v) { return v == null ? '–' : K(v); };
      var h = '<div class="status-target-title" style="display:flex; justify-content:space-between; align-items:baseline; gap:12px;"><span>' + y + '.' + m + '월 vs ' + py + '.' + m + '월 전년동기 비교 · 북서울 · ' + esc(window.statusProductFilter) + '</span><span style="font-weight:600; font-size:0.85em;">(단위: 천원 추정)</span></div>' +
        '<table class="status-summary status-summary-full"><thead><tr><th style="text-align:center !important;">구분</th>' + cols.map(function (c) { return '<th style="text-align:center !important;">' + c.k + '</th>'; }).join('') + '</tr></thead><tbody>' +
        '<tr class="row-target"><th>' + y + ' 목표</th>' + R(cols.map(function (c) { return n(c.ta); })) + '</tr>' +
        '<tr class="row-actual"><th>' + y + ' 실적</th>' + R(cols.map(function (c) { return n(c.a); })) + '</tr>' +
        '<tr class="row-target"><th>' + py + ' 목표</th>' + R(cols.map(function (c) { return n(c.pt); })) + '</tr>' +
        '<tr class="row-actual"><th>' + py + ' 실적</th>' + R(cols.map(function (c) { return n(c.pa); })) + '</tr>' +
        '<tr class="row-ratio"><th>' + py + ' 달성률</th>' + R(cols.map(function (c) { return pct(c.pr); })) + '</tr>' +
        '<tr class="row-diff"><th>전년 대비 증감</th>' + cols.map(function (c) { return '<td class="num"' + clr(c.diff, c.k) + '>' + (c.diff == null ? '–' : sgn(c.diff) + K(c.diff)) + '</td>'; }).join('') + '</tr>' +
        '<tr class="row-ratio"><th>전년 대비 증감률</th>' + cols.map(function (c) { return '<td class="num"' + clr(c.g, c.k) + '>' + (c.g == null ? '–' : sgn(c.g) + (c.g * 100).toFixed(1) + '%') + '</td>'; }).join('') + '</tr>' +
        '</tbody></table>' +
        '<div style="font-size:11.5px; color:#64748b; margin-top:6px; line-height:1.6;">전년 값은 ' + py + '년 ' + m + '월 전체(월말) 기준이고, ' + y + '년은 위 영업현황 집계표와 같은 월말 기준 실적입니다. 출처: 서울사업팀 누계 실적 현황 엑셀(' + py + '년 시트, 북서울 행).<br>' +
        '※ 수주는 엑셀의 \'계약\' 항목과 대응시킨 값(대응 여부 미확인), 알람+휴엔은 일반과 휴엔 합산, 단위는 원본에 표기가 없어 천원으로 추정했습니다. 유지감소는 증감이 음수일수록 양호하며, 유지감소 전년 달성률은 2 − 실적/목표 추정식입니다.</div>';
      cur.innerHTML = wrap(h);
    }).catch(function (e) {
      var cur = document.getElementById('statusYoyBox'); if (!cur || cur.dataset.stamp !== stamp) return;
      cur.innerHTML = wrap('<div class="status-target-title">전년동기 비교</div><div style="padding:8px 4px; color:#dc2626;">' + esc(e.message || e) + '</div>');
    });
  }
  window.statusYoyAfterRender_ = yoyRender;

  window.renderPastPerfView_ = render;
  window.dashShowPastPerfView_ = function () {
    DASH_VIEW_ = 'past_perf';
    render();
  };
})();
