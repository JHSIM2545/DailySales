/**
 * 북서울지사 영업일보 포털 - Gemini 영업 분석 (Admin.html / User.html 공용)
 *
 *  - Gemini 호출은 리포트 버튼(영업분석 리포트 PDF·영업보고 화면)을 누를 때만, 그 시점의 집계 숫자로 한다.
 *    종합대시보드를 열거나 숫자가 바뀐다고 자동 호출하지 않는다. 같은 숫자의 분석이 이미 있으면
 *    「AI 종합 진단 4대 과제」에도 그 문구를 보여주고, 없으면 규칙 기반 문구를 그대로 둔다.
 *  - 호출은 Supabase Edge Function `sales-ai` 를 거친다(Gemini 키는 서버에만 있음).
 *  - Gemini 로 보내는 데이터는 대시보드의 '집계 숫자'뿐이다. 고객명·전화번호·계약번호·계약처명은 보내지 않는다.
 *      (컨설턴트 이름과 그 집계 실적은 포함된다.)
 *  - 같은 숫자면 다시 호출하지 않고 브라우저에 24시간 보관한 결과를 쓴다.
 *  - Gemini 호출이 실패하면 기존 규칙 기반 문구가 그대로 표시된다(화면이 비지 않음).
 *
 *  window.salesAiInsight_(ctx) -> Promise<{cover_summary[], status_intro, analysis[], tasks[]} | null>
 */
(function () {
  'use strict';
  if (window.__gmLoaded) return;
  window.__gmLoaded = true;

  var URL = 'https://gpqlximhoqdybcewdfde.supabase.co/functions/v1/sales-ai';
  var KEY = 'sb_publishable_xUnGxyLCc5TB5nv4keVQVw__grqGJkP';
  var TTL = 24 * 3600 * 1000;
  var inflight = {};

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // 일반 텍스트 -> HTML (숫자·단위는 굵게, 줄바꿈 유지)
  function toHtml(t) {
    return esc(t).replace(/((?<![A-Za-z0-9])[+\-−]?\d[\d,]*(?:\.\d+)?\s?(?:%p|%|천원|만원|건|위|일|영업일)?)/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
  }
  window.salesAiToHtml_ = toHtml;

  function phone() {
    try {
      var s = (typeof SESSION !== 'undefined' && SESSION) ? SESSION : null;
      if (!s) { var raw = sessionStorage.getItem('s1_admin_session_v1') || sessionStorage.getItem('s1_session_v1'); if (raw) s = JSON.parse(raw); }
      return s && s.phone ? String(s.phone) : '';
    } catch (e) { return ''; }
  }
  function num(v) { v = Number(v); return isFinite(v) ? v : 0; }
  function pick(o, keys) { var r = {}; if (!o) return null; keys.forEach(function (k) { if (o[k] !== undefined && o[k] !== null) r[k] = o[k]; }); return r; }

  // ---- 전략영업 분리 ----
  // 영업동기가 '전략영업'인 건은 지사 실적에는 잡히지만 사업팀 전략영업의 실적 영역이므로,
  // 지사 고유 분석에서는 빼고 그 사실을 문구에 밝힌다. (영업동기는 수주·개시 목록에만 있음)
  var strat = {};   // ym -> {ordK,startK,items[]} | null(조회 실패)
  function fetchStrat(c) {
    var ym = c.ym || (c.y + '-' + String(c.m).padStart(2, '0'));
    if (strat[ym] !== undefined) return Promise.resolve(strat[ym]);
    var u = 'https://gpqlximhoqdybcewdfde.supabase.co/rest/v1/daily_orders?select=contract_date,billing_date,monthly_fee,rep_name,product_name,gross_type&sales_motive=like.*' + encodeURIComponent('전략영업') + '*';
    return fetch(u, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (rows) {
        var today = c.todayDs || '';
        var o = { ordK: 0, startK: 0, items: [] };
        rows.forEach(function (r) {
          if (r.gross_type === '법인') return;
          var k = Math.round((Number(r.monthly_fee) || 0) / 1000);
          if (r.contract_date && String(r.contract_date).slice(0, 7) === ym) {
            o.ordK += k; o.items.push({ kind: '수주', date: r.contract_date, amountK: k, product: r.product_name || '', rep: r.rep_name || '' });
          }
          if (r.billing_date && String(r.billing_date).slice(0, 7) === ym && (!c.isCurMonth || !today || String(r.billing_date) <= today)) {
            o.startK += k; o.items.push({ kind: '개시', date: r.billing_date, amountK: k, product: r.product_name || '', rep: r.rep_name || '' });
          }
        });
        return (strat[ym] = o);
      })
      .catch(function (e) { console.warn('[Gemini 분석] 전략영업 조회 실패 - 전략영업 분리 없이 분석:', e && e.message); return (strat[ym] = null); });
  }
  function stratPayload(c) {
    var ym = c.ym || (c.y + '-' + String(c.m).padStart(2, '0'));
    var s = strat[ym];
    if (!s) return null;
    var oa = num(c.ord && c.ord.amt), sa = num(c.start && c.start.amt);
    return {
      ordK: s.ordK, startK: s.startK, items: s.items,
      ordExK: oa - s.ordK, startExK: sa - s.startK,
      ordExPct: c.ord && c.ord.tgt ? Math.round((oa - s.ordK) / c.ord.tgt * 1000) / 10 : null,
      startExPct: c.start && c.start.tgt ? Math.round((sa - s.startK) / c.start.tgt * 1000) / 10 : null
    };
  }

  // 집계 숫자만 추려서 보낸다 (계약처·고객 정보 제외)
  function payload(c) {
    var bm = ['amt', 'tgt', 'pct', 'rank', 'avg', 'gap', 'end', 'endPct'];
    return {
      y: c.y, m: c.m, isCurMonth: !!c.isCurMonth, isPastMonth: !!c.isPastMonth, isFutureMonth: !!c.isFutureMonth,
      elDays: c.elDays, totDays: c.totDays, leftDays: Math.max(0, num(c.totDays) - num(c.elDays)), bizTotal: c.bizTotal || 0,
      ord: pick(c.ord, bm), start: pick(c.start, bm), net: pick(c.net, bm),
      safety: c.safety ? pick(c.safety, ['ordAmt', 'ordTgt', 'ordPct', 'saleAmt', 'saleTgt', 'salePct']) : null,
      cancel: pick(c.cancel, ['cnt', 'amt']), priceUpK: num(c.priceUpK), priceDownK: num(c.priceDownK),
      ordCount: num(c.ordCount), leadAvg: num(c.leadAvg),
      reps: (c.reps || []).map(function (r) {
        return { name: r.name, orderCount: num(r.orderCount), orderAmt: num(r.orderAmt), repTgt: num(r.repTgt), unitAmt: num(r.unitAmt), period: num(r.period), zeroDays: r.zeroDays == null ? null : num(r.zeroDays), style: String(r.style || '') };
      }),
      prod: (function () { var o = {}; ['tot', 'alarm', 'bscan', 'digi', 'huen'].forEach(function (k) { o[k] = pick((c.prod || {})[k], ['cnt', 'ord', 'start', 'can', 'prc', 'net']); }); return o; })(),
      timing: (c.timing || []).map(function (b) { return pick(b, ['label', 'count', 'pct', 'amountK']); }),
      timingTotalK: num(c.timingTotalK),
      strategic: stratPayload(c)
    };
  }
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

  // 같은 날(KST)·같은 월·같은 상품구분이라도 '집계 숫자(payload)'가 같을 때만 같은 분석을 재사용한다.
  //  (서버 ai_insight_cache 공유 + 브라우저 보관). 하루 중 사업팀 순위·실적이 바뀌면 숫자 해시가 달라져 문구를 새로 만든다.
  //  서버 캐시 키에는 cat 값이 들어가므로, cat 뒤에 숫자 해시를 붙여 보낸다(서버 수정 없이 동일 효과).
  function kstDay() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); }
  function dataSig(p) { return hash(JSON.stringify(p)); }
  function keyOf(c, p) { return 'gm_ins6_' + (c.ym || (c.y + '-' + String(c.m).padStart(2, '0'))) + '|' + (c.cat || '') + '|' + kstDay() + '|' + dataSig(p); }
  var mem = {};
  function cacheGet(k) { if (mem[k] && Date.now() - mem[k].t < TTL) return mem[k]; try { var o = JSON.parse(localStorage.getItem(k) || 'null'); if (o && Date.now() - o.t < TTL) return o; } catch (e) {} return null; }
  function cacheSet(k, v) { mem[k] = { t: Date.now(), insight: v }; try { localStorage.setItem(k, JSON.stringify({ t: Date.now(), insight: v })); } catch (e) {} }

  // 보고서 등 다른 화면에서 전략영업 제외 수치를 쓰도록 노출: {ordK,startK,ordExK,startExK,ordExPct,startExPct,items} | null
  window.salesStrategic_ = function (c) { return fetchStrat(c).then(function () { return stratPayload(c); }); };

  window.salesAiCached_ = function (c) {
    try {
      var ym = c.ym || (c.y + '-' + String(c.m).padStart(2, '0'));
      if (strat[ym] === undefined) return null;   // 전략영업 조회 전이면 숫자가 확정되지 않았으므로 캐시를 쓰지 않는다
      return cacheGet(keyOf(c, payload(c))) || null;
    } catch (e) { return null; }
  };

  window.salesAiInsight_ = function (c, opts) {
    if (!c) return Promise.resolve(null);
    return fetchStrat(c).then(function () { return run_(c, opts); });
  };
  function run_(c, opts) {
    opts = opts || {};
    var p = payload(c), k = keyOf(c, p);
    var hit = cacheGet(k);
    if (hit) return Promise.resolve(hit.insight);
    if (inflight[k]) return inflight[k];
    var ph = phone();
    if (!ph) return Promise.resolve(null);
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var to = setTimeout(function () { if (ctl) ctl.abort(); }, opts.timeout || 45000);
    inflight[k] = fetch(URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': KEY, 'Authorization': 'Bearer ' + KEY },
      body: JSON.stringify({ phone: ph, data: p, ym: c.ym || (c.y + '-' + String(c.m).padStart(2, '0')), cat: String(c.cat || '').slice(0, 10) + '_' + dataSig(p) }), signal: ctl ? ctl.signal : undefined
    }).then(function (r) { return r.json().then(function (j) { if (!r.ok || !j.insight) throw new Error(j && j.error ? j.error : ('HTTP ' + r.status)); return j.insight; }); })
      .then(function (ins) {
        ins.closing = typeof ins.closing === 'string' ? ins.closing.trim() : ''; ins.tasks = ins.tasks.slice(0, 4); ins.analysis = ins.analysis.slice(0, 3); ins.cover_summary = ins.cover_summary.slice(0, 3);
        cacheSet(k, ins); return ins;
      })
      .catch(function (e) { console.warn('[Gemini 분석] 실패 - 기본 분석 사용:', e && e.message); return null; })
      .then(function (r) { clearTimeout(to); delete inflight[k]; return r; });
    return inflight[k];
  }

  // ---------------- 화면 반영 ----------------
  var css = document.createElement('style');
  css.textContent = '.gm-status{font-size:12px;color:#64748b;margin:0 0 8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;}' +
    '.gm-status b{color:#1d4ed8;} .gm-status a{color:#1d4ed8;cursor:pointer;text-decoration:underline;}' +
    '.gm-box{margin:0 0 22px;padding:16px 18px;border:1px solid #bfdbfe;border-left:4px solid #2563eb;border-radius:8px;background:#f8fbff;font-size:13.5px;line-height:1.75;color:#1e293b;}' +
    '.gm-box h3{margin:0 0 8px;font-size:15px;color:#1e3a8a;} .gm-box p{margin:0 0 8px;} .gm-box .gm-meta{font-size:11.5px;color:#64748b;margin-top:6px;}';
  document.head.appendChild(css);

  function now() { var d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

  function applyDashboard(tasks) {
    var els = Array.prototype.slice.call(tasks);
    els.forEach(function (e) { e.dataset.gm = '1'; });
    var c = window.DASH_REPORT_CTX_;
    var grid = els[0].parentElement && els[0].parentElement.parentElement;
    if (!grid || !c) return;
    var st = document.createElement('div'); st.className = 'gm-status';
    grid.parentElement.insertBefore(st, grid);
    var fallbackHtml = els.map(function (e) { return e.innerHTML; });
    var done = function (ins, fromCache, stamp) {
      if (!document.body.contains(st)) return;
      if (!ins) {
        st.innerHTML = '기본(규칙 기반) 분석을 표시합니다. Gemini 분석을 불러오지 못했습니다. <a>다시 시도</a>';
        st.querySelector('a').onclick = function () { st.remove(); els.forEach(function (e) { e.dataset.gm = ''; }); scan(true); };
        return;
      }
      ins.tasks.forEach(function (t, i) { if (els[i] && t) els[i].innerHTML = toHtml(t); });
      c.tasks = ins.tasks.map(toHtml); c.gemini = ins;
      st.innerHTML = '<b>✨ Gemini 분석</b> 반영 · ' + (stamp ? new Date(stamp).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : now()) + ' 기준 · 숫자는 일보 집계 데이터';
    };
    // 대시보드는 Gemini 를 직접 부르지 않는다. 리포트 버튼으로 같은 숫자의 분석이 이미 만들어져 있을 때만 그 문구를 보여주고,
    // 없으면 규칙 기반 문구를 그대로 둔다.
    var hit = window.salesAiCached_(c);
    if (hit) { done(hit.insight, true, hit.t); return; }
    st.remove();
  }

  function fillReportBox(box) {
    box.dataset.gm = '1';
    var c = window.DASH_REPORT_CTX_;
    if (!c) { box.remove(); return; }
    var render = function (ins) {
      if (!document.body.contains(box)) return;
      if (!ins) { box.remove(); return; }
      box.className = 'gm-box';
      box.innerHTML = '<h3>✨ Gemini 경영 총평 · ' + c.y + '년 ' + c.m + '월</h3>' +
        '<p>' + toHtml(ins.cover_summary.join('\n')) + '</p><p>' + toHtml(ins.status_intro) + '</p>' +
        ins.analysis.map(function (a) { return '<p>' + toHtml(a) + '</p>'; }).join('') +
        '<div class="gm-meta">Google Gemini가 대시보드 집계 숫자(고객 정보 제외)로 작성한 문구입니다. 아래 표·차트는 일보 DB 기준 값입니다.</div>';
    };
    var hit = window.salesAiCached_(c);
    if (hit) { render(hit.insight); return; }
    box.className = 'gm-box'; box.innerHTML = '<h3>✨ Gemini 경영 총평</h3><p>분석 중입니다…</p>';
    window.salesAiInsight_(c).then(render);
  }

  var pending = false;
  function scan(force) {
    pending = false;
    var t = document.querySelectorAll('.gm-task');
    if (t.length >= 4 && !t[0].dataset.gm) applyDashboard(t);
    var b = document.getElementById('gmReportBox');
    if (b && !b.dataset.gm) fillReportBox(b);
  }
  new MutationObserver(function () { if (!pending) { pending = true; requestAnimationFrame(function () { scan(); }); } })
    .observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(function () { scan(); }, 0);
})();
