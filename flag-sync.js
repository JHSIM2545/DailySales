/**
 * 북서울지사 영업일보 포털 - 체크(깃발) 선택 동기화 + 마우스 선택 UX (Admin.html / User.html 공용)
 *
 * 1) 다른 PC에서도 같은 체크 상태 유지
 *    - 체크 상태는 사용자별로 Supabase system_settings(FLAGS_USER_<전화번호>)에 저장된다.
 *    - 예전에는 "내 화면의 전체 목록"을 통째로 덮어써서, 다른 PC의 변경이 지워질 수 있었다.
 *      이제는 변경분(추가/해제한 항목)만 서버의 최신 목록에 병합해서 저장한다.
 *    - 화면에 다시 포커스가 오거나 15초마다 서버의 최신 체크 상태를 받아와 화면에 반영한다.
 * 2) 마우스 선택 UX
 *    - 맨 위 깃발(⚑) 머리글: 체크된 행이 하나라도 있으면 모두 해제, 하나도 없을 때만 전체 선택.
 *    - 체크 칸(32px 열)은 어디를 눌러도 토글, 체크 칸에서 아래위로 끌면 범위 선택(시작 행 상태 반대로 적용).
 *    - Shift+클릭: 직전 클릭한 행부터 이번 행까지 범위 선택/해제.
 *    - 일반 칸의 글자 선택/편집은 방해하지 않는다(끌기 선택은 체크 칸에서 시작할 때만).
 */
(function () {
  'use strict';
  if (window.__flagSyncLoaded) return;
  window.__flagSyncLoaded = true;

  var SUPABASE_URL = 'https://gpqlximhoqdybcewdfde.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_xUnGxyLCc5TB5nv4keVQVw__grqGJkP';
  var client = null;
  function getClient() {
    if (client) return client;
    if (!window.supabase || !window.supabase.createClient) return null;
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    return client;
  }

  var addQ = new Set(), delQ = new Set(), busy = false, timer = null;

  function keyNow() { return (typeof getUserFlagStorageKey_ === 'function') ? getUserFlagStorageKey_() : 'FLAGS_USER_DEFAULT'; }
  function scopeNow() {
    if (typeof currentTab === 'undefined') return 'order';
    return currentTab === 'cancel' ? 'cancel' : (currentTab === 'price_change' ? 'price' : (currentTab === 'restart' ? 'restart' : (currentTab === 'product_daily' ? 'productdaily' : 'order')));
  }
  function saveLocal() { try { localStorage.setItem(keyNow(), JSON.stringify(Array.from(FLAGGED_SET))); } catch (e) {} }

  function repaint() {
    document.querySelectorAll('.grid-wrap tr[data-id]').forEach(function (tr) {
      var on = FLAGGED_SET.has(String(tr.getAttribute('data-id')));
      tr.classList.toggle('flagged', on);
      var cb = tr.querySelector('td.flag-cell input[type="checkbox"]');
      if (cb) cb.checked = on;
    });
    try { updateFlaggedSumDisplay_(scopeNow()); } catch (e) {}
    updateHeaderTitle();
  }

  function updateHeaderTitle() {
    var n = document.querySelectorAll('.grid-wrap tbody tr[data-id].flagged').length;
    document.querySelectorAll('.grid-wrap th.flag-col').forEach(function (th) {
      th.title = n > 0 ? ('선택 ' + n + '건 - 클릭하면 모두 해제') : '클릭하면 전체 선택';
    });
  }

  function readServer() {
    var c = getClient(); if (!c) return Promise.reject(new Error('no client'));
    return c.from('system_settings').select('setting_value').eq('setting_key', keyNow()).maybeSingle().then(function (r) {
      if (r.error) throw new Error(r.error.message);
      var arr = [];
      if (r.data && r.data.setting_value) { try { var p = JSON.parse(r.data.setting_value); if (Array.isArray(p)) arr = p.map(String); } catch (e) {} }
      return arr;
    });
  }

  // 변경분(추가/해제)만 서버의 최신 목록에 합쳐서 저장
  function flush() {
    if (busy) return;
    if (!addQ.size && !delQ.size) return;
    var add = Array.from(addQ), del = Array.from(delQ);
    addQ.clear(); delQ.clear(); busy = true;
    var key = keyNow();
    readServer().then(function (server) {
      var set = new Set(server);
      add.forEach(function (x) { set.add(x); });
      del.forEach(function (x) { set.delete(x); });
      var arr = Array.from(set);
      return getClient().from('system_settings').upsert({ setting_key: key, setting_value: JSON.stringify(arr) }).then(function (r) {
        if (r.error) throw new Error(r.error.message);
        return set;
      });
    }).then(function (merged) {
      busy = false;
      if (!addQ.size && !delQ.size) {
        // 다른 PC에서 바꾼 항목도 함께 반영
        FLAGGED_SET = new Set(merged); saveLocal(); repaint();
      } else { flush(); }
    }).catch(function (e) {
      busy = false;
      // 실패한 변경분은 다시 대기열에 넣어 다음 기회에 재시도
      add.forEach(function (x) { addQ.add(x); delQ.delete(x); });
      del.forEach(function (x) { if (!addQ.has(x)) delQ.add(x); });
      console.warn('[체크 동기화] 저장 실패, 재시도 예정:', e && e.message);
      clearTimeout(timer); timer = setTimeout(flush, 5000);
    });
  }
  function queue(ids, on) {
    ids.forEach(function (id) { if (on) { addQ.add(id); delQ.delete(id); } else { delQ.add(id); addQ.delete(id); } });
    clearTimeout(timer); timer = setTimeout(flush, 300);
  }

  function pull() {
    if (busy || addQ.size || delQ.size) return;
    if (keyNow() === 'FLAGS_USER_DEFAULT') return;
    readServer().then(function (server) {
      if (busy || addQ.size || delQ.size) return;
      var cur = Array.from(FLAGGED_SET).sort().join('|'), nxt = server.slice().sort().join('|');
      if (cur !== nxt) { FLAGGED_SET = new Set(server); saveLocal(); repaint(); }
    }).catch(function () {});
  }

  function setRows(trs, on) {
    var ids = [];
    trs.forEach(function (tr) {
      var id = String(tr.getAttribute('data-id')); ids.push(id);
      if (on) FLAGGED_SET.add(id); else FLAGGED_SET.delete(id);
      tr.classList.toggle('flagged', on);
      var cb = tr.querySelector('td.flag-cell input[type="checkbox"]');
      if (cb) cb.checked = on;
    });
    saveLocal(); queue(ids, on);
    try { updateFlaggedSumDisplay_(scopeNow()); } catch (e) {}
    updateHeaderTitle();
  }
  function visibleRows() { var t = document.querySelector('.grid-wrap table'); return t ? Array.prototype.slice.call(t.querySelectorAll('tbody tr[data-id]')) : []; }
  var anchor = null;

  // ---- 체크박스 한 칸 클릭(Shift+클릭이면 범위) ----
  window.toggleFlag = function (scope, id) {
    var strId = String(id), trs = visibleRows();
    var tr = trs.filter(function (t) { return String(t.getAttribute('data-id')) === strId; })[0];
    var on = !FLAGGED_SET.has(strId);
    var ev = window.event;
    if (ev && ev.shiftKey && anchor && anchor !== strId) {
      var ids = trs.map(function (t) { return String(t.getAttribute('data-id')); });
      var a = ids.indexOf(anchor), b = ids.indexOf(strId);
      if (a >= 0 && b >= 0) { setRows(trs.slice(Math.min(a, b), Math.max(a, b) + 1), on); anchor = strId; return; }
    }
    anchor = strId;
    if (tr) setRows([tr], on);
    else { // 화면에 없는 행(드문 경우): 데이터만 갱신
      if (on) FLAGGED_SET.add(strId); else FLAGGED_SET.delete(strId); saveLocal(); queue([strId], on);
    }
  };

  // ---- 맨 위 깃발: 선택이 하나라도 있으면 모두 해제, 없으면 전체 선택 ----
  window.toggleAllFlags = function () {
    var trs = visibleRows(); if (!trs.length) return;
    var any = trs.some(function (t) { return FLAGGED_SET.has(String(t.getAttribute('data-id'))); });
    setRows(trs, !any);
  };

  // ---- 체크 칸 클릭/끌기 ----
  var css = document.createElement('style');
  css.textContent =
    'td.flag-cell{cursor:pointer;} td.flag-cell:hover{background:rgba(37,99,235,.10);}' +
    'body.flag-dragging, body.flag-dragging *{user-select:none !important;-webkit-user-select:none !important;cursor:ns-resize !important;}' +
    'tr.flag-drag-on td{background:#bfdbfe !important;} tr.flag-drag-off td{background:#fecaca !important;}';
  document.head.appendChild(css);

  var st = null;
  function trOf(t) { return (t && t.closest) ? t.closest('.grid-wrap table tbody tr[data-id]') : null; }
  function range(a, b) {
    var trs = visibleRows(), i = trs.indexOf(a), j = trs.indexOf(b);
    if (i < 0 || j < 0) return [];
    return trs.slice(Math.min(i, j), Math.max(i, j) + 1);
  }
  function clearPaint() { document.querySelectorAll('tr.flag-drag-on,tr.flag-drag-off').forEach(function (t) { t.classList.remove('flag-drag-on', 'flag-drag-off'); }); }

  document.addEventListener('mousedown', function (e) {
    st = null;
    if (e.button !== 0) return;
    var cell = e.target.closest && e.target.closest('td.flag-cell'); if (!cell) return;
    var tr = trOf(cell); if (!tr) return;
    st = { tr: tr, end: tr, moved: false, on: !FLAGGED_SET.has(String(tr.getAttribute('data-id'))), onBox: !!(e.target.closest && e.target.closest('.flag-chk')), shift: e.shiftKey };
  }, true);

  document.addEventListener('mousemove', function (e) {
    if (!st) return;
    if (!(e.buttons & 1)) { st = null; clearPaint(); document.body.classList.remove('flag-dragging'); return; }
    var over = trOf(document.elementFromPoint(e.clientX, e.clientY));
    if (!st.moved) { if (!over || over === st.tr) return; st.moved = true; document.body.classList.add('flag-dragging'); }
    e.preventDefault();
    if (over) { st.end = over; clearPaint(); range(st.tr, st.end).forEach(function (t) { t.classList.add(st.on ? 'flag-drag-on' : 'flag-drag-off'); }); }
  }, true);

  document.addEventListener('mouseup', function (e) {
    if (!st) return;
    var cur = st; st = null;
    document.body.classList.remove('flag-dragging');
    if (cur.moved) {
      clearPaint();
      var rows = range(cur.tr, cur.end);
      if (rows.length) { setRows(rows, cur.on); anchor = String(cur.end.getAttribute('data-id')); }
      var stop = function (ev) { ev.stopPropagation(); ev.preventDefault(); document.removeEventListener('click', stop, true); };
      document.addEventListener('click', stop, true);
      setTimeout(function () { document.removeEventListener('click', stop, true); }, 0);
    } else if (!cur.onBox && !cur.shift) {
      // 체크박스 바깥의 체크 칸 여백을 눌러도 토글(클릭 영역 확대)
      window.toggleFlag(scopeNow(), cur.tr.getAttribute('data-id'));
    }
  }, true);

  // ---- 서버 최신 상태 반영: 포커스 복귀, 주기적 확인, 표를 다시 그릴 때 ----
  window.addEventListener('focus', pull);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) pull(); });
  setInterval(function () { if (!document.hidden) pull(); }, 15000);
  setTimeout(pull, 1500);
  new MutationObserver(function () { clearTimeout(window.__flagHdrT); window.__flagHdrT = setTimeout(updateHeaderTitle, 100); })
    .observe(document.documentElement, { childList: true, subtree: true });
})();
