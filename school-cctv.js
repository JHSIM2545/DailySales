/**
 * 북서울지사 영업일보 포털 - 「학교 CCTV」 화면 (Admin.html / User.html 공용)
 *
 *  - 상단 타이틀바의 [학교 CCTV] 버튼 -> openSchoolCctv_() 로 전체화면 패널을 연다.
 *  - 대상학교 전체를 한 화면의 표로 보여주고, 직원이 아래 항목을 바로 입력한다.
 *      예산확보여부(확보/미확보/미확인) · 확보예산금액(천원) · 증설대수(카메라/녹화장비)
 *      방문여부(미방문/전화/직접방문) · 방문자(입력자 이름 자동) · 방문결과(내용확인/견적제출/계약예정/계약완료/실패)
 *  - 지사장(관리자 권한)에게는 집계 패널과 CSV 내보내기가 추가로 보인다.
 *  - 데이터: Supabase 테이블 public.school_cctv  (school_cctv.sql 로 생성)
 *  - 로그인 정보: 각 페이지의 전역 SESSION (없으면 sessionStorage 의 s1_admin_session_v1 / s1_session_v1)
 */
(function () {
  'use strict';
  if (window.__sccLoaded) return;
  window.__sccLoaded = true;

  var SUPABASE_URL = 'https://gpqlximhoqdybcewdfde.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_xUnGxyLCc5TB5nv4keVQVw__grqGJkP';
  var TABLE = 'school_cctv';

  var BUDGET_OPTS = ['확보', '미확보', '미확인'];
  var VISIT_OPTS = ['미방문', '전화', '직접방문'];
  var RESULT_OPTS = ['내용확인', '견적제출', '계약예정', '계약완료', '실패'];
  var OPTS = { budget_status: BUDGET_OPTS, visit_type: VISIT_OPTS, visit_result: RESULT_OPTS };
  var NUM_MAX = { budget_amount: 99999999999, quote_amount: 99999999999, add_camera: 9999, add_recorder: 9999 };
  var AMT_FIELDS = { budget_amount: 1, quote_amount: 1 };      // 금액 필드(천원 단위, 항상 우측 정렬)
  var FIELD_LABEL = {
    budget_status: '예산확보여부', budget_amount: '확보예산금액', quote_amount: '견적제출 금액', add_camera: '증설 카메라',
    add_recorder: '증설 녹화장비', visit_type: '방문여부', visit_result: '방문결과', visitor: '방문자'
  };

  var state = {
    rows: [], byNo: {}, loaded: false, loading: false, pending: 0, open: false,
    summaryOpen: true, groupBy: 'guard', refreshTimer: null,
    f: { q: '', office: '', district: '', guard: '', budget: '', visit: '', result: '', unfilled: false, mine: false }
  };

  /* ------------------------------------------------------------------ 공통 유틸 */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function effBudget(r) { return r.budget_status || '미확인'; }                 // 기본값: 예산확보여부 '미확인'
  function effAmt(r) { return r.budget_amount == null ? 0 : Number(r.budget_amount); }   // 기본값: 확보예산금액 0
  function effVisit(r) { return r.visit_type || '미방문'; }      // 서버 값이 비어 있어도 '미방문'으로 취급
  function fmt(v) { return (v === null || v === undefined || v === '') ? '' : Number(v).toLocaleString('ko-KR'); }
  function numOrZero(v) { return (v === null || v === undefined || v === '') ? 0 : Number(v); }
  function pct(a, b) { return b ? (Math.round(a * 1000 / b) / 10).toFixed(1) + '%' : '-'; }
  function fmtTime(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(5, 16);   // "MM-DD HH:mm"
    } catch (e) { return ''; }
  }

  var client = null;
  function db() {
    if (!client) {
      if (!window.supabase || !window.supabase.createClient) throw new Error('Supabase 라이브러리를 불러오지 못했습니다.');
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });
    }
    return client;
  }

  function sess() {
    try { if (typeof SESSION !== 'undefined' && SESSION) return SESSION; } catch (e) { /* 선언 전 */ }
    try {
      var raw = sessionStorage.getItem('s1_admin_session_v1') || sessionStorage.getItem('s1_session_v1');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function me() { var s = sess(); return s && s.name ? String(s.name) : ''; }
  function isBoss() {
    var s = sess(); if (!s) return false;
    var r = String(s.role || '');
    return !!(s.isMainMaster || s.isMaster || s.isAdmin || r === '메인마스터' || r === '서브마스터' || r === '수정가능' || r === 'master');
  }

  /* ------------------------------------------------------------------ 스타일 */
  function injectStyle() {
    if (document.getElementById('scc-style')) return;
    var css = [
      '#sccOverlay{position:fixed;inset:0;z-index:99998;background:#eef1f5;display:none;flex-direction:column;font-family:inherit;color:#1f2937;}',
      '#sccOverlay.open{display:flex;}',
      '#sccOverlay *{box-sizing:border-box;}',
      '.scc-head{background:var(--scc-head,#1c2f4a);color:#fff;padding:10px 18px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;box-shadow:0 2px 8px rgba(0,0,0,.2);}',
      '.scc-head h2{margin:0;font-size:18px;font-weight:700;}',
      '.scc-head .sub{font-size:12px;opacity:.85;}',
      '.scc-head .sp{flex:1;}',
      '.scc-btn{background:#fff;color:#1f2937;border:1px solid #c7cfd8;border-radius:6px;padding:6px 12px;font-size:13px;font-weight:600;cursor:pointer;}',
      '.scc-btn:hover{background:#f1f5f9;}',
      '.scc-head .scc-btn{background:rgba(255,255,255,.14);color:#fff;border-color:rgba(255,255,255,.35);}',
      '.scc-head .scc-btn:hover{background:rgba(255,255,255,.26);}',
      '.scc-top{background:#fff;border-bottom:1px solid #d5dbe3;padding:10px 18px;display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px;}',
      '.scc-card{border:1px solid #cfd8e3;border-left:4px solid var(--scc-head,#1c2f4a);border-radius:8px;padding:7px 12px;background:#f8fafc;min-width:0;}',
      '.scc-card .l{font-size:11px;color:#64748b;}',
      '.scc-card .v{font-size:22px;font-weight:700;margin-top:1px;font-variant-numeric:tabular-nums;white-space:nowrap;}',
      '.scc-card .v small{font-size:13px;font-weight:600;color:#64748b;margin-left:2px;}',
      '.scc-card .s{font-size:11px;color:#64748b;margin-top:1px;}',
      '.scc-card.amt .l,.scc-card.amt .v,.scc-card.amt .s{text-align:right;}',
      '.amt{text-align:right !important;}',
      '.scc-sum{background:#fff;border-bottom:1px solid #d5dbe3;padding:10px 18px 12px;overflow:auto;max-height:46vh;}',
      '.scc-sum.hide{display:none;}',
      '.scc-tiles{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;}',
      '.scc-tile{flex:1 1 130px;min-width:120px;border:1px solid #dbe2ea;border-radius:8px;padding:7px 10px;background:#f8fafc;}',
      '.scc-tile .l{font-size:11px;color:#64748b;}',
      '.scc-tile .v{font-size:19px;font-weight:700;margin-top:1px;font-variant-numeric:tabular-nums;}',
      '.scc-tile .s{font-size:11px;color:#64748b;margin-top:1px;}',
      '.scc-bars{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px 18px;margin-bottom:10px;}',
      '.scc-bar-t{font-size:12px;font-weight:700;margin-bottom:3px;}',
      '.scc-bar{display:flex;height:16px;border-radius:4px;overflow:hidden;background:#e5e7eb;}',
      '.scc-bar i{display:block;height:100%;}',
      '.scc-leg{display:flex;flex-wrap:wrap;gap:2px 10px;margin-top:3px;font-size:11px;color:#475569;}',
      '.scc-leg b{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:3px;vertical-align:-1px;}',
      '.scc-grids{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:12px;}',
      '@media (max-width:1100px){.scc-grids{grid-template-columns:1fr;}}',
      '.scc-gt{font-size:12px;font-weight:700;margin-bottom:4px;display:flex;align-items:center;gap:8px;}',
      '.scc-gt select{font-size:12px;padding:2px 4px;border:1px solid #c7cfd8;border-radius:4px;}',
      '.scc-mini{border-collapse:collapse;width:100%;font-size:12px;}',
      '.scc-mini th,.scc-mini td{border:1px solid #dbe2ea;padding:3px 6px;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;}',
      '.scc-mini th{background:#f1f5f9;font-weight:600;text-align:center;}',
      '.scc-mini td:first-child{text-align:left;font-weight:600;}',
      '.scc-mini tr.tot td{background:#f8fafc;font-weight:700;}',
      '.scc-bar-tools{background:#fff;border-bottom:1px solid #d5dbe3;padding:7px 18px;display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center;font-size:13px;}',
      '.scc-bar-tools input[type=text],.scc-bar-tools select{border:1px solid #c7cfd8;border-radius:5px;padding:4px 6px;font-size:13px;background:#fff;}',
      '.scc-bar-tools input[type=text]{width:150px;}',
      '.scc-bar-tools label.chk{display:inline-flex;align-items:center;gap:3px;cursor:pointer;}',
      '.scc-cnt{margin-left:auto;color:#475569;font-size:12px;}',
      '.scc-status{font-size:12px;color:#92400e;}',
      '.scc-head .scc-status{color:#fde68a;font-weight:700;}',
      '.scc-wrap{flex:1;overflow:auto;background:#fff;position:relative;}',
      'table.scc{border-collapse:separate;border-spacing:0;table-layout:fixed;font-size:12px;}',
      'table.scc th,table.scc td{border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;padding:2px 5px;height:32px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:#fff;}',
      'table.scc thead th{position:sticky;background:#eef2f7;font-weight:700;text-align:center;height:28px;z-index:3;color:#334155;}',
      'table.scc thead tr.r1 th{top:0;}',
      'table.scc thead tr.r2 th{top:28px;}',
      'table.scc thead th.g-in{background:#fff4d6;}',
      'table.scc thead th.g-in2{background:#fde9a8;}',
      'table.scc .s1{position:sticky;left:0;z-index:2;}',
      'table.scc .s2{position:sticky;left:44px;z-index:2;box-shadow:2px 0 0 #cbd5e1;}',
      'table.scc thead th.s1,table.scc thead th.s2{z-index:5;}',
      'table.scc td.num{text-align:right;font-variant-numeric:tabular-nums;color:#475569;}',
      'table.scc td.ctr{text-align:center;}',
      'table.scc td.name{font-weight:600;}',
      'table.scc tbody tr:hover td{background:#f5f9ff;}',
      'table.scc tbody tr:hover td.in{background:#fff7d6;}',
      'table.scc td.in{background:#fffbea;padding:1px 3px;}',
      'table.scc td.in.ro{background:#f8fafc;color:#334155;text-align:center;}',
      'table.scc .gd-s1{color:#0f766e;font-weight:700;}',
      'table.scc .gd-none{color:#94a3b8;}',
      '.scc-in{width:100%;height:26px;border:1px solid #d6dce5;border-radius:4px;padding:1px 4px;font-size:12px;background:#fff;font-family:inherit;}',
      '.scc-in:focus{outline:2px solid #3b82f6;outline-offset:-1px;}',
      '.scc-in.num{text-align:right;}',
      '.scc-in.warn{border-color:#f59e0b;background:#fff7ed;}',
      '.scc-in::-webkit-outer-spin-button,.scc-in::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;}',
      '.scc-in[type=number]{-moz-appearance:textfield;}',
      'select.scc-in[data-v="확보"]{background:#dcfce7;}',
      'select.scc-in[data-v="미확보"]{background:#fee2e2;}',
      'select.scc-in[data-v="미확인"]{background:#f1f5f9;}',
      'select.scc-in[data-v="미방문"]{background:#f1f5f9;}',
      'select.scc-in[data-v="전화"]{background:#dbeafe;}',
      'select.scc-in[data-v="직접방문"]{background:#d1fae5;}',
      'select.scc-in[data-v="내용확인"]{background:#e0f2fe;}',
      'select.scc-in[data-v="견적제출"]{background:#fef3c7;}',
      'select.scc-in[data-v="계약예정"]{background:#ffedd5;}',
      'select.scc-in[data-v="계약완료"]{background:#bbf7d0;font-weight:700;}',
      'select.scc-in[data-v="실패"]{background:#e5e7eb;color:#6b7280;}',
      'tr.scc-saving td.in{opacity:.55;}',
      'tr.scc-saved td.in.ro{background:#dcfce7;}',
      'tr.scc-err td.in.ro{background:#fee2e2;}',
      'table.scc .sx{position:sticky;right:0;z-index:2;text-align:center;padding:1px 2px;box-shadow:-2px 0 0 #cbd5e1;}',
      'table.scc thead th.sx{z-index:5;font-size:11px;}',
      '.scc-x{width:26px;height:26px;border-radius:50%;border:1px solid #fca5a5;background:#fff;color:#dc2626;font-size:14px;font-weight:700;line-height:1;cursor:pointer;padding:0;}',
      '.scc-x:hover{background:#dc2626;color:#fff;border-color:#dc2626;}',
      '.scc-x.idle{opacity:.28;}',
      '.scc-x.idle:hover{background:#fff;color:#dc2626;}',
      '.scc-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:#1f2937;color:#fff;padding:9px 16px;border-radius:8px;font-size:13px;z-index:100001;max-width:92vw;box-shadow:0 6px 20px rgba(0,0,0,.3);}',
      '.scc-toast.err{background:#b91c1c;}',
      '.scc-setup{margin:30px auto;max-width:720px;background:#fff;border:1px solid #fca5a5;border-radius:10px;padding:20px 24px;font-size:14px;line-height:1.7;}',
      '.scc-setup code{background:#f1f5f9;padding:1px 6px;border-radius:4px;}',
      '@media (max-width:700px){.scc-top{padding:6px 10px;gap:6px;grid-template-columns:1fr 1fr;}.scc-card{padding:5px 8px;}.scc-card .v{font-size:16px;}.scc-card .v small{font-size:11px;}.scc-card .s{font-size:10px;}.scc-head{padding:8px 10px;gap:6px;}.scc-head h2{font-size:16px;}.scc-head .scc-btn{padding:5px 8px;font-size:12px;}.scc-bar-tools{padding:6px 10px;}.scc-sum{padding:8px 10px;}}'
    ].join('\n');
    var st = document.createElement('style'); st.id = 'scc-style'; st.textContent = css;
    document.head.appendChild(st);
  }

  /* ------------------------------------------------------------------ 골격 */
  var COLS = [44, 176, 74, 62, 74, 118, 60, 46, 46, 46, 58, 86, 66, 96, 98, 112, 84, 92, 100, 96, 100, 124, 96, 46];

  function buildShell() {
    if (document.getElementById('sccOverlay')) return;
    var o = document.createElement('div');
    o.id = 'sccOverlay';
    var colgroup = '<colgroup>' + COLS.map(function (w) { return '<col style="width:' + w + 'px">'; }).join('') + '</colgroup>';
    var tw = COLS.reduce(function (a, b) { return a + b; }, 0);
    o.innerHTML =
      '<div class="scc-head">' +
        '<h2>🏫 학교 CCTV</h2><span class="sub" id="sccSub"></span><span class="sp"></span>' +
        '<span class="scc-status" id="sccStatus"></span>' +
        '<button class="scc-btn" id="sccSumBtn" style="display:none;">📊 집계 접기</button>' +
        '<button class="scc-btn" id="sccCsvBtn" style="display:none;">⬇ CSV 내보내기</button>' +
        '<button class="scc-btn" id="sccRefreshBtn">↻ 새로고침</button>' +
        '<button class="scc-btn" id="sccCloseBtn">✕ 닫기</button>' +
      '</div>' +
      '<div class="scc-top" id="sccTop"></div>' +
      '<div class="scc-sum" id="sccSum" style="display:none;"></div>' +
      '<div class="scc-bar-tools" id="sccTools">' +
        '<input type="text" id="sccQ" placeholder="학교명 검색" autocomplete="off">' +
        '<select id="sccFOffice"></select><select id="sccFDistrict"></select><select id="sccFGuard"></select>' +
        '<select id="sccFBudget"></select><select id="sccFVisit"></select><select id="sccFResult"></select>' +
        '<label class="chk"><input type="checkbox" id="sccFUnfilled">미방문만 보기</label>' +
        '<label class="chk"><input type="checkbox" id="sccFMine">내가 입력한 것만</label>' +
        '<button class="scc-btn" id="sccResetBtn">필터 초기화</button>' +
        '<span class="scc-cnt" id="sccCnt"></span>' +
      '</div>' +
      '<div class="scc-wrap" id="sccWrap">' +
        '<table class="scc" id="sccTable" style="width:' + tw + 'px">' + colgroup +
          '<thead>' +
            '<tr class="r1">' +
              '<th rowspan="2" class="s1">No</th><th rowspan="2" class="s2">학교명</th>' +
              '<th rowspan="2">교육지원청</th><th rowspan="2">구</th><th rowspan="2">경비업체</th><th rowspan="2">비고</th>' +
              '<th colspan="5">기존 CCTV 설치현황</th>' +
              '<th colspan="3">지원내역(첨부)</th><th colspan="2" class="g-in">예산</th><th colspan="2" class="g-in2">증설대수</th><th colspan="4" class="g-in">방문</th>' +
              '<th rowspan="2" class="g-in2">최종수정</th><th rowspan="2" class="sx" title="행 입력 내용 초기화">초기화</th>' +
            '</tr>' +
            '<tr class="r2">' +
              '<th>설치대수</th><th>복도</th><th>계단</th><th>교문</th><th>출입구</th>' +
              '<th>급별·설립</th><th title="CCTV 필수장소(개소)">필수장소</th><th class="amt" title="지원예산 합계 (CCTV+녹화기+모니터+기타)">지원예산(천원)</th>' +
              '<th class="g-in">확보여부</th><th class="g-in amt">확보금액(천원)</th>' +
              '<th class="g-in2">카메라(대)</th><th class="g-in2">녹화장비(대)</th>' +
              '<th class="g-in">방문여부</th><th class="g-in">방문자</th><th class="g-in">방문결과</th><th class="g-in amt">견적제출금액(천원)</th>' +
            '</tr>' +
          '</thead><tbody id="sccBody"></tbody>' +
        '</table>' +
      '</div>';
    document.body.appendChild(o);

    o.querySelector('#sccCloseBtn').addEventListener('click', closePanel);
    o.querySelector('#sccRefreshBtn').addEventListener('click', function () { load(true); });
    o.querySelector('#sccCsvBtn').addEventListener('click', exportCsv);
    o.querySelector('#sccSumBtn').addEventListener('click', function () {
      state.summaryOpen = !state.summaryOpen; applySummaryVisibility();
    });
    o.querySelector('#sccResetBtn').addEventListener('click', resetFilters);
    var tools = o.querySelector('#sccTools');
    tools.addEventListener('input', onFilterInput);
    tools.addEventListener('change', onFilterInput);

    var body = o.querySelector('#sccBody');
    body.addEventListener('change', onCellChange);
    body.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-act="reset"]') : null;
      if (b) resetRow(b.closest('tr'));
    });
    body.addEventListener('focusin', function (e) {
      var el = e.target;
      if (el.getAttribute && AMT_FIELDS[el.getAttribute('data-f')]) {
        el.value = el.value.replace(/,/g, ''); try { el.select(); } catch (x) { /* noop */ }
      }
    });
    body.addEventListener('focusout', function (e) {
      var el = e.target;
      if (el.getAttribute && AMT_FIELDS[el.getAttribute('data-f')]) {
        var raw = el.value.replace(/,/g, '').trim();
        if (/^\d+$/.test(raw)) el.value = fmt(raw);
      }
    });
    o.querySelector('#sccSum').addEventListener('change', function (e) {
      if (e.target && e.target.id === 'sccGroupBy') { state.groupBy = e.target.value; renderSummary(); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.open) {
        var a = document.activeElement;
        if (a && a.closest && a.closest('#sccOverlay') && /^(INPUT|SELECT)$/.test(a.tagName)) { a.blur(); return; }
        closePanel();
      }
    });
  }

  /* ------------------------------------------------------------------ 열기/닫기 */
  function themeColor() {
    try {
      var tb = document.querySelector('.topbar');
      if (tb) { var c = getComputedStyle(tb).backgroundColor; if (c && c !== 'rgba(0, 0, 0, 0)') return c; }
    } catch (e) { /* noop */ }
    return '#1c2f4a';
  }

  window.openSchoolCctv_ = function () {
    if (!me()) { alert('로그인 후 이용해 주세요.'); return; }
    injectStyle(); buildShell();
    var o = document.getElementById('sccOverlay');
    o.style.setProperty('--scc-head', themeColor());
    state.open = true; o.classList.add('open');
    document.body.dataset.sccOv = document.body.style.overflow || '';
    document.body.style.overflow = 'hidden';
    var boss = isBoss();
    if (!state.sumInit) { state.sumInit = true; state.summaryOpen = window.innerWidth >= 900 && window.innerHeight >= 780; }   // 작은 화면은 표가 먼저 보이도록 접힌 상태로 시작
    document.getElementById('sccSumBtn').style.display = boss ? '' : 'none';
    document.getElementById('sccCsvBtn').style.display = boss ? '' : 'none';
    document.getElementById('sccSum').style.display = boss ? '' : 'none';
    applySummaryVisibility();
    fetchNames();
    load(false);
    clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(function () {      // 다른 직원의 입력을 주기적으로 반영 (입력 중에는 건너뜀)
      var a = document.activeElement;
      var editing = a && a.closest && a.closest('#sccBody');
      if (state.open && !state.pending && !editing && !document.hidden) load(true, true);
    }, 120000);
  };

  function closePanel() {
    var o = document.getElementById('sccOverlay');
    if (o) o.classList.remove('open');
    state.open = false;
    clearInterval(state.refreshTimer);
    document.body.style.overflow = document.body.dataset.sccOv || '';
  }

  function applySummaryVisibility() {
    var sum = document.getElementById('sccSum'), btn = document.getElementById('sccSumBtn');
    if (!sum || !btn) return;
    sum.classList.toggle('hide', !state.summaryOpen);
    btn.textContent = state.summaryOpen ? '📊 집계 접기' : '📊 집계 보기';
  }

  /* ------------------------------------------------------------------ 데이터 로드 */
  function setStatus(msg) { var el = document.getElementById('sccStatus'); if (el) el.textContent = msg || ''; }

  async function load(force, silent) {
    if (state.loading) return;
    state.loading = true;
    if (!silent) setStatus('불러오는 중…');
    try {
      var res = await db().from(TABLE).select('*').order('no', { ascending: true }).range(0, 999);
      if (res.error) throw res.error;
      state.rows = (res.data || []).slice().sort(function (a, b) {
        var x = a.seq == null ? 1e9 + a.no : a.seq, y = b.seq == null ? 1e9 + b.no : b.seq; return x - y;
      });
      state.byNo = {}; state.rows.forEach(function (r) { state.byNo[r.no] = r; });
      state.loaded = true;
      setStatus('');
      renderAll();
      setStatus(schemaWarning());
    } catch (err) {
      setStatus('');
      if (!silent || !state.loaded) showLoadError(err);
    } finally { state.loading = false; }
  }

  function showLoadError(err) {
    var msg = (err && (err.message || err.details)) ? String(err.message || err.details) : String(err);
    var code = err && err.code ? String(err.code) : '';
    var noTable = code === '42P01' || code === 'PGRST205' || /does not exist|schema cache|Could not find the table/i.test(msg);
    var rls = code === '42501' || /row-level security|permission denied/i.test(msg);
    var h = '<tr><td colspan="21" style="height:auto;white-space:normal;padding:0;border:0;"><div class="scc-setup">' +
      '<b style="color:#b91c1c;">학교 CCTV 데이터를 불러오지 못했습니다.</b><br>' +
      (noTable ? '<code>school_cctv</code> 테이블이 아직 없습니다. Supabase <b>SQL Editor</b>에서 <code>school_cctv.sql</code> 파일 전체를 한 번 실행한 뒤 [새로고침]을 눌러 주세요.' :
        rls ? '권한(RLS) 문제입니다. <code>school_cctv.sql</code> 파일 안의 policy / grant 구문이 실행되었는지 확인해 주세요.' :
          '네트워크 또는 서버 오류입니다.') +
      '<br><span style="color:#64748b;font-size:12px;">상세: ' + esc(msg) + (code ? ' (' + esc(code) + ')' : '') + '</span></div></td></tr>';
    var body = document.getElementById('sccBody'); if (body) body.innerHTML = h;
    var cnt = document.getElementById('sccCnt'); if (cnt) cnt.textContent = '';
  }

  /* ------------------------------------------------------------------ 필터 */
  function distinct(key) {
    var seen = {}, out = [];
    state.rows.forEach(function (r) { var v = r[key]; if (v && !seen[v]) { seen[v] = 1; out.push(v); } });
    return out;
  }
  function fillSelect(id, label, values, cur) {
    var el = document.getElementById(id); if (!el) return;
    el.innerHTML = '<option value="">' + esc(label) + '</option>' +
      values.map(function (v) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
  }
  function renderFilterOptions() {
    var f = state.f;
    fillSelect('sccFOffice', '교육지원청 전체', distinct('edu_office'), f.office);
    fillSelect('sccFDistrict', '구 전체', distinct('district'), f.district);
    fillSelect('sccFGuard', '경비업체 전체', distinct('guard_company'), f.guard);
    fillSelect('sccFBudget', '예산확보여부 전체', BUDGET_OPTS, f.budget);
    fillSelect('sccFVisit', '방문여부 전체', VISIT_OPTS, f.visit);
    fillSelect('sccFResult', '방문결과 전체', ['__none'].concat(RESULT_OPTS), f.result);
    ['sccFResult'].forEach(function (id) {
      var op = document.querySelector('#' + id + ' option[value="__none"]'); if (op) op.textContent = '(미입력)';
    });
  }
  function onFilterInput() {
    var f = state.f;
    f.q = document.getElementById('sccQ').value.trim();
    f.office = document.getElementById('sccFOffice').value;
    f.district = document.getElementById('sccFDistrict').value;
    f.guard = document.getElementById('sccFGuard').value;
    f.budget = document.getElementById('sccFBudget').value;
    f.visit = document.getElementById('sccFVisit').value;
    f.result = document.getElementById('sccFResult').value;
    f.unfilled = document.getElementById('sccFUnfilled').checked;
    f.mine = document.getElementById('sccFMine').checked;
    renderTable();
  }
  function resetFilters() {
    state.f = { q: '', office: '', district: '', guard: '', budget: '', visit: '', result: '', unfilled: false, mine: false };
    document.getElementById('sccQ').value = '';
    document.getElementById('sccFUnfilled').checked = false;
    document.getElementById('sccFMine').checked = false;
    renderFilterOptions(); renderTable();
  }
  function matchEnum(val, filter) { return !filter || (filter === '__none' ? !val : val === filter); }
  function visibleRows() {
    var f = state.f, who = me();
    return state.rows.filter(function (r) {
      if (f.q && String(r.school_name).indexOf(f.q) < 0) return false;
      if (f.office && r.edu_office !== f.office) return false;
      if (f.district && r.district !== f.district) return false;
      if (f.guard && r.guard_company !== f.guard) return false;
      if (!matchEnum(effBudget(r), f.budget)) return false;
      if (!matchEnum(effVisit(r), f.visit)) return false;
      if (!matchEnum(r.visit_result, f.result)) return false;
      if (f.unfilled && effVisit(r) !== '미방문') return false;
      if (f.mine && !(who && (r.visitor === who || r.updated_by === who))) return false;
      return true;
    });
  }

  /* ------------------------------------------------------------------ 표 렌더 */
  function selectHtml(field, cur) {
    var o = (field === 'visit_type' || field === 'budget_status' ? '' : '<option value=""></option>') + OPTS[field].map(function (v) {
      return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>';
    }).join('');
    return '<select class="scc-in" data-f="' + field + '" data-v="' + esc(cur || '') + '">' + o + '</select>';
  }
  /* 방문자: 지사원 전체 명단에서 선택(기본값은 입력·수정한 로그인 사용자). 명단은 포털의 사용자 목록(getUserNames)을 사용 */
  function nameList(cur) {
    var seen = {}, out = [];
    (state.names || []).concat([me(), cur]).forEach(function (n) { n = String(n || '').trim(); if (n && !seen[n]) { seen[n] = 1; out.push(n); } });
    return out;
  }
  function visitorOptions(cur) {
    return '<option value=""></option>' + nameList(cur).map(function (n) {
      return '<option value="' + esc(n) + '"' + (n === cur ? ' selected' : '') + '>' + esc(n) + '</option>';
    }).join('');
  }
  function visitorSelect(cur) {
    return '<select class="scc-in vis" data-f="visitor" data-v="visitor" title="방문자 (변경 가능)">' + visitorOptions(cur || '') + '</select>';
  }
  function fetchNames() {
    var list = [];
    try { if (typeof USER_NAMES !== 'undefined' && Array.isArray(USER_NAMES)) list = USER_NAMES.slice(); } catch (e) { /* noop */ }
    state.names = list;
    try {
      var g = window.google, s = sess();
      if (g && g.script && g.script.run && s && s.token) {
        g.script.run.withSuccessHandler(function (res) {
          if (res && res.success && res.names && res.names.length) { state.names = res.names.slice(); refreshVisitorSelects(); }
        }).withFailureHandler(function () { }).getUserNames(s.token);
      }
    } catch (e) { /* 명단을 못 불러와도 기본 명단/본인 이름으로 동작 */ }
  }
  function refreshVisitorSelects() {
    document.querySelectorAll('#sccBody select[data-f="visitor"]').forEach(function (sel) {
      var tr = sel.closest('tr'), row = tr && state.byNo[Number(tr.getAttribute('data-no'))];
      sel.innerHTML = visitorOptions(row ? row.visitor || '' : sel.value);
    });
  }
  function numInput(field, v) {
    return '<input class="scc-in num" type="number" min="0" step="1" data-f="' + field + '" value="' + (v == null ? '' : esc(v)) + '" placeholder="0">';
  }
  function hasInput(r) {     // 직원이 입력한 값이 있는지 (기본값: 미방문 / 미확인 / 금액 0 은 입력으로 보지 않음)
    return !!(effBudget(r) !== '미확인' || effAmt(r) > 0 || r.add_camera != null || r.add_recorder != null || r.quote_amount != null ||
      r.visit_result || r.visitor || effVisit(r) !== '미방문');
  }
  function budgetWarn(r) { return numOrZero(r.budget_amount) > 0 && r.budget_status !== '확보'; }
  var WARN_TITLE = '확보예산금액이 입력되었지만 예산확보여부가 \'확보\'가 아닙니다. 확인해 주세요.';
  function lvlShort(r) {
    var l = String(r.school_level || '').replace('학교', ''), f = r.found_type || '';
    return (l || f) ? (l + (l && f ? ' · ' : '') + f) : '';
  }
  function supTitle(r) {
    if (r.sup_total == null) return '';
    return 'CCTV ' + fmt(r.sup_cctv) + ' / 녹화기 ' + fmt(r.sup_recorder) + ' / 모니터 ' + fmt(r.sup_monitor) + ' / 기타 ' + fmt(r.sup_etc) + ' (천원)';
  }
  function rowHtml(r) {
    var gcls = r.guard_company === '에스원' ? 'gd-s1' : (r.guard_company === '미이용' || r.guard_company === '확인불가' ? 'gd-none' : '');
    return '<tr data-no="' + r.no + '">' +
      '<td class="s1 ctr num">' + (r.seq != null ? r.seq : r.no) + '</td>' +
      '<td class="s2 name" title="' + esc(r.school_name) + '">' + esc(r.school_name) + '</td>' +
      '<td class="ctr">' + esc(r.edu_office) + '</td><td class="ctr">' + esc(r.district) + '</td>' +
      '<td class="ctr ' + gcls + '">' + esc(r.guard_company) + '</td>' +
      '<td title="' + esc(r.guard_note) + '">' + esc(r.guard_note) + '</td>' +
      '<td class="num">' + fmt(r.install_cnt) + '</td><td class="num">' + fmt(r.cnt_corridor) + '</td>' +
      '<td class="num">' + fmt(r.cnt_stairs) + '</td><td class="num">' + fmt(r.cnt_gate) + '</td>' +
      '<td class="num">' + fmt(r.cnt_entrance) + '</td>' +
      '<td class="ctr">' + esc(lvlShort(r)) + '</td><td class="num">' + fmt(r.sup_places) + '</td>' +
      '<td class="num" title="' + esc(supTitle(r)) + '">' + fmt(r.sup_total) + '</td>' +
      '<td class="in">' + selectHtml('budget_status', effBudget(r)) + '</td>' +
      '<td class="in"><input class="scc-in num amt' + (budgetWarn(r) ? ' warn' : '') + '"' + (budgetWarn(r) ? ' title="' + WARN_TITLE + '"' : '') + ' type="text" inputmode="numeric" data-f="budget_amount" value="' + esc(fmt(effAmt(r))) + '" placeholder="천원"></td>' +
      '<td class="in">' + numInput('add_camera', r.add_camera) + '</td>' +
      '<td class="in">' + numInput('add_recorder', r.add_recorder) + '</td>' +
      '<td class="in">' + selectHtml('visit_type', effVisit(r)) + '</td>' +
      '<td class="in">' + visitorSelect(r.visitor) + '</td>' +
      '<td class="in">' + selectHtml('visit_result', r.visit_result) + '</td>' +
      '<td class="in"><input class="scc-in num amt" type="text" inputmode="numeric" data-f="quote_amount" value="' + esc(fmt(r.quote_amount)) + '" placeholder="천원"></td>' +
      '<td class="in ro" data-c="upd" title="' + esc(r.updated_by) + '">' + esc(r.updated_at && r.updated_by ? fmtTime(r.updated_at) : '') + '</td>' +
      '<td class="sx"><button type="button" class="scc-x' + (hasInput(r) ? '' : ' idle') + '" data-act="reset" title="이 행에 입력한 내용 초기화" aria-label="초기화">✕</button></td>' +
      '</tr>';
  }
  function renderTable() {
    var rows = visibleRows();
    var body = document.getElementById('sccBody');
    body.innerHTML = rows.length ? rows.map(rowHtml).join('') :
      '<tr><td colspan="21" style="height:80px;text-align:center;color:#64748b;">조건에 맞는 학교가 없습니다.</td></tr>';
    document.getElementById('sccCnt').textContent = '표시 ' + rows.length + ' / 전체 ' + state.rows.length + '개교';
  }
  function renderAll() {
    document.getElementById('sccSub').textContent = '북서울지사 · 총 ' + state.rows.length + '개교 · 입력 로그인: ' + me();
    renderFilterOptions(); renderTable();
    renderTop(); if (isBoss()) renderSummary();
  }

  /* ------------------------------------------------------------------ 저장 */
  function parseValue(field, raw) {
    raw = String(raw == null ? '' : raw).trim();
    if (field === 'visitor') return raw === '' ? null : raw;
    if (OPTS[field]) {
      if (raw === '') return field === 'visit_type' ? '미방문' : (field === 'budget_status' ? '미확인' : null);
      if (OPTS[field].indexOf(raw) < 0) throw new Error('허용되지 않는 값입니다: ' + raw);
      return raw;
    }
    raw = raw.replace(/,/g, '');
    if (raw === '') return field === 'budget_amount' ? 0 : null;
    if (!/^\d+$/.test(raw)) throw new Error(FIELD_LABEL[field] + ': 0 이상의 숫자만 입력할 수 있습니다.');
    var n = Number(raw);
    if (n > NUM_MAX[field]) throw new Error(FIELD_LABEL[field] + ': 값이 너무 큽니다. (최대 ' + fmt(NUM_MAX[field]) + ')');
    return n;
  }
  function displayValue(field, v) {
    if (field === 'budget_amount') return fmt(v == null ? 0 : v);
    if (AMT_FIELDS[field]) return fmt(v);
    if (field === 'visit_type') return v || '미방문';
    if (field === 'budget_status') return v || '미확인';
    return v == null ? '' : String(v);
  }

  function onCellChange(e) {
    var el = e.target, field = el.getAttribute && el.getAttribute('data-f');
    if (!field) return;
    var tr = el.closest('tr'), no = Number(tr.getAttribute('data-no')), row = state.byNo[no];
    if (!row) return;
    var val;
    try { val = parseValue(field, el.value); }
    catch (err) { toast(err.message, true); el.value = displayValue(field, row[field]); return; }
    var cur = field === 'visit_type' ? effVisit(row) : field === 'budget_status' ? effBudget(row) : field === 'budget_amount' ? effAmt(row) : (row[field] == null ? null : row[field]);
    if (val === cur) { el.value = displayValue(field, row[field]); return; }
    saveField(row, field, val, el, tr);
  }

  async function saveField(row, field, val, el, tr) {
    var who = me();
    if (!who) { toast('로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.', true); el.value = displayValue(field, row[field]); return; }
    var before = row[field];
    var patch = {}; patch[field] = val;
    patch.updated_by = who;
    patch.updated_at = new Date().toISOString();
    // 방문자 기본값 = 입력한 로그인 사용자: 방문자가 비어 있을 때만 자동 기록(직접 고른 방문자는 덮어쓰지 않음)
    if (field !== 'visitor' && !row.visitor) patch.visitor = who;

    state.pending++; tr.classList.remove('scc-saved', 'scc-err'); tr.classList.add('scc-saving');
    try {
      var res = await db().from(TABLE).update(patch).eq('no', row.no).select();
      if (res.error) throw res.error;
      if (!res.data || !res.data.length) throw new Error('저장된 행이 없습니다. (권한 정책을 확인해 주세요)');
      Object.assign(row, res.data[0]);
      applyRowToDom(tr, row, field);
      tr.classList.remove('scc-saving'); tr.classList.add('scc-saved');
      setTimeout(function () { tr.classList.remove('scc-saved'); }, 1200);
      renderTop(); if (isBoss()) renderSummary();
      logChange(row, field, before, val);
    } catch (err) {
      tr.classList.remove('scc-saving'); tr.classList.add('scc-err');
      el.value = displayValue(field, before);
      if (el.tagName === 'SELECT') el.setAttribute('data-v', field === 'visit_type' ? (before || '미방문') : field === 'budget_status' ? (before || '미확인') : (before || ''));
      toast('저장 실패 — ' + friendlyError(err), true);
    } finally { state.pending--; }
  }

  function applyRowToDom(tr, row, changedField) {
    var xb = tr.querySelector('.scc-x'); if (xb) xb.classList.toggle('idle', !hasInput(row));
    var v = tr.querySelector('select[data-f="visitor"]');
    if (v) { v.innerHTML = visitorOptions(row.visitor || ''); v.value = row.visitor || ''; }
    var u = tr.querySelector('[data-c="upd"]');
    if (u) { u.textContent = row.updated_by ? fmtTime(row.updated_at) : ''; u.title = row.updated_by || ''; }
    tr.querySelectorAll('select[data-f]').forEach(function (s) {
      var f = s.getAttribute('data-f'); s.setAttribute('data-v', f === 'visit_type' ? effVisit(row) : f === 'budget_status' ? effBudget(row) : (row[f] || ''));
    });
    var amt = tr.querySelector('[data-f="budget_amount"]');
    if (amt) { amt.classList.toggle('warn', budgetWarn(row)); if (budgetWarn(row)) amt.title = WARN_TITLE; else amt.removeAttribute('title'); }
    var inp = tr.querySelector('[data-f="' + changedField + '"]');
    if (inp && inp.tagName !== 'SELECT') inp.value = displayValue(changedField, row[changedField]);
  }

  /* 행 초기화: 직원이 입력한 항목만 처음 상태로 되돌린다(학교 기본정보는 유지). 방문여부는 기본값 '미방문', 최종수정 정보도 비운다. */
  async function resetRow(tr) {
    if (!tr) return;
    var no = Number(tr.getAttribute('data-no')), row = state.byNo[no];
    if (!row) return;
    if (!me()) { toast('로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.', true); return; }
    if (!hasInput(row)) { toast('초기화할 입력 내용이 없습니다.'); return; }
    var msg = '「' + row.school_name + '」 행에 입력한 내용을 모두 초기화할까요?\n\n' +
      '예산확보여부(→미확인) · 확보예산금액(→0) · 증설대수 · 방문여부(→미방문) · 방문자 · 방문결과 · 견적제출금액이 처음 상태로 돌아갑니다.\n(되돌릴 수 없습니다)';
    if (!window.confirm(msg)) return;
    var patch = { budget_status: '미확인', budget_amount: 0, add_camera: null, add_recorder: null, visit_type: '미방문',
      visitor: null, visit_result: null, quote_amount: null, updated_by: null, updated_at: null };
    Object.keys(patch).forEach(function (k) { if (!(k in row)) delete patch[k]; });      // 구버전 DB(없는 열)는 건너뜀
    var before = Object.assign({}, row);
    state.pending++; tr.classList.remove('scc-saved', 'scc-err'); tr.classList.add('scc-saving');
    try {
      var res = await db().from(TABLE).update(patch).eq('no', row.no).select();
      if (res.error) throw res.error;
      if (!res.data || !res.data.length) throw new Error('저장된 행이 없습니다. (권한 정책을 확인해 주세요)');
      Object.assign(row, res.data[0]);
      var cur = document.querySelector('#sccBody tr[data-no="' + no + '"]') || tr;
      cur.outerHTML = rowHtml(row);
      var nt = document.querySelector('#sccBody tr[data-no="' + no + '"]');
      if (nt) { nt.classList.add('scc-saved'); setTimeout(function () { nt.classList.remove('scc-saved'); }, 1200); }
      renderTop(); if (isBoss()) renderSummary();
      toast('「' + row.school_name + '」 입력 내용을 초기화했습니다.');
      try {
        if (typeof window.logUserAction_ === 'function') {
          var p = window.logUserAction_('학교CCTV 수정', 'schoolcctv', 'S' + row.no,
            { company: row.school_name, desc: row.school_name + ' · 입력 내용 초기화 (이전: 방문여부 ' + effVisit(before) + ', 방문결과 ' + (before.visit_result || '없음') +
              ', 예산 ' + effBudget(before) + ', 예산금액 ' + fmt(effAmt(before)) + ', 견적금액 ' + fmt(before.quote_amount) + ')' });
          if (p && p.catch) p.catch(function () { });
        }
      } catch (e) { /* noop */ }
    } catch (err) {
      tr.classList.remove('scc-saving'); tr.classList.add('scc-err');
      toast('초기화 실패 — ' + friendlyError(err), true);
    } finally { state.pending--; }
  }

  function logChange(row, field, before, after) {      // 기존 포털의 변경이력(activity_logs)에 함께 남긴다. 실패해도 무시.
    try {
      if (typeof window.logUserAction_ !== 'function') return;
      var d = FIELD_LABEL[field] + ': ' + (before == null ? '(없음)' : before) + ' → ' + (after == null ? '(삭제)' : after);
      var p = window.logUserAction_('학교CCTV 수정', 'schoolcctv', 'S' + row.no, { company: row.school_name, desc: row.school_name + ' · ' + d });
      if (p && p.catch) p.catch(function () { });
    } catch (e) { /* noop */ }
  }

  function friendlyError(err) {
    var m = err && err.message ? String(err.message) : String(err);
    var mc = m.match(/Could not find the '([^']+)' column/);
    if (mc) return "DB에 '" + mc[1] + "' 열이 없습니다. Supabase SQL Editor에서 school_cctv.sql 을 다시 실행한 뒤 [새로고침]을 눌러 주세요.";
    if (/row-level security|permission denied/i.test(m)) return m + ' (school_cctv.sql 의 policy/grant 실행 여부 확인)';
    return m;
  }
  /* DB 가 구버전(없는 열이 있음)이면 상단에 계속 알려준다. 서버가 돌려준 행의 키로 판단. */
  var REQUIRED_COLS = ['quote_amount', 'sup_total'];
  function schemaWarning() {
    if (!state.rows.length) return '';
    var miss = REQUIRED_COLS.filter(function (c) { return !(c in state.rows[0]); });
    return miss.length ? '⚠ DB 업데이트 필요: school_cctv.sql 다시 실행 (없는 열: ' + miss.join(', ') + ')' : '';
  }

  var toastTimer = null;
  function toast(msg, isErr) {
    var t = document.getElementById('sccToast');
    if (!t) { t = document.createElement('div'); t.id = 'sccToast'; document.body.appendChild(t); }
    t.className = 'scc-toast' + (isErr ? ' err' : ''); t.textContent = msg; t.style.display = '';
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.style.display = 'none'; }, isErr ? 6000 : 2200);
  }

  /* ------------------------------------------------------------------ 집계 (지사장) */
  function levelOf(name) {      // 학교명 끝글자 기준 구분(추정 아님: 이름 규칙 그대로). 특수학교 등은 '기타'
    name = String(name || '');
    if (/초등학교$/.test(name)) return '초등학교';
    if (/중학교$/.test(name)) return '중학교';
    if (/고등학교$/.test(name)) return '고등학교';
    return '기타(특수 등)';
  }
  var GROUPS = {
    guard: { label: '경비업체별', key: function (r) { return r.guard_company || '(미분류)'; } },
    district: { label: '구별', key: function (r) { return r.district || '(미분류)'; } },
    office: { label: '교육지원청별', key: function (r) { return r.edu_office || '(미분류)'; } },
    level: { label: '학교급별', key: function (r) { return r.school_level || levelOf(r.school_name); } }
  };
  function agg(list) {
    var a = {
      n: list.length, install: 0, visited: 0, budgetOk: 0, amount: 0, qAmt: 0, qN: 0, cam: 0, rec: 0, quote: 0, plan: 0, done: 0, fail: 0
    };
    list.forEach(function (r) {
      a.install += numOrZero(r.install_cnt);
      if (r.visit_type === '전화' || r.visit_type === '직접방문') a.visited++;
      if (r.budget_status === '확보') a.budgetOk++;
      a.amount += numOrZero(r.budget_amount); a.cam += numOrZero(r.add_camera); a.rec += numOrZero(r.add_recorder);
      a.qAmt += numOrZero(r.quote_amount); if (numOrZero(r.quote_amount) > 0) a.qN++;
      if (r.visit_result === '견적제출') a.quote++;
      if (r.visit_result === '계약예정') a.plan++;
      if (r.visit_result === '계약완료') a.done++;
      if (r.visit_result === '실패') a.fail++;
    });
    return a;
  }
  function count(list, key, val) { return list.filter(function (r) { return val === null ? !r[key] : r[key] === val; }).length; }
  function won(amountK) {     // 천원 단위 금액을 읽기 쉬운 원 단위 표기로 (예: 1,235,067천원 → 약 12.35억원)
    var w = amountK * 1000;
    if (w >= 1e8) return '약 ' + (w / 1e8).toFixed(2) + '억원';
    if (w >= 1e4) return '약 ' + Math.round(w / 1e4).toLocaleString('ko-KR') + '만원';
    return w.toLocaleString('ko-KR') + '원';
  }

  /* 상단 요약 (모든 사용자): 방문학교수/전체학교수 · 예산확보 학교수 · 예산총액 · 당사제안총액 */
  function renderTop() {
    var el = document.getElementById('sccTop'); if (!el) return;
    var list = state.rows, a = agg(list), mismatch = list.filter(budgetWarn).length;
    var cards = [
      { l: '방문 학교 / 전체 학교', v: a.visited + ' / ' + fmt(a.n) + '<small>개교</small>', s: '방문율 ' + pct(a.visited, a.n) + ' (전화+직접방문)' },
      { l: '예산 확보 학교', v: a.budgetOk + '<small>개교</small>', s: '전체 대비 ' + pct(a.budgetOk, a.n) },
      { l: '예산 총액 (확보예산금액 합)', v: fmt(a.amount) + '<small>천원</small>', s: won(a.amount) + (mismatch ? ' · ⚠ 확보 아님 상태에 금액 ' + mismatch + '건 포함' : ''), amt: 1 },
      { l: '당사 제안 총액 (견적제출금액 합)', v: fmt(a.qAmt) + '<small>천원</small>', s: '제안 ' + a.qN + '개교 · ' + won(a.qAmt), amt: 1 }
    ];
    el.innerHTML = cards.map(function (c) {
      return '<div class="scc-card' + (c.amt ? ' amt' : '') + '"><div class="l">' + c.l + '</div><div class="v">' + c.v + '</div><div class="s">' + esc(c.s) + '</div></div>';
    }).join('');
  }

  function barHtml(title, list, getter, opts, colors, showNone) {
    var total = list.length || 1, segs = '', leg = '', all = showNone ? opts.concat([null]) : opts;
    all.forEach(function (o, i) {
      var c = list.filter(function (r) { var v = getter(r); return o === null ? !v : v === o; }).length;
      var w = c * 100 / total, col = o === null ? '#e5e7eb' : colors[i];
      var name = o === null ? '미입력' : o;
      if (c) segs += '<i title="' + esc(name) + ' ' + c + '" style="width:' + w + '%;background:' + col + '"></i>';
      leg += '<span><b style="background:' + (o === null ? '#cbd5e1' : col) + '"></b>' + esc(name) + ' ' + c + '</span>';
    });
    return '<div><div class="scc-bar-t">' + esc(title) + '</div><div class="scc-bar">' + segs + '</div><div class="scc-leg">' + leg + '</div></div>';
  }
  function groupTable(list, gb) {
    var g = GROUPS[gb], buckets = {}, order = [];
    list.forEach(function (r) { var k = g.key(r); if (!buckets[k]) { buckets[k] = []; order.push(k); } buckets[k].push(r); });
    order.sort(function (a, b) { return buckets[b].length - buckets[a].length; });
    var th = '<tr><th>구분</th><th>학교수</th><th>설치대수</th><th>방문</th><th>방문율</th><th>예산확보</th><th>확보예산(천원)</th><th>제안금액(천원)</th><th>증설 카메라</th><th>증설 녹화</th><th>견적</th><th>계약예정</th><th>계약완료</th></tr>';
    function tr(name, a, cls) {
      return '<tr class="' + (cls || '') + '"><td>' + esc(name) + '</td><td>' + fmt(a.n) + '</td><td>' + fmt(a.install) + '</td><td>' + a.visited + '</td><td>' + pct(a.visited, a.n) +
        '</td><td>' + a.budgetOk + '</td><td>' + fmt(a.amount) + '</td><td>' + fmt(a.qAmt) + '</td><td>' + fmt(a.cam) + '</td><td>' + fmt(a.rec) + '</td><td>' + a.quote + '</td><td>' + a.plan + '</td><td>' + a.done + '</td></tr>';
    }
    return '<table class="scc-mini">' + th + order.map(function (k) { return tr(k, agg(buckets[k])); }).join('') + tr('합계', agg(list), 'tot') + '</table>';
  }
  function staffTable(list) {
    var by = {}, order = [];
    list.forEach(function (r) { if (!r.visitor) return; if (!by[r.visitor]) { by[r.visitor] = []; order.push(r.visitor); } by[r.visitor].push(r); });
    order.sort(function (a, b) { return by[b].length - by[a].length; });
    if (!order.length) return '<div style="font-size:12px;color:#64748b;padding:6px 0;">아직 입력된 방문 데이터가 없습니다.</div>';
    var th = '<tr><th>입력자</th><th>학교수</th><th>직접방문</th><th>전화</th><th>견적</th><th>제안금액(천원)</th><th>계약예정</th><th>계약완료</th><th>실패</th></tr>';
    return '<table class="scc-mini">' + th + order.map(function (k) {
      var l = by[k], a = agg(l);
      return '<tr><td>' + esc(k) + '</td><td>' + l.length + '</td><td>' + count(l, 'visit_type', '직접방문') + '</td><td>' + count(l, 'visit_type', '전화') + '</td><td>' + a.quote + '</td><td>' + fmt(a.qAmt) + '</td><td>' + a.plan + '</td><td>' + a.done + '</td><td>' + a.fail + '</td></tr>';
    }).join('') + '</table>';
  }
  /* 지사장 상세 집계 (요약 4종은 상단 renderTop 으로 이동, 여기서는 세부 분포·구분별 표) */
  function renderSummary() {
    var el = document.getElementById('sccSum'); if (!el) return;
    var list = state.rows, a = agg(list);
    var tiles = [
      ['설치대수 합계', fmt(a.install) + '대', '전체 ' + fmt(a.n) + '개교'],
      ['증설 카메라', fmt(a.cam) + '대', ''],
      ['증설 녹화장비', fmt(a.rec) + '대', ''],
      ['견적·계약 진행', (a.quote + a.plan + a.done) + '개교', '견적 ' + a.quote + ' · 예정 ' + a.plan + ' · 완료 ' + a.done]
    ].map(function (t) { return '<div class="scc-tile"><div class="l">' + t[0] + '</div><div class="v">' + t[1] + '</div><div class="s">' + t[2] + '</div></div>'; }).join('');
    var bars = '<div class="scc-bars">' +
      barHtml('방문여부', list, effVisit, VISIT_OPTS, ['#94a3b8', '#3b82f6', '#10b981'], false) +
      barHtml('방문결과', list, function (r) { return r.visit_result; }, RESULT_OPTS, ['#38bdf8', '#f59e0b', '#fb923c', '#16a34a', '#6b7280'], true) +
      barHtml('예산확보여부', list, effBudget, BUDGET_OPTS, ['#16a34a', '#ef4444', '#94a3b8'], false) + '</div>';
    var gsel = '<select id="sccGroupBy">' + Object.keys(GROUPS).map(function (k) {
      return '<option value="' + k + '"' + (k === state.groupBy ? ' selected' : '') + '>' + GROUPS[k].label + '</option>';
    }).join('') + '</select>';
    el.innerHTML = '<div class="scc-tiles">' + tiles + '</div>' + bars +
      '<div class="scc-grids"><div><div class="scc-gt">집계 기준 ' + gsel + '</div>' + groupTable(list, state.groupBy) + '</div>' +
      '<div><div class="scc-gt">입력자(직원)별</div>' + staffTable(list) + '</div></div>';
  }

  /* ------------------------------------------------------------------ CSV */
  function exportCsv() {
    var head = ['연번', '교육지원청', '구', '학교명', '지사', '경비업체', '비고', '설치대수', '복도', '계단', '교문', '건물출입구',
      '급별', '설립별', '필수장소(개소)', '지원_CCTV(천원)', '지원_녹화기(천원)', '지원_모니터(천원)', '지원_기타(천원)', '지원_합계(천원)',
      '예산확보여부', '확보예산금액(천원)', '증설_카메라(대)', '증설_녹화장비(대)', '방문여부', '방문자', '방문결과', '견적제출금액(천원)', '최종수정자', '최종수정일시'];
    function c(v) { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    var lines = [head.join(',')].concat(state.rows.map(function (r) {
      return [r.seq != null ? r.seq : r.no, r.edu_office, r.district, r.school_name, r.branch, r.guard_company, r.guard_note, r.install_cnt, r.cnt_corridor, r.cnt_stairs,
        r.cnt_gate, r.cnt_entrance, r.school_level, r.found_type, r.sup_places, r.sup_cctv, r.sup_recorder, r.sup_monitor, r.sup_etc, r.sup_total, effBudget(r), effAmt(r), r.add_camera, r.add_recorder, effVisit(r), r.visitor, r.visit_result,
        r.quote_amount, r.updated_by, r.updated_at ? new Date(r.updated_at).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) : ''].map(c).join(',');
    }));
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var ymd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).replace(/-/g, '');
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '학교CCTV_현황_' + ymd + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // 테스트/디버그용 내부 노출 (화면 동작에는 영향 없음)
  window.__scc = { state: state, summarize: agg, levelOf: levelOf };
})();
