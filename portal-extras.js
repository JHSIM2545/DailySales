/**
 * 북서울지사 영업일보 포털 - 「부가기능」 (Admin.html / User.html 공용)
 *  - 상단 탭의 부가기능 아이콘 -> 풀다운 메뉴: 파일저장소 · 메모장 · 게시판 · 공지사항 · 계산기
 *  - 게시판: 제목 + 본문(텍스트/그림) + 댓글. 작성자 본인 / Master 만 수정·삭제
 *  - 공지사항: Master 가 작성·게시·내림. 일보를 열 때 팝업, "오늘 다시 보지않기" 지원
 *  - 메모장: 포스트잇. 작성자 본인이 로그인했을 때만 표시, 이동/크기/색상 저장
 *  - 데이터: portal_extras.sql 로 만든 portal_notices / portal_posts / portal_comments / portal_memos
 */
(function () {
  'use strict';
  if (window.__pxLoaded) return;
  window.__pxLoaded = true;

  var SUPABASE_URL = 'https://gpqlximhoqdybcewdfde.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_xUnGxyLCc5TB5nv4keVQVw__grqGJkP';
  var MAX_HTML = 3500000;           // 본문(그림 포함) 최대 글자수
  var COLORS = ['#fff176', '#ffab91', '#f48fb1', '#ce93d8', '#90caf9', '#80deea', '#a5d6a7', '#e0e0e0'];
  var DEF_COLOR = COLORS[0];

  /* ------------------------------------------------------------ 유틸 */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function h(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
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
  function isMaster() {
    var s = sess(); if (!s) return false;
    var r = String(s.role || '');
    return !!(s.isMaster || s.isMainMaster || r === '메인마스터' || r === '서브마스터' || r === 'master');
  }
  function fmtDate(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16);
    } catch (e) { return ''; }
  }
  function todayKst() { return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }); }
  function errMsg(e) {
    var m = (e && (e.message || e.details)) || String(e || '');
    if (e && (e.code === 'PGRST205' || e.code === '42P01' || /schema cache|does not exist|Could not find the table/i.test(m))) {
      return '부가기능 테이블이 아직 없습니다. portal_extras.sql 을 Supabase SQL Editor 에서 먼저 실행해 주세요.';
    }
    return '오류: ' + m;
  }

  /* ------------------------------------------------------------ 본문 정리(sanitize) */
  var ALLOW = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, STRIKE: 1, DEL: 1, BR: 1, P: 1, DIV: 1, SPAN: 1, UL: 1, OL: 1, LI: 1, IMG: 1,
    H3: 1, H4: 1, BLOCKQUOTE: 1, TABLE: 1, THEAD: 1, TBODY: 1, TR: 1, TD: 1, TH: 1, A: 1, HR: 1 };
  var DROP = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, LINK: 1, META: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, MATH: 1, FORM: 1, INPUT: 1, BUTTON: 1, TEXTAREA: 1, SELECT: 1 };
  var IMG_RE = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+\/=]+$/;
  function colorOk(v) { return /^(#[0-9a-f]{3,8}|rgba?\([\d\s,.%]+\)|[a-z]{3,20})$/i.test(v); }
  var STYLE_OK = {
    'font-family': function (v) { return /^[\w\s,'"\-ㄱ-힝]+$/.test(v); },
    'font-size': function (v) { return /^\d{1,2}(\.\d+)?px$/.test(v); },
    'color': colorOk, 'background-color': colorOk,
    'text-align': function (v) { return /^(left|right|center|justify)$/.test(v); },
    'line-height': function (v) { return /^\d+(\.\d+)?(px|%)?$/.test(v); },
    'margin': function (v) { return /^(\d+(\.\d+)?(px)?\s*){1,4}$/.test(v); },
    'margin-left': function (v) { return /^\d+(\.\d+)?(px)?$/.test(v); },
    'padding-left': function (v) { return /^\d+(\.\d+)?(px)?$/.test(v); },
    'font-weight': function (v) { return /^(bold|normal|\d{3})$/.test(v); },
    'font-style': function (v) { return /^(italic|normal)$/.test(v); },
    'text-decoration': function (v) { return /^(underline|line-through|none|\s)+$/.test(v); },
    'text-decoration-line': function (v) { return /^(underline|line-through|none|\s)+$/.test(v); }
  };
  function cleanStyle(st) {
    var out = [];
    String(st || '').split(';').forEach(function (d) {
      var i = d.indexOf(':'); if (i < 0) return;
      var k = d.slice(0, i).trim().toLowerCase(), v = d.slice(i + 1).trim().replace(/\s*!important\s*$/i, '');
      if (STYLE_OK[k] && STYLE_OK[k](v)) out.push(k + ':' + v);
    });
    return out.join(';');
  }
  function cleanNode(node) {
    var kids = Array.prototype.slice.call(node.childNodes);
    kids.forEach(function (c) {
      if (c.nodeType === 3) return;
      if (c.nodeType !== 1) { node.removeChild(c); return; }
      var t = c.tagName.toUpperCase();
      if (DROP[t]) { node.removeChild(c); return; }
      if (!ALLOW[t]) {                                   // 허용되지 않은 태그는 내용만 남김
        cleanNode(c);
        while (c.firstChild) node.insertBefore(c.firstChild, c);
        node.removeChild(c);
        return;
      }
      var keep = {};
      var st = cleanStyle(c.getAttribute('style'));
      if (st) keep.style = st;
      if (t === 'IMG') {
        var src = c.getAttribute('src') || '';
        if (!IMG_RE.test(src)) { node.removeChild(c); return; }
        keep.src = src;
        var w = parseInt(c.getAttribute('width'), 10);
        if (w >= 20 && w <= 3000) keep.width = String(w);
      } else if (t === 'A') {
        var hr = c.getAttribute('href') || '';
        if (/^(https?:\/\/|mailto:)/i.test(hr)) { keep.href = hr; keep.target = '_blank'; keep.rel = 'noopener noreferrer'; }
      } else if (t === 'TD' || t === 'TH') {
        ['colspan', 'rowspan'].forEach(function (n) {
          var v = parseInt(c.getAttribute(n), 10); if (v > 1 && v <= 30) keep[n] = String(v);
        });
      }
      while (c.attributes.length) c.removeAttribute(c.attributes[0].name);
      Object.keys(keep).forEach(function (k) { c.setAttribute(k, keep[k]); });
      if (t !== 'IMG') cleanNode(c);
    });
  }
  /* 포털 전체에 `* {font-family ... !important}` 가 걸려 있어 글꼴이 무시되므로, 지정 글꼴을 인라인 !important 로 다시 지정 */
  function applyFonts(root) {
    if (!root || !root.querySelectorAll) return;
    Array.prototype.forEach.call(root.querySelectorAll('[style*="font-family"]'), function (e) {
      var v = e.style.getPropertyValue('font-family');
      if (v && e.style.getPropertyPriority('font-family') !== 'important') e.style.setProperty('font-family', v, 'important');
    });
  }
  function sanitize(html) {
    var doc = new DOMParser().parseFromString('<body>' + String(html || ''), 'text/html');
    cleanNode(doc.body);
    return doc.body.innerHTML;
  }

  /* ------------------------------------------------------------ 스타일 */
  function injectStyle() {
    if (document.getElementById('px-style')) return;
    var css = [
      '#pxMenu{position:fixed;z-index:100001;background:#fff;border:1px solid #cfd6df;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.22);padding:6px;min-width:168px;font-family:inherit;}',
      '#pxMenu button{display:flex;align-items:center;gap:9px;width:100%;text-align:left;background:none;border:0;border-radius:7px;padding:9px 12px;font-size:14px;color:#1f2937;cursor:pointer;font-family:inherit;}',
      '#pxMenu button:hover{background:#eef3fa;}',
      '#pxMenu .ic{width:20px;text-align:center;font-size:15px;}',
      '.px-ov{position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;font-family:inherit;color:#1f2937;}',
      '.px-ov *{box-sizing:border-box;}',
      '.px-box{background:#fff;border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.35);max-width:96vw;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;}',
      '.px-box{position:relative;min-width:360px;min-height:220px;}',
      '.px-rh{position:absolute;z-index:8;touch-action:none;}',
      '.px-rh.r{right:-3px;top:0;bottom:12px;width:9px;cursor:ew-resize;}',
      '.px-rh.b{left:0;right:12px;bottom:-3px;height:9px;cursor:ns-resize;}',
      '.px-rh.rb{right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 52%,rgba(0,0,0,.4) 53%,rgba(0,0,0,.4) 60%,transparent 61%,transparent 70%,rgba(0,0,0,.4) 71%,rgba(0,0,0,.4) 78%,transparent 79%);}',
      '.px-box.px-max .px-rh{display:none;}',
      '.px-box.px-max{position:fixed !important;left:0 !important;top:0 !important;right:0 !important;bottom:0 !important;width:auto !important;height:auto !important;max-width:none !important;max-height:none !important;border-radius:0;resize:none;}',
      '.px-hd{cursor:move;user-select:none;}',
      '.px-hd .px-x{cursor:pointer;}',
      '.px-bd.px-fill{display:flex;flex-direction:column;overflow:hidden;}',
      '.px-bd.px-fill>.px-edwrap{flex:1;min-height:0;display:flex;flex-direction:column;}',
      '.px-edbox{flex:1;min-height:160px;position:relative;overflow:hidden;}',
      '.px-edbox>.px-ed{position:absolute;left:0;top:0;right:0;bottom:0;min-height:0;overflow:auto;}',
      '.px-hd{display:flex;align-items:center;gap:0;padding:0 0 0 16px;min-height:34px;background:var(--px-head,#1c2f4a);color:#fff;}',
      '.px-hd b{font-size:15px;font-weight:600;}',
      '.px-hd .sp,.px-bar .sp{flex:1;}',
      '.px-hd .px-x{background:none;border:0;color:#fff;cursor:default;width:46px;align-self:stretch;display:flex;align-items:center;justify-content:center;padding:0;margin:0;border-radius:0;outline:none;}',
      '.px-hd .px-x svg{display:block;pointer-events:none;}',
      '.px-hd .px-x:hover{background:rgba(255,255,255,.18);}',
      '.px-hd .px-x[data-a=cls]:hover{background:#e81123;}',
      '.px-hd .px-x[data-a=cls]:active{background:#f1707a;}',
      '.px-box,.px-box *{-webkit-user-select:none;user-select:none;}',
      '.px-box input,.px-box textarea,.px-box [contenteditable],.px-box [contenteditable] *,.px-box .px-content,.px-box .px-content *,.px-box .px-c .txt{-webkit-user-select:text;user-select:text;}',
      '.px-ov{overscroll-behavior:contain;}',
      '.px-bd{overscroll-behavior:contain;}',
      '.px-bd{padding:16px 18px;overflow:auto;flex:1;min-height:80px;}',
      '.px-bar{display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;}',
      '.px-b{background:#fff;border:1px solid #c3ccd8;border-radius:7px;padding:6px 13px;font-size:13px;font-weight:600;cursor:pointer;color:#1f2937;font-family:inherit;}',
      '.px-b:hover{background:#f0f4f9;}',
      '.px-b.pri{background:var(--px-head,#1c2f4a);border-color:var(--px-head,#1c2f4a);color:#fff;}',
      '.px-b.pri:hover{filter:brightness(1.15);}',
      '.px-b.danger{color:#b42318;border-color:#e3b3ae;}',
      '.px-b.sm{padding:3px 9px;font-size:12px;}',
      '.px-in{width:100%;border:1px solid #c3ccd8;border-radius:7px;padding:8px 10px;font-size:14px;font-family:inherit;}',
      '.px-tbl{width:100%;border-collapse:collapse;font-size:14px;}',
      '.px-tbl thead th{background:#eef1f5 !important;color:#1f2937 !important;border:0;border-bottom:2px solid #cfd6df;padding:9px 8px;text-align:center;font-size:13.5px;font-weight:700;}',
      '.px-tbl thead th.l{text-align:left !important;padding-left:14px;}',
      '.px-tbl tbody td{border:0;border-bottom:1px solid #e3e8ee;padding:10px 8px;text-align:center;color:#1f2937;background:transparent;font-size:14px;}',
      '.px-tbl tbody td.l{text-align:left !important;padding-left:14px;font-size:15px;font-weight:600;}',
      '.px-tbl tbody tr.cl{cursor:pointer;}',
      '.px-tbl tbody tr.cl:hover td{background:#f3f7fc;}',
      '.px-cnt{color:#c2410c;font-weight:700;margin-left:5px;font-size:12px;}',
      '.px-meta{color:#6b7280;font-size:13px;margin:4px 0 14px;}',
      '.px-content{border-top:1px solid #dfe5ec;border-bottom:1px solid #dfe5ec;padding:14px 4px;min-height:80px;line-height:1.6;font-size:14px;word-break:break-word;overflow-wrap:anywhere;}',
      '.px-content img,.px-ed img{max-width:100%;height:auto;display:block;margin:8px 0;}',
      '.px-content ul,.px-content ol,.px-ed ul,.px-ed ol{margin:6px 0 6px 22px;padding:0;}',
      '.px-cm{margin-top:18px;}',
      '.px-cm h4{margin:0 0 8px;font-size:14px;}',
      '.px-c{border:1px solid #e1e6ed;border-radius:8px;padding:8px 12px;margin-bottom:7px;background:#fafbfd;}',
      '.px-c .top{display:flex;align-items:center;gap:8px;font-size:12.5px;color:#6b7280;}',
      '.px-c .top b{color:#1f2937;font-size:13px;}',
      '.px-c .txt{white-space:pre-wrap;word-break:break-word;margin-top:4px;font-size:14px;}',
      '.px-tbs{position:sticky;top:-16px;z-index:6;background:#fff;padding-top:2px;}',
      '.px-tb{display:flex;flex-wrap:wrap;align-items:center;gap:2px;background:#f3f5f8;border:1px solid #d5dbe3;border-radius:7px 7px 0 0;padding:4px 6px;}',
      '.px-tb .g{display:flex;align-items:center;gap:1px;padding:0 6px;border-right:1px solid #d5dbe3;}',
      '.px-tb .g:last-child{border-right:0;}',
      '.px-tb button{min-width:30px;height:28px;border:0;background:none;border-radius:5px;cursor:pointer;color:#1f2937;font-size:14px;display:flex;align-items:center;justify-content:center;padding:0 4px;font-family:inherit;}',
      '.px-tb button:hover{background:#dfe6ef;}',
      '.px-tb select{height:28px;border:1px solid #d5dbe3;background:#fff;border-radius:5px;font-size:13px;font-family:inherit;max-width:140px;}',
      '.px-tb .clr{position:relative;}',
      '.px-tb .clr i{position:absolute;left:7px;right:7px;bottom:3px;height:3px;background:#000;}',
      '.px-tb .clr input{position:absolute;opacity:0;width:0;height:0;pointer-events:none;}',
      '.px-tb2{display:none;align-items:center;gap:6px;background:#fff8e1;border:1px solid #d5dbe3;border-top:0;padding:4px 8px;font-size:12.5px;flex-wrap:wrap;}',
      '.px-tb2 .px-b{padding:2px 9px;font-size:12px;}',
      '.px-tb2 input{width:52px;border:1px solid #c3ccd8;border-radius:5px;padding:2px 4px;font-size:13px;}',
      '.px-ed{border:1px solid #c3ccd8;border-top:0;border-radius:0 0 7px 7px;min-height:300px;padding:12px 14px;line-height:1.6;font-size:14px;outline:none;overflow-wrap:anywhere;}',
      '.px-ed:focus{border-color:#4b6fa5;}',
      '.px-ed:empty:before{content:attr(data-ph);color:#9aa4b2;}',
      '.px-ed table,.px-content table{border-collapse:collapse;margin:8px 0;width:100%;table-layout:fixed;}',
      '.px-ed td,.px-ed th,.px-content td,.px-content th{border:1px solid #9aa4b2;padding:6px 8px;min-width:40px;vertical-align:top;word-break:break-word;}',
      '.px-ed th,.px-content th{background:#eef1f5;}',
      '.px-ed a,.px-content a{color:#1d4ed8;text-decoration:underline;}',
      '.px-imgov{position:absolute;border:2px solid #2f7de1;pointer-events:none;z-index:4;display:none;}',
      '.px-imgrs{position:absolute;right:-8px;bottom:-8px;width:14px;height:14px;background:#2f7de1;border:2px solid #fff;border-radius:3px;cursor:nwse-resize;pointer-events:auto;touch-action:none;}',
      '.px-imgdel{position:absolute;right:4px;top:4px;background:#b42318;color:#fff;font-size:12px;padding:2px 8px;border-radius:5px;cursor:pointer;pointer-events:auto;}',
      '.px-err{padding:30px;text-align:center;color:#b42318;font-weight:600;}',
      '.px-load{padding:30px;text-align:center;color:#6b7280;}',
      '.px-badge{display:inline-block;border-radius:10px;padding:1px 9px;font-size:12px;font-weight:700;}',
      '.px-badge.on{background:#dcfce7;color:#166534;}',
      '.px-badge.off{background:#e5e7eb;color:#4b5563;}',
      '.px-nt{border:1px solid #dfe5ec;border-radius:10px;padding:12px 14px;margin-bottom:12px;}',
      '.px-nt h3{margin:0 0 8px;font-size:16px;}',
      '.px-ft{display:flex;align-items:center;gap:10px;padding:10px 18px;border-top:1px solid #dfe5ec;background:#f8fafc;}',
      '.px-ft label{display:flex;align-items:center;gap:6px;font-size:13.5px;cursor:pointer;}',
      '.px-lb{position:fixed;inset:0;z-index:100010;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;cursor:zoom-out;}',
      '.px-lb img{max-width:96vw;max-height:94vh;}',
      /* 포스트잇 */
      '.px-memo{position:fixed;z-index:5000;background:#fff176;box-shadow:2px 5px 12px rgba(0,0,0,.28);display:flex;flex-direction:column;font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;color:#2b2b2b;border-radius:2px 2px 2px 0;}',
      '.px-memo *{box-sizing:border-box;}',
      '.px-memo::after{content:"";position:absolute;left:0;bottom:0;width:26px;height:26px;pointer-events:none;background:linear-gradient(45deg,rgba(0,0,0,.30) 0,rgba(0,0,0,.10) 46%,rgba(255,255,255,.55) 50%,rgba(255,255,255,.0) 100%);}',
      '.px-pin{position:absolute;left:50%;top:-9px;width:18px;height:18px;margin-left:-9px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ff8a80,#d32f2f 55%,#8e1b1b);box-shadow:1px 3px 4px rgba(0,0,0,.4);pointer-events:none;z-index:2;}',
      '.px-mh{height:24px;flex:none;display:flex;align-items:center;justify-content:flex-end;gap:2px;padding:0 4px;cursor:move;touch-action:none;user-select:none;}',
      '.px-mh span{cursor:pointer;font-size:12px;opacity:.55;padding:1px 4px;border-radius:4px;line-height:1;}',
      '.px-mh span:hover{opacity:1;background:rgba(0,0,0,.12);}',
      '.px-mb{flex:1;overflow:hidden;padding:2px 12px 14px;font-size:13.5px;line-height:1.45;white-space:pre-wrap;word-break:break-word;cursor:pointer;position:relative;}',
      '.px-mb.empty{color:rgba(0,0,0,.4);}',
      '.px-more{position:absolute;right:6px;bottom:2px;font-size:11px;font-weight:700;color:rgba(0,0,0,.5);pointer-events:none;}',
      '.px-rs{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;touch-action:none;background:linear-gradient(135deg,transparent 55%,rgba(0,0,0,.35) 56%,rgba(0,0,0,.35) 62%,transparent 63%,transparent 72%,rgba(0,0,0,.35) 73%,rgba(0,0,0,.35) 79%,transparent 80%);}',
      '.px-pal{position:absolute;top:26px;right:2px;z-index:3;background:#fff;border:1px solid #ccc;border-radius:8px;padding:6px;display:flex;gap:5px;box-shadow:0 4px 12px rgba(0,0,0,.25);}',
      '.px-sw{width:20px;height:20px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px #aaa;cursor:pointer;display:inline-block;}',
      '.px-sw.sel{box-shadow:0 0 0 2px #1c2f4a;}',
      '.px-mt{width:100%;height:300px;border:1px solid rgba(0,0,0,.2);border-radius:6px;padding:10px;font-size:14.5px;line-height:1.5;font-family:inherit;resize:vertical;}',
      '.px-mrow{display:flex;align-items:center;gap:8px;padding:7px 4px;border-bottom:1px solid #e5e9ef;}',
      '.px-mrow .chip{width:16px;height:16px;border-radius:4px;border:1px solid rgba(0,0,0,.3);flex:none;}',
      '.px-mrow .tx{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;}'
    ].join('\n');
    var st = h('style'); st.id = 'px-style'; st.textContent = css;
    document.head.appendChild(st);
  }
  function themeColor() {
    try {
      var tb = document.querySelector('.topbar');
      if (tb) { var c = getComputedStyle(tb).backgroundColor; if (c && c !== 'rgba(0, 0, 0, 0)') return c; }
    } catch (e) { /* noop */ }
    return '#1c2f4a';
  }

  /* ------------------------------------------------------------ 모달 */
  /* 윈도우 캡션 버튼 아이콘 (최대화 / 이전 크기로 복원 / 닫기) */
  var CAP_MAX = '<svg width="10" height="10" viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor"/></svg>';
  var CAP_RST = '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2.5 2.5V.5h7v7h-2" fill="none" stroke="currentColor"/><rect x=".5" y="2.5" width="7" height="7" fill="none" stroke="currentColor"/></svg>';
  var CAP_CLS = '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0L10 10M10 0L0 10" fill="none" stroke="currentColor"/></svg>';

  /* 팝업이 떠 있는 동안: 뒤 화면 스크롤 잠금 + 포커스를 팝업 안에 고정 */
  var pxLockN = 0, pxPrevOv = null, pxBound = false;
  function pxTop() { var a = document.querySelectorAll('.px-ov'); return a.length ? a[a.length - 1] : null; }
  function pxLock() {
    if (pxLockN++ === 0) {
      pxPrevOv = [document.body.style.overflow, document.documentElement.style.overflow];
      document.body.style.overflow = 'hidden'; document.documentElement.style.overflow = 'hidden';
    }
    if (pxBound) return; pxBound = true;
    document.addEventListener('focusin', function (e) {
      var t = pxTop(); if (!t) return;
      if (e.target.closest && e.target.closest('.px-ov')) return;
      var b = t.querySelector('.px-box'); if (b) b.focus({ preventScroll: true });
    }, true);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var t = pxTop(); if (!t) return;
      var f = Array.prototype.filter.call(t.querySelectorAll('button:not(:disabled),input:not([type=hidden]):not([type=file]),textarea,select,[contenteditable=true]'), function (x) { return x.offsetParent !== null; });
      if (!f.length) return;
      var i = f.indexOf(document.activeElement);
      e.preventDefault();
      f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus({ preventScroll: true });
    }, true);
  }
  function pxUnlock() {
    if (--pxLockN > 0) return;
    pxLockN = 0;
    if (pxPrevOv) { document.body.style.overflow = pxPrevOv[0]; document.documentElement.style.overflow = pxPrevOv[1]; pxPrevOv = null; }
  }
  function pxCanScroll(el, stop, dy) {
    for (; el && el !== stop; el = el.parentElement) {
      var oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
        if (dy < 0 && el.scrollTop > 0) return true;
        if (dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
      }
    }
    return false;
  }

  function modal(opt) {
    injectStyle();
    var ov = h('div', 'px-ov');
    ov.style.setProperty('--px-head', themeColor());
    var box = h('div', 'px-box');
    box.style.width = (opt.w || 720) + 'px';
    var hd = h('div', 'px-hd', '<b></b><span class="sp"></span><button class="px-x" type="button" data-a="max" title="최대화" aria-label="최대화">' + CAP_MAX + '</button><button class="px-x" type="button" data-a="cls" title="닫기" aria-label="닫기">' + CAP_CLS + '</button>');
    hd.querySelector('b').textContent = opt.title || '';
    var bd = h('div', 'px-bd');
    box.appendChild(hd); box.appendChild(bd);
    ov.appendChild(box);
    document.body.appendChild(ov);
    pxLock();
    box.setAttribute('tabindex', '-1'); box.style.outline = 'none';
    try { box.focus({ preventScroll: true }); } catch (e) { /* noop */ }
    ov.addEventListener('wheel', function (e) { if (!pxCanScroll(e.target, ov, e.deltaY)) e.preventDefault(); }, { passive: false });
    ov.addEventListener('touchmove', function (e) { if (!pxCanScroll(e.target, ov, 1) && !pxCanScroll(e.target, ov, -1)) e.preventDefault(); }, { passive: false });
    ov.addEventListener('mousedown', function (e) { if (!box.contains(e.target)) e.preventDefault(); });
    var m = { ov: ov, box: box, body: bd, closed: false };
    m.close = function () {
      if (m.closed) return;
      m.closed = true;
      pxUnlock();
      if (ov.parentNode) ov.parentNode.removeChild(ov);
      if (opt.onClose) opt.onClose();
    };
    hd.querySelector('[data-a=cls]').addEventListener('click', m.close);

    /* 이동 · 전체화면 · 크기 조절 */
    function detach() {                               // 가운데 정렬 상태 -> 자유 위치(fixed)
      if (box.getAttribute('data-free')) return;
      var r = box.getBoundingClientRect();
      box.setAttribute('data-free', '1');
      box.style.position = 'fixed'; box.style.left = r.left + 'px'; box.style.top = r.top + 'px';
      box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
      box.style.maxWidth = 'none'; box.style.maxHeight = 'none';
    }
    function toggleMax() {
      detach(); box.classList.toggle('px-max');
      var on = box.classList.contains('px-max'), mb = hd.querySelector('[data-a=max]');
      mb.innerHTML = on ? CAP_RST : CAP_MAX; mb.title = on ? '이전 크기로 복원' : '최대화'; mb.setAttribute('aria-label', mb.title);
    }
    hd.querySelector('[data-a=max]').addEventListener('click', toggleMax);
    hd.addEventListener('dblclick', function (e) { if (!e.target.closest('button')) toggleMax(); });
    var dr = null;
    hd.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button') || box.classList.contains('px-max')) return;
      detach();
      dr = { sx: e.clientX, sy: e.clientY, l: parseFloat(box.style.left) || 0, t: parseFloat(box.style.top) || 0 };
      hd.setPointerCapture(e.pointerId); e.preventDefault();
    });
    hd.addEventListener('pointermove', function (e) {
      if (!dr) return;
      var w = box.offsetWidth, vw = window.innerWidth, vh = window.innerHeight;
      var l = Math.min(Math.max(dr.l + e.clientX - dr.sx, 80 - w), vw - 80);
      var t = Math.min(Math.max(dr.t + e.clientY - dr.sy, 0), vh - 40);
      box.style.left = l + 'px'; box.style.top = t + 'px';
    });
    function endDr() { dr = null; }
    hd.addEventListener('pointerup', endDr); hd.addEventListener('pointercancel', endDr);
    ['r', 'b', 'rb'].forEach(function (k) {                       // 크기 조절 손잡이 (오른쪽 / 아래 / 모서리)
      var hdl = h('div', 'px-rh ' + k); box.appendChild(hdl);
      var st = null;
      hdl.addEventListener('pointerdown', function (e) {
        detach();
        st = { sx: e.clientX, sy: e.clientY, w: box.offsetWidth, h: box.offsetHeight };
        hdl.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation();
      });
      hdl.addEventListener('pointermove', function (e) {
        if (!st) return;
        var l = parseFloat(box.style.left) || 0, t = parseFloat(box.style.top) || 0;
        if (k !== 'b') box.style.width = Math.min(Math.max(360, st.w + e.clientX - st.sx), Math.max(360, window.innerWidth - l)) + 'px';
        if (k !== 'r') box.style.height = Math.min(Math.max(220, st.h + e.clientY - st.sy), Math.max(220, window.innerHeight - t)) + 'px';
      });
      function endR() { st = null; }
      hdl.addEventListener('pointerup', endR); hdl.addEventListener('pointercancel', endR);
    });
    return m;
  }
  function bindZoom() { /* 그림 클릭 확대 기능 없음 */ }

  /* ------------------------------------------------------------ 글 편집기 (텍스트 + 그림) */
  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error('그림을 읽지 못했습니다.')); };
      fr.onload = function () {
        if (/gif$/i.test(file.type) && file.size < 1500000) { resolve(fr.result); return; }
        var im = new Image();
        im.onerror = function () { reject(new Error('그림 형식을 읽지 못했습니다.')); };
        im.onload = function () {
          var MAXS = 1280, w = im.naturalWidth, hh = im.naturalHeight, k = Math.min(1, MAXS / Math.max(w, hh));
          var cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(hh * k));
          var cx = cv.getContext('2d');
          cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
          cx.drawImage(im, 0, 0, cv.width, cv.height);
          resolve(cv.toDataURL('image/jpeg', 0.82));
        };
        im.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  var FONTS = ['굴림', '돋움', '바탕', '궁서', '맑은 고딕', '나눔고딕', 'Arial', 'Times New Roman', 'Courier New'];
  var SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 24, 28, 32, 36];
  var LHS = ['1.0', '1.2', '1.4', '1.6', '1.8', '2.0', '2.5'];
  function svgIc(inner) { return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>'; }
  var IC = {
    left: svgIc('<path d="M2 3h12M2 6.5h8M2 10h12M2 13.5h8"/>'),
    center: svgIc('<path d="M2 3h12M4 6.5h8M2 10h12M4 13.5h8"/>'),
    right: svgIc('<path d="M2 3h12M6 6.5h8M2 10h12M6 13.5h8"/>'),
    ul: svgIc('<path d="M6 3.5h8M6 8h8M6 12.5h8"/><circle cx="2.6" cy="3.5" r=".6"/><circle cx="2.6" cy="8" r=".6"/><circle cx="2.6" cy="12.5" r=".6"/>'),
    out: svgIc('<path d="M7 3h7M7 8h7M7 13h7M5 5.2L2.4 8 5 10.8"/>'),
    ind: svgIc('<path d="M7 3h7M7 8h7M7 13h7M2.4 5.2L5 8l-2.6 2.8"/>'),
    link: svgIc('<path d="M6.8 9.2a3 3 0 0 0 4.2 0l2.2-2.2a3 3 0 0 0-4.2-4.2L8 3.8M9.2 6.8a3 3 0 0 0-4.2 0L2.8 9a3 3 0 0 0 4.2 4.2L8 12.2"/>'),
    tbl: svgIc('<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2 6.6h12M2 9.9h12M6 3v10M10 3v10"/>'),
    img: svgIc('<rect x="2" y="3" width="12" height="10" rx="1.2"/><circle cx="5.6" cy="6.4" r="1.1"/><path d="M2.5 12l3.6-3.4 2.6 2.4 2-1.6 3.3 2.8"/>')
  };

  var localFonts = null;
  try { localFonts = JSON.parse(localStorage.getItem('px_local_fonts_v1') || 'null'); } catch (e) { localFonts = null; }
  function canLocalFonts() { return typeof window.queryLocalFonts === 'function'; }
  function fontList() { return FONTS.concat((localFonts || []).filter(function (f) { return FONTS.indexOf(f) < 0; })); }
  function loadLocalFonts() {
    if (!canLocalFonts()) return Promise.reject(new Error('이 브라우저는 PC 글꼴 목록 접근을 지원하지 않습니다.'));
    return window.queryLocalFonts().then(function (arr) {
      var set = {};
      arr.forEach(function (f) { if (f.family) set[f.family] = 1; });
      localFonts = Object.keys(set).sort(function (a, b) { return a.localeCompare(b, 'ko'); });
      try { localStorage.setItem('px_local_fonts_v1', JSON.stringify(localFonts)); } catch (e) { /* noop */ }
      return localFonts.length;
    });
  }

  function makeEditor(initialHtml) {
    var wrap = h('div', 'px-edwrap'); wrap.style.position = 'relative';
    var tbs = h('div', 'px-tbs');
    var tb = h('div', 'px-tb');
    var tb2 = h('div', 'px-tb2');                 // 표 도구 / 표 삽입
    tbs.appendChild(tb); tbs.appendChild(tb2);
    var ed = h('div', 'px-ed');
    ed.contentEditable = 'true';
    ed.setAttribute('data-ph', '내용을 입력하세요. 그림은 [그림] 버튼, 붙여넣기(Ctrl+V), 끌어놓기로 넣을 수 있습니다.');
    ed.innerHTML = sanitize(initialHtml || ''); applyFonts(ed);
    ed.setAttribute('lang', 'ko');
    var fi = h('input'); fi.type = 'file'; fi.accept = 'image/*'; fi.multiple = true; fi.style.display = 'none';
    var range = null, selImg = null;

    /* ---- 선택영역 기억/복원 (select, 색상창 등으로 포커스가 옮겨가도 적용되게) */
    function onSel() {
      if (!wrap.isConnected) { document.removeEventListener('selectionchange', onSel); return; }
      var s = window.getSelection();
      if (s && s.rangeCount && ed.contains(s.anchorNode)) { range = s.getRangeAt(0).cloneRange(); updateTableBar(); }
    }
    document.addEventListener('selectionchange', onSel);
    ed.addEventListener('click', function () { setTimeout(onSel, 0); });
    ed.addEventListener('keyup', onSel);
    function restore() {
      ed.focus();
      var s = window.getSelection();
      if (range && ed.contains(range.startContainer)) { s.removeAllRanges(); s.addRange(range); }
      else { var r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); s.removeAllRanges(); s.addRange(r); }
    }
    function exec(cmd, val, noCss) {
      restore();
      try { document.execCommand('styleWithCSS', false, !noCss); } catch (e) { /* noop */ }
      try { document.execCommand(cmd, false, val == null ? null : val); } catch (e) { /* noop */ }
      applyFonts(ed);
      onSel();
    }

    /* ---- 툴바 */
    function group() { var g = h('div', 'g'); tb.appendChild(g); return g; }
    function btn(g, label, title, fn) {
      var b = h('button'); b.type = 'button'; b.innerHTML = label; b.title = title;
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.addEventListener('click', fn);
      g.appendChild(b); return b;
    }
    function dd(g, title, first, opts, fn) {
      var s = h('select'); s.title = title;
      s.innerHTML = '<option value="">' + first + '</option>' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>'; }).join('');
      s.addEventListener('change', function () { var v = s.value; s.selectedIndex = 0; if (v) fn(v); });
      g.appendChild(s); return s;
    }
    function colorBtn(g, label, title, init, fn) {
      var b = h('button', 'clr'); b.type = 'button'; b.title = title;
      b.innerHTML = label + '<i></i><input type="color">';
      var inp = b.querySelector('input'), bar = b.querySelector('i');
      inp.value = init; bar.style.background = init;
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.addEventListener('click', function () { inp.click(); });
      inp.addEventListener('input', function () { bar.style.background = inp.value; fn(inp.value); });
      g.appendChild(b);
    }
    var g1 = group();
    var fsel = h('select'); fsel.title = '글꼴 (내 PC에 설치된 글꼴 사용 가능)'; g1.appendChild(fsel);
    function fillFonts() {
      fsel.innerHTML = '<option value="">글꼴</option>';
      if (canLocalFonts() && !localFonts) fsel.innerHTML += '<option value="__local__">💻 내 PC 글꼴 불러오기…</option>';
      fontList().forEach(function (f) {
        var o = document.createElement('option'); o.value = f; o.textContent = f;
        o.style.setProperty('font-family', '"' + f.replace(/"/g, '') + '", sans-serif', 'important');
        fsel.appendChild(o);
      });
    }
    fillFonts();
    fsel.addEventListener('change', function () {
      var v = fsel.value; fsel.selectedIndex = 0;
      if (!v) return;
      if (v === '__local__') {
        loadLocalFonts().then(function (n) { fillFonts(); alert('내 PC에 설치된 글꼴 ' + n + '개를 불러왔습니다. 글꼴 목록에서 선택하세요.'); })
          .catch(function (e) { alert('글꼴을 불러오지 못했습니다.\n(브라우저의 글꼴 접근 권한을 허용해야 하며, Chrome/Edge 에서만 지원됩니다)\n' + ((e && e.message) || '')); });
        return;
      }
      exec('fontName', v);
    });
    dd(g1, '글자 크기', '크기', SIZES.map(function (n) { return [n, n + 'px']; }), function (v) {
      exec('fontSize', '7', true);                                      // font size=7 → px 지정 span 으로 치환
      Array.prototype.forEach.call(ed.querySelectorAll('font[size="7"]'), function (f) {
        var sp = document.createElement('span'); sp.style.fontSize = v + 'px';
        while (f.firstChild) sp.appendChild(f.firstChild);
        f.parentNode.replaceChild(sp, f);
      });
    });
    var g2 = group();
    btn(g2, '<b>B</b>', '굵게', function () { exec('bold'); });
    btn(g2, '<i style="font-family:serif">I</i>', '기울임', function () { exec('italic'); });
    btn(g2, '<u>U</u>', '밑줄', function () { exec('underline'); });
    btn(g2, '<s>S</s>', '취소선', function () { exec('strikeThrough'); });
    colorBtn(g2, '<span style="font-weight:700">T</span>', '글자 색', '#000000', function (v) { exec('foreColor', v); });
    colorBtn(g2, '<span style="font-weight:700;border:1px solid #555;padding:0 3px;line-height:15px">T</span>', '배경(형광펜) 색', '#ffff00', function (v) { exec('hiliteColor', v); });
    var g3 = group();
    btn(g3, IC.left, '왼쪽 정렬', function () { exec('justifyLeft'); });
    btn(g3, IC.center, '가운데 정렬', function () { exec('justifyCenter'); });
    btn(g3, IC.right, '오른쪽 정렬', function () { exec('justifyRight'); });
    btn(g3, IC.ul, '글머리 기호', function () { exec('insertUnorderedList'); });
    btn(g3, '1.', '번호 목록', function () { exec('insertOrderedList'); });
    btn(g3, IC.out, '내어쓰기', function () { exec('outdent'); });
    btn(g3, IC.ind, '들여쓰기', function () { exec('indent'); });
    dd(g3, '줄 간격', '줄간격', LHS.map(function (v) { return [v, v]; }), function (v) { applyLineHeight(v); });
    btn(g3, '<span style="font-style:italic;text-decoration:line-through">T</span><sub style="font-size:9px">x</sub>', '서식 지우기', function () { exec('removeFormat'); });
    var g4 = group();
    btn(g4, '※', '특수문자 ※ 넣기', function () { exec('insertText', '※ '); });
    btn(g4, IC.link, '링크', function () {
      var u = prompt('링크 주소를 입력하세요 (예: https://...)', 'https://');
      if (!u || u === 'https://') return;
      if (!/^(https?:\/\/|mailto:)/i.test(u)) u = 'https://' + u;
      exec('createLink', u);
    });
    btn(g4, IC.tbl, '표 넣기', function () { showTableInsert(); });
    btn(g4, IC.img, '그림 넣기', function () { fi.click(); });

    function applyLineHeight(v) {
      restore();
      var s = window.getSelection(); if (!s.rangeCount) return;
      var r = s.getRangeAt(0), q = 'div,p,li,h3,h4,blockquote,td,th';
      function leaves() {
        return Array.prototype.filter.call(ed.querySelectorAll(q), function (b) { return r.intersectsNode(b) && !b.querySelector(q); });
      }
      var list = leaves();
      if (!list.length) { exec('formatBlock', 'div'); s = window.getSelection(); if (s.rangeCount) { r = s.getRangeAt(0); list = leaves(); } }
      if (!list.length) ed.style.lineHeight = v;
      list.forEach(function (b) { b.style.lineHeight = v; });
    }

    /* ---- 표 */
    function curCell() {
      var s = window.getSelection();
      var n = s && s.anchorNode; if (!n || !ed.contains(n)) return null;
      if (n.nodeType === 1 && n.childNodes[s.anchorOffset]) n = n.childNodes[s.anchorOffset];   // 빈 칸 클릭 시 anchor 가 TR 인 경우
      if (n.nodeType === 3) n = n.parentNode;
      return n.closest ? n.closest('td,th') : null;
    }
    function showTableInsert() {
      tb2.style.display = 'flex'; tb2.setAttribute('data-mode', 'ins');
      tb2.innerHTML = '<b>표 넣기</b> 행 <input type="number" id="pxTr" min="1" max="30" value="3"> 열 <input type="number" id="pxTc" min="1" max="10" value="3"> ' +
        '<button class="px-b sm pri" type="button" id="pxTo">삽입</button><button class="px-b sm" type="button" id="pxTx">닫기</button>';
      tb2.querySelector('#pxTx').addEventListener('click', function () { tb2.setAttribute('data-mode', ''); updateTableBar(); });
      tb2.querySelector('#pxTo').addEventListener('click', function () {
        var R = Math.max(1, Math.min(30, parseInt(tb2.querySelector('#pxTr').value, 10) || 3));
        var C = Math.max(1, Math.min(10, parseInt(tb2.querySelector('#pxTc').value, 10) || 3));
        var html = '<table><tbody>' + new Array(R + 1).join('<tr>' + new Array(C + 1).join('<td><br></td>') + '</tr>') + '</tbody></table><div><br></div>';
        restore();
        try { document.execCommand('insertHTML', false, html); } catch (e) { /* noop */ }
        tb2.setAttribute('data-mode', ''); updateTableBar();
      });
    }
    function updateTableBar() {
      if (tb2.getAttribute('data-mode') === 'ins') return;
      var c = curCell();
      if (!c) { tb2.setAttribute('data-mode', ''); tb2.style.display = 'none'; tb2.innerHTML = ''; return; }
      if (tb2.getAttribute('data-mode') === 'tools') return;
      tb2.setAttribute('data-mode', 'tools'); tb2.style.display = 'flex';
      tb2.innerHTML = '<b>표</b><button class="px-b sm" data-t="ra" type="button">행 추가</button><button class="px-b sm" data-t="rd" type="button">행 삭제</button>' +
        '<button class="px-b sm" data-t="ca" type="button">열 추가</button><button class="px-b sm" data-t="cd" type="button">열 삭제</button>' +
        '<button class="px-b sm danger" data-t="td" type="button">표 삭제</button>';
      Array.prototype.forEach.call(tb2.querySelectorAll('button'), function (b) {
        b.addEventListener('mousedown', function (e) { e.preventDefault(); });
        b.addEventListener('click', function () { tableOp(b.getAttribute('data-t')); });
      });
    }
    function tableOp(op) {
      var c = curCell(); if (!c) return;
      var tr = c.parentNode, table = c.closest('table'), idx = Array.prototype.indexOf.call(tr.children, c);
      if (op === 'ra') {
        var nr = tr.cloneNode(true);
        Array.prototype.forEach.call(nr.children, function (x) { x.innerHTML = '<br>'; });
        tr.parentNode.insertBefore(nr, tr.nextSibling);
      } else if (op === 'rd') {
        if (table.rows.length <= 1) table.parentNode.removeChild(table); else tr.parentNode.removeChild(tr);
      } else if (op === 'ca') {
        Array.prototype.forEach.call(table.rows, function (r) {
          var ref = r.children[idx], nc = document.createElement(ref ? ref.tagName : 'td'); nc.innerHTML = '<br>';
          r.insertBefore(nc, ref ? ref.nextSibling : null);
        });
      } else if (op === 'cd') {
        if (tr.children.length <= 1) table.parentNode.removeChild(table);
        else Array.prototype.forEach.call(table.rows, function (r) { if (r.children[idx]) r.removeChild(r.children[idx]); });
      } else if (op === 'td') {
        table.parentNode.removeChild(table);
      }
      tb2.setAttribute('data-mode', ''); tb2.style.display = 'none'; tb2.innerHTML = '';
      range = null; placeOv();
    }

    /* ---- 그림: 선택 / 크기 조절 / 삭제 */
    var ov = h('div', 'px-imgov', '<span class="px-imgdel" title="그림 삭제">✕ 삭제</span><span class="px-imgrs" title="끌어서 크기 조절"></span>');
    function placeOv() {
      if (!selImg || !selImg.isConnected || !ed.contains(selImg)) { selImg = null; ov.style.display = 'none'; return; }
      var r = selImg.getBoundingClientRect(), w = ed.parentNode ? ed.parentNode.getBoundingClientRect() : wrap.getBoundingClientRect();
      ov.style.display = 'block';
      ov.style.left = (r.left - w.left) + 'px'; ov.style.top = (r.top - w.top) + 'px';
      ov.style.width = r.width + 'px'; ov.style.height = r.height + 'px';
    }
    function removeSelImg() {
      if (!selImg) return;
      selImg.parentNode.removeChild(selImg); selImg = null; placeOv();
      ed.focus();
    }
    ov.querySelector('.px-imgdel').addEventListener('click', removeSelImg);
    var rz = null, rsh = ov.querySelector('.px-imgrs');
    rsh.addEventListener('pointerdown', function (e) {
      if (!selImg) return;
      rz = { sx: e.clientX, w: selImg.getBoundingClientRect().width };
      rsh.setPointerCapture(e.pointerId); e.preventDefault();
    });
    rsh.addEventListener('pointermove', function (e) {
      if (!rz || !selImg) return;
      var maxW = Math.max(40, ed.clientWidth - 30);
      var nw = Math.min(maxW, Math.max(30, rz.w + e.clientX - rz.sx));
      selImg.setAttribute('width', String(Math.round(nw)));
      placeOv();
    });
    function endRz() { rz = null; }
    rsh.addEventListener('pointerup', endRz); rsh.addEventListener('pointercancel', endRz);
    ed.addEventListener('click', function (e) {
      selImg = (e.target && e.target.tagName === 'IMG') ? e.target : null;
      placeOv();
    });
    ed.addEventListener('keydown', function (e) {
      if (selImg && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); removeSelImg(); return; }
      if (selImg && e.key.length === 1 && !e.ctrlKey && !e.metaKey) { selImg = null; placeOv(); }
    });
    ed.addEventListener('input', function () { applyFonts(ed); placeOv(); });
    window.addEventListener('resize', placeOv);

    /* ---- 그림 넣기: 파일 / 붙여넣기 / 끌어놓기 */
    function addFiles(files) {
      var list = Array.prototype.filter.call(files || [], function (f) { return /^image\//.test(f.type); });
      list.reduce(function (p, f) {
        return p.then(function () {
          return compressImage(f).then(function (url) {
            restore();
            try { document.execCommand('insertImage', false, url); } catch (e) { /* noop */ }
          });
        });
      }, Promise.resolve()).then(placeOv).catch(function (e) { alert(e.message || e); });
    }
    fi.addEventListener('change', function () { addFiles(fi.files); fi.value = ''; });
    ed.addEventListener('paste', function (e) {
      var cd = e.clipboardData; if (!cd) return;
      var imgs = Array.prototype.filter.call(cd.files || [], function (f) { return /^image\//.test(f.type); });
      if (!imgs.length && cd.items) {
        Array.prototype.forEach.call(cd.items, function (it) { if (it.kind === 'file' && /^image\//.test(it.type)) { var f = it.getAsFile(); if (f) imgs.push(f); } });
      }
      e.preventDefault();
      if (imgs.length) { addFiles(imgs); return; }
      var t = cd.getData('text/plain');
      if (t) { try { document.execCommand('insertText', false, t); } catch (x) { /* noop */ } }
    });
    ed.addEventListener('dragover', function (e) { e.preventDefault(); });
    ed.addEventListener('drop', function (e) {
      var fs = e.dataTransfer && e.dataTransfer.files;
      if (fs && fs.length) { e.preventDefault(); addFiles(fs); }
    });

    var edbox = h('div', 'px-edbox'); edbox.appendChild(ed); edbox.appendChild(ov);
    wrap.appendChild(tbs); wrap.appendChild(edbox); wrap.appendChild(fi);
    ed.addEventListener('scroll', placeOv);
    return {
      el: wrap, node: ed,
      getHtml: function () { return sanitize(ed.innerHTML).replace(/^(<br>|\s)+|(<br>|\s)+$/g, ''); },
      isEmpty: function () { return !ed.querySelector('img,table') && !ed.textContent.trim(); }
    };
  }

  /* ------------------------------------------------------------ 게시판 첨부파일 (모든 형식) */
  var ATT_MAX_BYTES = 30 * 1024 * 1024;
  function fmtSize(n) { n = Number(n) || 0; return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
  function attMetaKey(postId) { return 'POST_FILES_' + postId; }
  function attLoad(postId) {
    return db().from('system_settings').select('setting_value').eq('setting_key', attMetaKey(postId)).maybeSingle().then(function (r) {
      if (r.error) throw r.error;
      if (!r.data || !r.data.setting_value) return [];
      try { var l = JSON.parse(r.data.setting_value); return Array.isArray(l) ? l : []; } catch (e) { return []; }
    });
  }
  function attLoadCounts() {
    return db().from('system_settings').select('setting_key,setting_value').like('setting_key', 'POST_FILES\\_%').then(function (r) {
      var m = {};
      if (r.error) return m;
      (r.data || []).forEach(function (row) {
        try { var l = JSON.parse(row.setting_value); if (l && l.length) m[row.setting_key.replace('POST_FILES_', '')] = l.length; } catch (e) { /* noop */ }
      });
      return m;
    }, function () { return {}; });
  }
  function attDeleteData(id) {
    return db().from('system_settings').delete().eq('setting_key', 'FILE_DATA_' + id).then(function () {
      return db().from('system_settings').delete().like('setting_key', 'FILE_DATA_' + id + '\\_\\_%');
    });
  }
  function attSaveMeta(postId, list) {
    var q = list.length
      ? db().from('system_settings').upsert({ setting_key: attMetaKey(postId), setting_value: JSON.stringify(list) })
      : db().from('system_settings').delete().eq('setting_key', attMetaKey(postId));
    return q.then(function (r) { if (r.error) throw r.error; });
  }
  async function attWriteData(id, du) {
    var CH = 400000, parts = [];
    for (var p = 0; p < du.length; p += CH) parts.push(du.slice(p, p + CH));
    if (parts.length <= 1) {
      var r0 = await db().from('system_settings').upsert({ setting_key: 'FILE_DATA_' + id, setting_value: du });
      if (r0.error) throw r0.error;
      return;
    }
    for (var i = 0; i < parts.length; i += 4) {
      var batch = parts.slice(i, i + 4).map(function (pt, j) {
        return db().from('system_settings').upsert({ setting_key: 'FILE_DATA_' + id + '__' + (i + j), setting_value: pt });
      });
      var rs = await Promise.all(batch);
      for (var k = 0; k < rs.length; k++) if (rs[k].error) throw rs[k].error;
    }
    var rm = await db().from('system_settings').upsert({ setting_key: 'FILE_DATA_' + id, setting_value: '__CHUNKED__:' + parts.length + ':' + du.length });
    if (rm.error) throw rm.error;
  }
  async function attReadData(id) {
    var r = await db().from('system_settings').select('setting_value').eq('setting_key', 'FILE_DATA_' + id).maybeSingle();
    if (r.error) throw r.error;
    if (!r.data || r.data.setting_value == null) throw new Error('첨부파일 본문이 없습니다.');
    var sv = String(r.data.setting_value);
    if (sv.indexOf('__CHUNKED__:') !== 0) return sv;
    var f = sv.split(':'), n = Number(f[1]) || 0, expLen = Number(f[2]) || 0, got = new Array(n);
    for (var i = 0; i < n; i += 10) {
      var keys = []; for (var k = i; k < Math.min(n, i + 10); k++) keys.push('FILE_DATA_' + id + '__' + k);
      var rr = await db().from('system_settings').select('setting_key,setting_value').in('setting_key', keys);
      if (rr.error) throw rr.error;
      (rr.data || []).forEach(function (row) { got[Number(row.setting_key.split('__').pop())] = row.setting_value; });
    }
    for (var q = 0; q < n; q++) if (got[q] == null) throw new Error('첨부파일 조각 ' + (q + 1) + '/' + n + ' 이(가) 없습니다.');
    var acc = got.join('');
    if (expLen && acc.length !== expLen) throw new Error('첨부파일 길이 불일치(' + acc.length + '/' + expLen + ')');
    return acc;
  }
  function readAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result || '')); };
      fr.onerror = function () { reject(new Error('파일을 읽지 못했습니다: ' + file.name)); };
      fr.readAsDataURL(file);
    });
  }
  function downloadDataUrl(du, name) {
    var url = du, revoke = false;
    try {
      var ci = du.indexOf(',');
      if (du.indexOf('data:') === 0 && ci > 0) {
        var head = du.slice(5, ci), body = du.slice(ci + 1);
        var raw = /;base64/i.test(head) ? atob(body) : decodeURIComponent(body);
        var bytes = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        url = URL.createObjectURL(new Blob([bytes], { type: head.split(';')[0] || 'application/octet-stream' }));
        revoke = true;
      }
    } catch (e) { /* data URL 그대로 사용 */ }
    var a = document.createElement('a'); a.href = url; a.download = name || 'download';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    if (revoke) setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) { /* noop */ } }, 60000);
  }
  function attDownload(meta, btn) {
    var old = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '불러오는 중…'; }
    return attReadData(meta.id).then(function (du) {
      if (meta.dataLen && du.length !== Number(meta.dataLen)) throw new Error('파일 길이 불일치');
      downloadDataUrl(du, meta.name);
    }).catch(function (e) { alert('첨부파일 다운로드 실패 [' + meta.name + ']: ' + ((e && e.message) || e)); })
      .then(function () { if (btn) { btn.disabled = false; btn.textContent = old; } });
  }
  function attListHtml(list) {
    return list.map(function (a, i) {
      return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0"><span>📎</span><button type="button" class="px-b sm" data-att="' + i + '" style="max-width:70%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
        esc(a.name) + '</button><span style="font-size:12px;color:#6b7280">' + fmtSize(a.size) + '</span></div>';
    }).join('');
  }

  /* ------------------------------------------------------------ 게시판 */
  function canEditBy(author) { return isMaster() || (!!author && author === me()); }

  window.openBoard_ = function () {
    if (!me()) { alert('로그인 후 이용해 주세요.'); return; }
    var m = modal({ title: '게시판', w: 980 });
    m.box.style.height = '92vh'; m.box.style.width = Math.min(1180, window.innerWidth - 20) + 'px';
    var body = m.body;
    var page = 0, PER = 20, query = '';
    function fail(e) { body.innerHTML = '<div class="px-err">' + esc(errMsg(e)) + '</div>'; }

    function showList() {
      body.className = 'px-bd';
      body.innerHTML = '<div class="px-load">불러오는 중…</div>';
      Promise.all([
        db().from('portal_posts').select('id,title,author,created_at,updated_at').order('id', { ascending: false }).limit(1000),
        db().from('portal_comments').select('post_id').limit(30000),
        attLoadCounts()
      ]).then(function (rs) {
        if (rs[0].error) throw rs[0].error;
        if (rs[1].error) throw rs[1].error;
        var attCnt = rs[2] || {};
        var posts = rs[0].data || [], cnt = {};
        (rs[1].data || []).forEach(function (c) { cnt[c.post_id] = (cnt[c.post_id] || 0) + 1; });
        var q = query.trim().toLowerCase();
        var view = posts.map(function (p, i) { p._no = posts.length - i; return p; }).filter(function (p) {
          return !q || String(p.title).toLowerCase().indexOf(q) >= 0 || String(p.author).toLowerCase().indexOf(q) >= 0;
        });
        var pages = Math.max(1, Math.ceil(view.length / PER));
        if (page >= pages) page = pages - 1;
        var rows = view.slice(page * PER, page * PER + PER).map(function (p) {
          return '<tr class="cl" data-id="' + p.id + '"><td style="width:70px">' + p._no + '</td><td class="l">' + esc(p.title) +
            (attCnt[p.id] ? ' <span title="첨부파일 ' + attCnt[p.id] + '개">📎</span>' : '') + (cnt[p.id] ? '<span class="px-cnt">[' + cnt[p.id] + ']</span>' : '') + '</td><td style="width:110px">' + esc(p.author) +
            '</td><td style="width:140px">' + fmtDate(p.created_at) + '</td></tr>';
        }).join('') || '<tr><td colspan="4" style="padding:30px;color:#6b7280">게시물이 없습니다.</td></tr>';
        body.innerHTML = '<div class="px-bar"><input class="px-in" id="pxBq" placeholder="제목/작성자 검색" style="max-width:260px" value="' + esc(query) + '">' +
          '<button class="px-b" id="pxBs" type="button">검색</button><span class="sp"></span><button class="px-b pri" id="pxBw" type="button">✎ 글쓰기</button></div>' +
          '<table class="px-tbl"><thead><tr><th>번호</th><th class="l">제목</th><th>작성자</th><th>작성일</th></tr></thead><tbody>' + rows + '</tbody></table>' +
          '<div class="px-bar" style="justify-content:center;margin:12px 0 0"><button class="px-b sm" id="pxBp" type="button"' + (page <= 0 ? ' disabled' : '') + '>◀</button>' +
          '<span style="font-size:13px">' + (page + 1) + ' / ' + pages + '</span><button class="px-b sm" id="pxBn" type="button"' + (page >= pages - 1 ? ' disabled' : '') + '>▶</button></div>';
        var qi = body.querySelector('#pxBq');
        function go() { query = qi.value; page = 0; showList(); }
        body.querySelector('#pxBs').addEventListener('click', go);
        qi.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
        body.querySelector('#pxBw').addEventListener('click', function () { showEdit(null); });
        body.querySelector('#pxBp').addEventListener('click', function () { page--; showList(); });
        body.querySelector('#pxBn').addEventListener('click', function () { page++; showList(); });
        Array.prototype.forEach.call(body.querySelectorAll('tr.cl'), function (tr) {
          tr.addEventListener('click', function () { showPost(Number(tr.getAttribute('data-id'))); });
        });
      }).catch(fail);
    }

    function showPost(id) {
      body.className = 'px-bd';
      body.innerHTML = '<div class="px-load">불러오는 중…</div>';
      Promise.all([
        db().from('portal_posts').select('*').eq('id', id).maybeSingle(),
        db().from('portal_comments').select('*').eq('post_id', id).order('id'),
        attLoad(id).catch(function () { return []; })
      ]).then(function (rs) {
        if (rs[0].error) throw rs[0].error;
        if (rs[1].error) throw rs[1].error;
        var atts = rs[2] || [];
        var p = rs[0].data;
        if (!p) { alert('삭제되었거나 존재하지 않는 게시물입니다.'); showList(); return; }
        var cs = rs[1].data || [];
        var can = canEditBy(p.author);
        var edited = p.updated_at && p.created_at && (new Date(p.updated_at) - new Date(p.created_at) > 2000);
        body.innerHTML = '<div class="px-bar"><button class="px-b" data-a="list" type="button">← 목록</button><span class="sp"></span>' +
          (can ? '<button class="px-b" data-a="edit" type="button">수정</button><button class="px-b danger" data-a="del" type="button">삭제</button>' : '') + '</div>' +
          '<h2 style="margin:0;font-size:20px">' + esc(p.title) + '</h2>' +
          '<div class="px-meta">' + esc(p.author) + ' · ' + fmtDate(p.created_at) + (edited ? ' (수정 ' + fmtDate(p.updated_at) + ')' : '') + '</div>' +
          '<div class="px-content"></div>' +
          (atts.length ? '<div class="px-files" style="margin-top:12px;padding:10px 12px;border:1px solid #d9dee5;border-radius:6px;background:#f8fafc"><b style="font-size:13px">첨부파일 ' + atts.length + '개</b>' + attListHtml(atts) + '</div>' : '') +
          '<div class="px-cm"><h4>댓글 ' + cs.length + '</h4><div id="pxCl"></div>' +
          '<textarea class="px-in" id="pxCt" rows="3" maxlength="2000" placeholder="댓글을 입력하세요"></textarea>' +
          '<div style="text-align:right;margin-top:6px"><button class="px-b pri" id="pxCa" type="button">댓글 등록</button></div></div>';
        var ct = body.querySelector('.px-content');
        ct.innerHTML = sanitize(p.body_html); applyFonts(ct);
        bindZoom(ct);
        Array.prototype.forEach.call(body.querySelectorAll('[data-att]'), function (b) {
          b.addEventListener('click', function () { attDownload(atts[Number(b.getAttribute('data-att'))], b); });
        });
        var cl = body.querySelector('#pxCl');
        cs.forEach(function (c) {
          var d = h('div', 'px-c');
          d.innerHTML = '<div class="top"><b>' + esc(c.author) + '</b><span>' + fmtDate(c.created_at) + '</span><span class="sp" style="flex:1"></span>' +
            (canEditBy(c.author) ? '<button class="px-b sm danger" type="button">삭제</button>' : '') + '</div><div class="txt">' + esc(c.body) + '</div>';
          var db_ = d.querySelector('button');
          if (db_) db_.addEventListener('click', function () {
            if (!canEditBy(c.author)) return;
            if (!confirm('댓글을 삭제할까요?')) return;
            db().from('portal_comments').delete().eq('id', c.id).then(function (r) {
              if (r.error) { alert(errMsg(r.error)); return; }
              showPost(id);
            });
          });
          cl.appendChild(d);
        });
        body.querySelector('[data-a=list]').addEventListener('click', showList);
        var be = body.querySelector('[data-a=edit]'); if (be) be.addEventListener('click', function () { showEdit(p); });
        var bd = body.querySelector('[data-a=del]');
        if (bd) bd.addEventListener('click', function () {
          if (!canEditBy(p.author)) return;
          if (!confirm('게시물과 댓글을 모두 삭제할까요?')) return;
          attLoad(id).catch(function () { return []; }).then(function (al) {
            return Promise.all(al.map(function (a) { return attDeleteData(a.id).catch(function () { /* noop */ }); }))
              .then(function () { return al.length ? attSaveMeta(id, []).catch(function () { /* noop */ }) : null; });
          }).then(function () {
            return db().from('portal_posts').delete().eq('id', id);
          }).then(function (r) {
            if (r.error) { alert(errMsg(r.error)); return; }
            showList();
          });
        });
        body.querySelector('#pxCa').addEventListener('click', function () {
          var t = body.querySelector('#pxCt').value.trim();
          if (!t) { alert('댓글 내용을 입력해 주세요.'); return; }
          db().from('portal_comments').insert({ post_id: id, body: t, author: me() }).then(function (r) {
            if (r.error) { alert(errMsg(r.error)); return; }
            showPost(id);
          });
        });
      }).catch(fail);
    }

    function showEdit(p) {
      body.className = 'px-bd px-fill';
      body.innerHTML = '<div class="px-bar" id="pxEbar"><b style="font-size:16px">' + (p ? '게시물 수정' : '새 글 쓰기') + '</b><span class="sp"></span>' +
        '<button class="px-b" type="button" id="pxEc">취소</button><button class="px-b pri" type="button" id="pxEs">저장</button></div>' +
        '<input class="px-in" id="pxTi" maxlength="150" placeholder="제목" style="margin-bottom:10px;flex:none">';
      var bar = body.querySelector('#pxEbar');
      body.querySelector('#pxTi').value = p ? p.title : '';
      var ed = makeEditor(p ? p.body_html : '');
      body.appendChild(ed.el);
      /* ---- 파일 첨부 (모든 형식) ---- */
      var attBox = h('div'); attBox.style.cssText = 'flex:none;margin:0 0 10px;padding:8px 10px;border:1px dashed #b8c2cc;border-radius:6px;background:#fafbfc';
      attBox.innerHTML = '<div style="display:flex;align-items:center;gap:8px"><button type="button" class="px-b sm" id="pxAadd">📎 파일 첨부</button>' +
        '<span style="font-size:12px;color:#6b7280">모든 형식 가능 · 파일당 최대 30MB</span></div><div id="pxAlist"></div>';
      var afi = h('input'); afi.type = 'file'; afi.multiple = true; afi.style.display = 'none'; attBox.appendChild(afi);
      body.insertBefore(attBox, ed.el);
      var existingAtt = [], removedAtt = [], newFiles = [];
      function renderAtt() {
        var box = attBox.querySelector('#pxAlist');
        var html = existingAtt.map(function (a, i) {
          return '<div style="display:flex;align-items:center;gap:8px;padding:3px 0"><span>📎</span><span>' + esc(a.name) + '</span><span style="font-size:12px;color:#6b7280">' + fmtSize(a.size) +
            '</span><button type="button" class="px-b sm danger" data-rm-old="' + i + '">제거</button></div>';
        }).join('') + newFiles.map(function (f, i) {
          return '<div style="display:flex;align-items:center;gap:8px;padding:3px 0"><span>🆕</span><span>' + esc(f.name) + '</span><span style="font-size:12px;color:#6b7280">' + fmtSize(f.size) +
            '</span><button type="button" class="px-b sm danger" data-rm-new="' + i + '">제거</button></div>';
        }).join('');
        box.innerHTML = html;
        Array.prototype.forEach.call(box.querySelectorAll('[data-rm-old]'), function (b) {
          b.addEventListener('click', function () { removedAtt.push(existingAtt.splice(Number(b.getAttribute('data-rm-old')), 1)[0]); renderAtt(); });
        });
        Array.prototype.forEach.call(box.querySelectorAll('[data-rm-new]'), function (b) {
          b.addEventListener('click', function () { newFiles.splice(Number(b.getAttribute('data-rm-new')), 1); renderAtt(); });
        });
      }
      attBox.querySelector('#pxAadd').addEventListener('click', function () { afi.click(); });
      afi.addEventListener('change', function () {
        Array.prototype.forEach.call(afi.files || [], function (f) {
          if (f.size > ATT_MAX_BYTES) { alert('[' + f.name + '] 파일이 너무 큽니다. (최대 30MB)'); return; }
          newFiles.push(f);
        });
        afi.value = ''; renderAtt();
      });
      if (p) attLoad(p.id).then(function (l) { existingAtt = l; renderAtt(); }).catch(function () { /* 첨부 없음 */ });
      bar.querySelector('#pxEc').addEventListener('click', function () { if (p) showPost(p.id); else showList(); });
      bar.querySelector('#pxEs').addEventListener('click', function () {
        var title = body.querySelector('#pxTi').value.trim();
        if (!title) { alert('제목을 입력해 주세요.'); return; }
        if (ed.isEmpty()) { alert('내용을 입력해 주세요.'); return; }
        var html = ed.getHtml();
        if (html.length > MAX_HTML) { alert('그림 용량이 너무 큽니다. 그림 수를 줄여 주세요.'); return; }
        var btn = bar.querySelector('#pxEs'); btn.disabled = true;
        var now = new Date().toISOString();
        var req;
        if (p) {
          if (!canEditBy(p.author)) { alert('수정 권한이 없습니다.'); btn.disabled = false; return; }
          req = db().from('portal_posts').update({ title: title, body_html: html, updated_at: now }).eq('id', p.id).select('id').maybeSingle();
        } else {
          req = db().from('portal_posts').insert({ title: title, body_html: html, author: me() }).select('id').single();
        }
        req.then(function (r) {
          if (r.error) { btn.disabled = false; alert(errMsg(r.error)); return; }
          var postId = r.data ? r.data.id : (p && p.id);
          if (!newFiles.length && !removedAtt.length) { btn.disabled = false; showPost(postId); return; }
          var finalList = existingAtt.slice(), failed = [];
          var seq = Promise.resolve();
          newFiles.forEach(function (f, i) {
            seq = seq.then(function () {
              btn.textContent = '첨부 업로드 ' + (i + 1) + '/' + newFiles.length;
              return readAsDataUrl(f).then(function (du) {
                var fid = 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
                return attWriteData(fid, du).then(function () {
                  finalList.push({ id: fid, name: f.name, size: f.size, dataLen: du.length });
                }, function (e) { attDeleteData(fid).catch(function () { /* noop */ }); throw e; });
              }).catch(function (e) { failed.push(f.name + ' (' + ((e && e.message) || e) + ')'); });
            });
          });
          seq.then(function () { return attSaveMeta(postId, finalList); })
            .then(function () { return Promise.all(removedAtt.map(function (a) { return attDeleteData(a.id).catch(function () { /* noop */ }); })); })
            .catch(function (e) { failed.push('첨부 목록 저장 실패: ' + ((e && e.message) || e)); })
            .then(function () {
              btn.disabled = false; btn.textContent = '저장';
              if (failed.length) alert('게시물은 저장되었으나 일부 첨부파일을 저장하지 못했습니다.\n' + failed.join('\n'));
              showPost(postId);
            });
        });
      });
    }
    showList();
  };

  /* ------------------------------------------------------------ 공지사항 */
  function noticeSig(list) { return list.map(function (n) { return n.id + '@' + n.updated_at; }).join('|'); }
  function hideKey() { return 'px_notice_hide_v1_' + me(); }

  function fetchPublished() {
    return db().from('portal_notices').select('*').eq('published', true).order('id', { ascending: false }).then(function (r) {
      if (r.error) throw r.error;
      return r.data || [];
    });
  }
  function noticeCardsHtml(list) {
    return list.map(function (n) {
      return '<div class="px-nt">' + (n.title ? '<h3>' + esc(n.title) + '</h3>' : '') + '<div class="px-content" style="border:0;padding:0"></div></div>';
    }).join('');
  }
  function fillNoticeCards(root, list) {
    var cs = root.querySelectorAll('.px-content');
    list.forEach(function (n, i) { cs[i].innerHTML = sanitize(n.body_html); applyFonts(cs[i]); });
  }
  /* auto=true : 일보를 열 때 자동 팝업(오늘 다시 보지않기 지원) */
  function showNoticePopup(list, auto) {
    var chk = null;
    var sig = noticeSig(list);
    var m = modal({
      title: '📢 공지사항', w: 760,
      onClose: function () {
        if (auto && chk && chk.checked) {
          try { localStorage.setItem(hideKey(), JSON.stringify({ date: todayKst(), sig: sig })); } catch (e) { /* noop */ }
        }
      }
    });
    m.box.style.maxHeight = '88vh';
    if (!list.length) { m.body.innerHTML = '<div class="px-load">게시 중인 공지사항이 없습니다.</div>'; return; }
    m.body.innerHTML = noticeCardsHtml(list);
    fillNoticeCards(m.body, list);
    var ft = h('div', 'px-ft');
    if (auto) ft.innerHTML = '<label><input type="checkbox" id="pxHide"> 오늘 다시 보지않기</label>';
    ft.appendChild(h('span', 'sp')).style.flex = '1';
    var cb = h('button', 'px-b pri', '확인'); cb.type = 'button'; cb.addEventListener('click', m.close);
    ft.appendChild(cb);
    m.box.appendChild(ft);
    chk = ft.querySelector('#pxHide');
  }
  function checkNotices() {
    if (!me()) return;
    fetchPublished().then(function (list) {
      if (!list.length || !me()) return;                       // 게시 중인 공지가 없으면 아무것도 띄우지 않음
      try {
        var v = JSON.parse(localStorage.getItem(hideKey()) || 'null');
        if (v && v.date === todayKst() && v.sig === noticeSig(list)) return;
      } catch (e) { /* noop */ }
      showNoticePopup(list, true);
    }).catch(function (e) { if (window.console) console.warn('[공지사항]', errMsg(e)); });
  }

  window.openNotice_ = function () {
    if (!me()) { alert('로그인 후 이용해 주세요.'); return; }
    if (!isMaster()) {
      fetchPublished().then(function (l) { showNoticePopup(l, false); }).catch(function (e) { alert(errMsg(e)); });
      return;
    }
    var m = modal({ title: '공지사항 관리', w: 860 });
    m.box.style.height = '92vh'; m.box.style.width = Math.min(1180, window.innerWidth - 20) + 'px';
    var body = m.body;
    function fail(e) { body.innerHTML = '<div class="px-err">' + esc(errMsg(e)) + '</div>'; }
    function plain(n) {
      if (n.title) return n.title;
      var d = h('div'); d.innerHTML = sanitize(n.body_html);
      var t = d.textContent.trim();
      return t ? t.slice(0, 40) : (d.querySelector('img') ? '(그림 공지)' : '(내용 없음)');
    }
    function showList() {
      body.className = 'px-bd';
      body.innerHTML = '<div class="px-load">불러오는 중…</div>';
      db().from('portal_notices').select('id,title,body_html,published,created_by,created_at,updated_at').order('id', { ascending: false }).then(function (r) {
        if (r.error) throw r.error;
        var list = r.data || [];
        body.innerHTML = '<div class="px-bar"><span style="font-size:13px;color:#6b7280">게시 중인 공지는 모든 사용자가 일보를 열 때 팝업으로 봅니다. 모두 내리면 아무것도 표시되지 않습니다.</span><span class="sp"></span>' +
          '<button class="px-b pri" id="pxNn" type="button">＋ 새 공지</button></div><div id="pxNl"></div>';
        var box = body.querySelector('#pxNl');
        if (!list.length) box.innerHTML = '<div class="px-load">등록된 공지사항이 없습니다.</div>';
        list.forEach(function (n) {
          var row = h('div', 'px-mrow');
          row.innerHTML = '<span class="px-badge ' + (n.published ? 'on' : 'off') + '">' + (n.published ? '게시중' : '내림') + '</span><span class="tx"></span>' +
            '<span style="font-size:12px;color:#6b7280">' + fmtDate(n.updated_at) + '</span>' +
            '<button class="px-b sm" data-a="tg" type="button">' + (n.published ? '내리기' : '게시') + '</button>' +
            '<button class="px-b sm" data-a="ed" type="button">수정</button><button class="px-b sm danger" data-a="rm" type="button">삭제</button>';
          row.querySelector('.tx').textContent = plain(n);
          row.querySelector('[data-a=tg]').addEventListener('click', function () {
            db().from('portal_notices').update({ published: !n.published, updated_at: new Date().toISOString() }).eq('id', n.id).then(function (x) {
              if (x.error) { alert(errMsg(x.error)); return; }
              showList();
            });
          });
          row.querySelector('[data-a=ed]').addEventListener('click', function () { showEdit(n); });
          row.querySelector('[data-a=rm]').addEventListener('click', function () {
            if (!confirm('이 공지사항을 삭제할까요?')) return;
            db().from('portal_notices').delete().eq('id', n.id).then(function (x) {
              if (x.error) { alert(errMsg(x.error)); return; }
              showList();
            });
          });
          box.appendChild(row);
        });
        body.querySelector('#pxNn').addEventListener('click', function () { showEdit(null); });
      }).catch(fail);
    }
    function showEdit(n) {
      body.className = 'px-bd px-fill';
      body.innerHTML = '<div class="px-bar" id="pxNbar"><b style="font-size:16px">' + (n ? '공지사항 수정' : '새 공지사항') + '</b><span class="sp"></span>' +
        '<label style="font-size:14px;display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" id="pxNp"> 저장 후 바로 게시</label>' +
        '<button class="px-b" type="button" id="pxNc">취소</button><button class="px-b pri" type="button" id="pxNs">저장</button></div>' +
        '<input class="px-in" id="pxNt" maxlength="150" placeholder="제목 (선택)" style="margin-bottom:10px;flex:none">';
      var bar = body.querySelector('#pxNbar');
      body.querySelector('#pxNt').value = n ? n.title : '';
      var ed = makeEditor(n ? n.body_html : '');
      body.appendChild(ed.el);
      bar.querySelector('#pxNp').checked = n ? !!n.published : true;
      bar.querySelector('#pxNc').addEventListener('click', showList);
      bar.querySelector('#pxNs').addEventListener('click', function () {
        if (ed.isEmpty() && !body.querySelector('#pxNt').value.trim()) { alert('제목 또는 내용을 입력해 주세요.'); return; }
        var html = ed.getHtml();
        if (html.length > MAX_HTML) { alert('그림 용량이 너무 큽니다. 그림 수를 줄여 주세요.'); return; }
        var rec = { title: body.querySelector('#pxNt').value.trim(), body_html: html, published: bar.querySelector('#pxNp').checked, updated_at: new Date().toISOString() };
        var btn = bar.querySelector('#pxNs'); btn.disabled = true;
        var req = n ? db().from('portal_notices').update(rec).eq('id', n.id) : db().from('portal_notices').insert(Object.assign({ created_by: me() }, rec));
        req.then(function (x) {
          btn.disabled = false;
          if (x.error) { alert(errMsg(x.error)); return; }
          showList();
        });
      });
    }
    showList();
  };

  /* ------------------------------------------------------------ 메모장 (포스트잇) */
  var memos = [];            // 내 메모
  var memoEls = {};          // id -> element
  var MEMO_MIN_W = 140, MEMO_MIN_H = 110, MEMO_MAX = 700;

  function clampRect(r) {
    var vw = window.innerWidth, vh = window.innerHeight;
    r.w = Math.min(Math.max(r.w, MEMO_MIN_W), Math.min(MEMO_MAX, vw - 10));
    r.h = Math.min(Math.max(r.h, MEMO_MIN_H), Math.min(MEMO_MAX, vh - 10));
    r.x = Math.min(Math.max(r.x, 0), Math.max(0, vw - r.w));
    r.y = Math.min(Math.max(r.y, 12), Math.max(12, vh - r.h));
    return r;
  }
  function posKey(id) { return 'px_memo_pos_v1_' + me() + '_' + id; }
  function posMirror(m) {                 // 최종 위치/크기를 이 브라우저에도 함께 기억 (DB 저장이 늦거나 실패해도 복원)
    try { localStorage.setItem(posKey(m.id), JSON.stringify({ x: m.x, y: m.y, w: m.w, h: m.h, t: Date.now() })); } catch (e) { /* noop */ }
  }
  function posRestore(m) {
    try {
      var v = JSON.parse(localStorage.getItem(posKey(m.id)) || 'null');
      if (v && v.t && (!m.updated_at || v.t >= new Date(m.updated_at).getTime() - 2000)) { m.x = v.x; m.y = v.y; m.w = v.w; m.h = v.h; }
    } catch (e) { /* noop */ }
  }
  function memoSave(m, fields) {
    fields = fields || {};
    if ('x' in fields || 'w' in fields) posMirror(m);
    fields.updated_at = new Date().toISOString();
    return db().from('portal_memos').update(fields).eq('id', m.id).eq('owner', me()).then(function (r) {
      if (r.error && window.console) console.warn('[메모장]', errMsg(r.error));
      return r;
    });
  }
  function clearMemos() {
    Object.keys(memoEls).forEach(function (k) { var e = memoEls[k]; if (e && e.parentNode) e.parentNode.removeChild(e); });
    memoEls = {}; memos = [];
  }
  function updateMore(el) {
    var mb = el.querySelector('.px-mb'), mo = el.querySelector('.px-more');
    if (!mb || !mo) return;
    mo.style.display = (mb.scrollHeight > mb.clientHeight + 2) ? 'block' : 'none';
  }
  function paintMemo(m) {
    var el = memoEls[m.id];
    if (!el) return;
    var r = clampRect({ x: m.x, y: m.y, w: m.w, h: m.h });
    el.style.left = r.x + 'px'; el.style.top = r.y + 'px'; el.style.width = r.w + 'px'; el.style.height = r.h + 'px';
    el.style.background = m.color || DEF_COLOR;
    var mb = el.querySelector('.px-mb');
    mb.classList.toggle('empty', !m.content);
    mb.firstChild.textContent = m.content || '클릭하여 메모를 입력하세요';
    updateMore(el);
  }
  function buildMemo(m) {
    injectStyle();
    var el = h('div', 'px-memo');
    el.innerHTML = '<div class="px-pin"></div><div class="px-mh"><span data-a="pal" title="색상">🎨</span><span data-a="del" title="삭제">✕</span></div>' +
      '<div class="px-mb"><span></span><i class="px-more">…더보기</i></div><div class="px-rs"></div>';
    document.body.appendChild(el);
    memoEls[m.id] = el;
    paintMemo(m);

    var drag = null, moved = false;
    var hd = el.querySelector('.px-mh'), rs = el.querySelector('.px-rs'), mb = el.querySelector('.px-mb');
    hd.addEventListener('pointerdown', function (e) {
      if (e.target.getAttribute('data-a')) return;
      drag = { sx: e.clientX, sy: e.clientY, x: m.x, y: m.y };
      hd.setPointerCapture(e.pointerId); e.preventDefault();
    });
    hd.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var r = clampRect({ x: drag.x + e.clientX - drag.sx, y: drag.y + e.clientY - drag.sy, w: m.w, h: m.h });
      m.x = r.x; m.y = r.y; el.style.left = r.x + 'px'; el.style.top = r.y + 'px';
    });
    function endDrag() { if (!drag) return; drag = null; memoSave(m, { x: m.x, y: m.y }); }
    hd.addEventListener('pointerup', endDrag); hd.addEventListener('pointercancel', endDrag);

    var rz = null;
    rs.addEventListener('pointerdown', function (e) {
      rz = { sx: e.clientX, sy: e.clientY, w: m.w, h: m.h };
      rs.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation();
    });
    rs.addEventListener('pointermove', function (e) {
      if (!rz) return;
      var r = clampRect({ x: m.x, y: m.y, w: rz.w + e.clientX - rz.sx, h: rz.h + e.clientY - rz.sy });
      m.w = r.w; m.h = r.h; el.style.width = r.w + 'px'; el.style.height = r.h + 'px'; updateMore(el);
    });
    function endRz() { if (!rz) return; rz = null; paintMemo(m); memoSave(m, { w: m.w, h: m.h, x: m.x, y: m.y }); }
    rs.addEventListener('pointerup', endRz); rs.addEventListener('pointercancel', endRz);

    mb.addEventListener('click', function () { openMemoPopup(m); });
    hd.querySelector('[data-a=del]').addEventListener('click', function () { removeMemo(m); });
    hd.querySelector('[data-a=pal]').addEventListener('click', function (e) {
      e.stopPropagation();
      var old = el.querySelector('.px-pal');
      if (old) { old.parentNode.removeChild(old); return; }
      var pal = h('div', 'px-pal');
      COLORS.forEach(function (c) {
        var s = h('span', 'px-sw' + (c === m.color ? ' sel' : '')); s.style.background = c;
        s.addEventListener('click', function (ev) {
          ev.stopPropagation();
          m.color = c; paintMemo(m); memoSave(m, { color: c });
          pal.parentNode && pal.parentNode.removeChild(pal);
        });
        pal.appendChild(s);
      });
      el.appendChild(pal);
    });
    return el;
  }
  function removeMemo(m) {
    if (!confirm('이 메모를 삭제할까요?')) return;
    db().from('portal_memos').delete().eq('id', m.id).eq('owner', me()).then(function (r) {
      if (r.error) { alert(errMsg(r.error)); return; }
      var e = memoEls[m.id]; if (e && e.parentNode) e.parentNode.removeChild(e);
      delete memoEls[m.id];
      memos = memos.filter(function (x) { return x.id !== m.id; });
      if (window.__pxMemoRefresh) window.__pxMemoRefresh();
    });
  }
  function loadMemos() {
    var u = me(); if (!u) return Promise.resolve();
    return db().from('portal_memos').select('*').eq('owner', u).order('id').then(function (r) {
      if (r.error) throw r.error;
      if (me() !== u) return;
      clearMemos();
      memos = r.data || [];
      memos.forEach(function (m) { posRestore(m); buildMemo(m); });
    }).catch(function (e) { if (window.console) console.warn('[메모장]', errMsg(e)); });
  }
  function openMemoPopup(m) {
    var work = { color: m.color || DEF_COLOR };
    var mo = modal({ title: '📝 메모', w: 520 });
    var ta = h('textarea', 'px-mt'); ta.value = m.content || ''; ta.maxLength = 5000;
    ta.style.background = work.color;
    mo.body.appendChild(ta);
    var pal = h('div', 'px-bar'); pal.style.marginTop = '10px';
    pal.innerHTML = '<span style="font-size:13px;color:#6b7280">색상</span>';
    function drawSw() {
      Array.prototype.forEach.call(pal.querySelectorAll('.px-sw'), function (s) { s.classList.toggle('sel', s.getAttribute('data-c') === work.color); });
    }
    COLORS.forEach(function (c) {
      var s = h('span', 'px-sw'); s.style.background = c; s.setAttribute('data-c', c);
      s.addEventListener('click', function () { work.color = c; ta.style.background = c; drawSw(); });
      pal.appendChild(s);
    });
    pal.appendChild(h('span', 'sp')).style.flex = '1';
    var del = h('button', 'px-b danger', '삭제'); del.type = 'button';
    var sv = h('button', 'px-b pri', '저장'); sv.type = 'button';
    pal.appendChild(del); pal.appendChild(sv);
    mo.body.appendChild(pal);
    drawSw();
    setTimeout(function () { ta.focus(); }, 30);
    sv.addEventListener('click', function () {
      m.content = ta.value; m.color = work.color;
      paintMemo(m);
      memoSave(m, { content: m.content, color: m.color }).then(function (r) {
        if (r.error) { alert(errMsg(r.error)); return; }
        mo.close();
        if (window.__pxMemoRefresh) window.__pxMemoRefresh();
      });
    });
    del.addEventListener('click', function () { mo.close(); removeMemo(m); });
  }
  function newMemo() {
    var n = memos.length % 8;
    var r = clampRect({ x: 90 + n * 26, y: 130 + n * 26, w: 220, h: 200 });
    return db().from('portal_memos').insert({ owner: me(), content: '', color: DEF_COLOR, x: r.x, y: r.y, w: r.w, h: r.h }).select('*').single().then(function (res) {
      if (res.error) throw res.error;
      var m = res.data; memos.push(m); buildMemo(m);
      return m;
    });
  }
  window.openMemoPad_ = function () {
    if (!me()) { alert('로그인 후 이용해 주세요.'); return; }
    var mo = modal({ title: '메모장', w: 560, onClose: function () { window.__pxMemoRefresh = null; } });
    mo.box.style.maxHeight = '85vh';
    function draw() {
      mo.body.innerHTML = '<div class="px-bar"><span style="font-size:13px;color:#6b7280">내 메모는 로그인한 본인에게만 보이며, 화면의 위치/크기/색상이 저장됩니다.</span><span class="sp"></span>' +
        '<button class="px-b" id="pxMg" type="button">전체 모으기</button><button class="px-b pri" id="pxMn" type="button">＋ 새 메모</button></div><div id="pxMl"></div>';
      var box = mo.body.querySelector('#pxMl');
      if (!memos.length) box.innerHTML = '<div class="px-load">메모가 없습니다. [＋ 새 메모]를 눌러 만들어 보세요.</div>';
      memos.forEach(function (m) {
        var row = h('div', 'px-mrow');
        row.innerHTML = '<span class="chip"></span><span class="tx"></span><button class="px-b sm" data-a="op" type="button">열기</button><button class="px-b sm danger" data-a="rm" type="button">삭제</button>';
        row.querySelector('.chip').style.background = m.color || DEF_COLOR;
        row.querySelector('.tx').textContent = (m.content || '(비어 있음)').split('\n')[0];
        row.querySelector('[data-a=op]').addEventListener('click', function () { openMemoPopup(m); });
        row.querySelector('[data-a=rm]').addEventListener('click', function () { removeMemo(m); });
        box.appendChild(row);
      });
      mo.body.querySelector('#pxMn').addEventListener('click', function () {
        newMemo().then(function (m) { draw(); openMemoPopup(m); }).catch(function (e) { alert(errMsg(e)); });
      });
      mo.body.querySelector('#pxMg').addEventListener('click', function () {
        memos.forEach(function (m, i) {
          var r = clampRect({ x: 90 + (i % 8) * 26, y: 130 + (i % 8) * 26, w: m.w, h: m.h });
          m.x = r.x; m.y = r.y; paintMemo(m); memoSave(m, { x: m.x, y: m.y });
        });
      });
    }
    window.__pxMemoRefresh = function () { if (!mo.closed) draw(); };
    draw();
    loadMemos().then(function () { if (!mo.closed) draw(); });
  };

  window.addEventListener('resize', function () {
    memos.forEach(function (m) { paintMemo(m); });
  });

  /* ------------------------------------------------------------ 부가기능 메뉴 */
  var ICON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" style="display:block;"><rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/></svg>';
  window.extrasTabHtml_ = function (autoRight) {
    var act = false;
    try { act = (typeof currentTab !== 'undefined') && (currentTab === 'settings' || currentTab === 'users'); } catch (e) { act = false; }
    return '<div class="tab' + (act ? ' active' : '') + '" id="extrasTopBtn" title="부가기능" aria-label="부가기능" role="button" onclick="openExtrasMenu_(event)" style="padding:8px 12px;' +
      (autoRight ? ' margin-left:auto !important;' : '') + '">' + ICON + '</div>';
  };
  function closeMenu() {
    var m = document.getElementById('pxMenu');
    if (m && m.parentNode) m.parentNode.removeChild(m);
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('keydown', escKey, true);
  }
  function outside(e) {
    var m = document.getElementById('pxMenu');
    if (m && !m.contains(e.target) && !(e.target.closest && e.target.closest('#extrasTopBtn'))) closeMenu();
  }
  function escKey(e) { if (e.key === 'Escape') closeMenu(); }
  window.openExtrasMenu_ = function (ev) {
    if (document.getElementById('pxMenu')) { closeMenu(); return; }
    injectStyle();
    var btn = document.getElementById('extrasTopBtn');
    var items = [];
    if (typeof window.openFileStoreModal_ === 'function') items.push(['📁', '파일저장소', function () { window.openFileStoreModal_(); }]);
    items.push(['📝', '메모장', function () { window.openMemoPad_(); }]);
    items.push(['📋', '게시판', function () { window.openBoard_(); }]);
    items.push(['📢', '공지사항', function () { window.openNotice_(); }]);
    items.push(['🧮', '계산기', function () {
      if (window.openCalculator_) window.openCalculator_(); else alert('calculator.js 파일이 함께 배포되지 않았습니다.');
    }]);
    if (typeof window.extrasMoreItems_ === 'function') { try { window.extrasMoreItems_().forEach(function (x) { items.push(x); }); } catch (e) { /* noop */ } }
    var menu = h('div'); menu.id = 'pxMenu';
    items.forEach(function (it) {
      if (it === '-') { var hr = h('div'); hr.style.cssText = 'height:1px;background:#e3e8ef;margin:5px 4px;'; menu.appendChild(hr); return; }
      var b = h('button', '', '<span class="ic">' + it[0] + '</span>' + it[1]); b.type = 'button';
      b.addEventListener('click', function () { closeMenu(); it[2](); });
      menu.appendChild(b);
    });
    document.body.appendChild(menu);
    var r = btn ? btn.getBoundingClientRect() : { left: window.innerWidth - 60, right: window.innerWidth - 10, bottom: 48 };
    var left = Math.min(Math.max(8, r.right - menu.offsetWidth), window.innerWidth - menu.offsetWidth - 8);
    menu.style.left = left + 'px'; menu.style.top = (r.bottom + 4) + 'px';
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', escKey, true);
  };

  /* ------------------------------------------------------------ 입력창 한글 우선 (계약번호 입력창만 영문 우선) */
  var CHO = 'rRseEfaqQtTdwWczxvg', JUNG = ['k', 'o', 'i', 'O', 'j', 'p', 'u', 'P', 'h', 'hk', 'ho', 'hl', 'y', 'n', 'nj', 'np', 'nl', 'b', 'm', 'ml', 'l'];
  var JONG = ['', 'r', 'R', 'rt', 's', 'sw', 'sg', 'e', 'f', 'fr', 'fa', 'fq', 'ft', 'fx', 'fv', 'fg', 'a', 'q', 'qt', 't', 'T', 'd', 'w', 'c', 'z', 'x', 'v', 'g'];
  var COMPAT = { 'ㄱ': 'r', 'ㄲ': 'R', 'ㄴ': 's', 'ㄷ': 'e', 'ㄸ': 'E', 'ㄹ': 'f', 'ㅁ': 'a', 'ㅂ': 'q', 'ㅃ': 'Q', 'ㅅ': 't', 'ㅆ': 'T', 'ㅇ': 'd', 'ㅈ': 'w', 'ㅉ': 'W', 'ㅊ': 'c', 'ㅋ': 'z', 'ㅌ': 'x', 'ㅍ': 'v', 'ㅎ': 'g',
    'ㅏ': 'k', 'ㅐ': 'o', 'ㅑ': 'i', 'ㅒ': 'O', 'ㅓ': 'j', 'ㅔ': 'p', 'ㅕ': 'u', 'ㅖ': 'P', 'ㅗ': 'h', 'ㅛ': 'y', 'ㅜ': 'n', 'ㅠ': 'b', 'ㅡ': 'm', 'ㅣ': 'l' };
  function hangulToKeys(str) {                         // 한글 두벌식 자판 → 영문 키 (예: 'ㅜ123' → 'N123')
    return String(str).replace(/[ㄱ-ㆎ가-힣]/g, function (ch) {
      var c = ch.charCodeAt(0), r;
      if (c >= 0xAC00) { var n = c - 0xAC00; r = CHO[Math.floor(n / 588)] + JUNG[Math.floor((n % 588) / 28)] + JONG[n % 28]; }
      else r = COMPAT[ch] || '';
      return r.toUpperCase();
    });
  }
  function isContractField(el) {
    var id = String(el.id || '') + ' ' + String(el.name || '');
    if (/SearchBox/i.test(id)) return false;                                // 검색창은 한글 우선
    if (/계약번호|contract/i.test(id)) return true;
    var lab = el.previousElementSibling;
    if (!lab && el.parentNode) lab = el.parentNode.querySelector('label');
    return !!(lab && lab.tagName === 'LABEL' && /^\s*계약번호\s*:?\s*$/.test(lab.textContent || ''));
  }
  function fixContractValue(e) {
    var el = e.target;
    setTimeout(function () {
      if (!el.value || !/[ㄱ-ㆎ가-힣]/.test(el.value)) return;
      el.value = hangulToKeys(el.value);
      try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (x) { /* noop */ }
    }, 0);
  }
  function prepInput(el) {
    if (el.__pxIme) return;
    el.__pxIme = 1;
    if (el.tagName === 'INPUT') {
      var t = String(el.getAttribute('type') || 'text').toLowerCase();
      if (t !== 'text' && t !== 'search') return;
    }
    if (isContractField(el)) {
      el.setAttribute('lang', 'en');
      el.style.setProperty('ime-mode', 'disabled');
      el.addEventListener('compositionend', fixContractValue);
      el.addEventListener('change', fixContractValue);
    } else {
      el.setAttribute('lang', 'ko');
      el.style.setProperty('ime-mode', 'active');
    }
  }
  function scanInputs() {
    try { Array.prototype.forEach.call(document.querySelectorAll('input,textarea'), prepInput); } catch (e) { /* noop */ }
  }
  var scanTimer = null;
  try {
    new MutationObserver(function () { clearTimeout(scanTimer); scanTimer = setTimeout(scanInputs, 150); }).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) { /* noop */ }
  setTimeout(scanInputs, 200);

  /* ------------------------------------------------------------ 종합대시보드 항목 이미지 캡처 (팝업 + 복사) */
  var CAP_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="M21 16l-5-5-8 9"/></svg>';
  function loadH2C(cb) {
    if (window.html2canvas) { cb(true); return; }
    var n = 0;
    if (!document.getElementById('pxH2cScript')) {
      var s = document.createElement('script'); s.id = 'pxH2cScript';
      s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
      document.head.appendChild(s);
    }
    var iv = setInterval(function () { n++; if (window.html2canvas) { clearInterval(iv); cb(true); } else if (n > 60) { clearInterval(iv); cb(false); } }, 150);
  }
  function capTitle(el) {
    var t = el.getAttribute('data-cap-title');
    if (t) return t;
    var sp = el.querySelector('span');
    return ((sp && sp.textContent) || '대시보드').replace(/\s+/g, ' ').trim();
  }
  function capRun(el) {
    var title = capTitle(el);
    loadH2C(function (ok) {
      if (!ok) { alert('이미지 라이브러리를 불러오지 못했습니다. 네트워크를 확인해 주세요.'); return; }
      window.html2canvas(el, {
        backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false,
        onclone: function (doc) { var a = doc.querySelectorAll('.pxcap-btn'), i; for (i = 0; i < a.length; i++) a[i].style.display = 'none';
          var g = doc.querySelectorAll('[data-cap-title] > div:nth-child(2)'); for (i = 0; i < g.length; i++) { if (g[i].parentNode.getAttribute('data-cap-title').indexOf('1.') === 0) { g[i].style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))'; g[i].parentNode.style.width = '860px'; } } }
      }).then(function (cv) { capShow(cv, title); }).catch(function (e) { alert('이미지 생성 실패: ' + (e && e.message || e)); });
    });
  }
  function capShow(cv, title) {
    var url = cv.toDataURL('image/png');
    var m = modal({ title: '🖼 ' + title + ' - 이미지', w: Math.min(980, Math.max(520, Math.round(cv.width / 2) + 60)) });
    m.body.innerHTML = '<div style="max-height:62vh;overflow:auto;border:1px solid #e2e6ea;background:#f7f8fa;padding:8px;text-align:center;"><img alt="" style="max-width:100%;display:block;margin:0 auto;background:#fff;"></div>' +
      '<div class="pxcap-msg" style="font-size:12px;color:#475569;margin:8px 0 0;min-height:16px;">[이미지 복사] 후 메일 본문에 Ctrl+V 로 붙여넣으세요.</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;"><button type="button" data-a="close">닫기</button><button type="button" data-a="save">PNG 저장</button><button type="button" data-a="copy" style="background:#2563eb;color:#fff;border:1px solid #1d4ed8;border-radius:4px;padding:6px 14px;font-weight:700;cursor:pointer;">이미지 복사</button></div>';
    m.body.querySelector('img').src = url;
    var msg = m.body.querySelector('.pxcap-msg');
    function say(t, bad) { msg.textContent = t; msg.style.color = bad ? '#dc2626' : '#15803d'; }
    m.body.querySelector('[data-a=close]').onclick = function () { m.close(); };
    m.body.querySelector('[data-a=save]').onclick = function () {
      var a = document.createElement('a'); a.href = url;
      a.download = title.replace(/[\\\/:*?"<>|\s]+/g, '_') + '.png'; document.body.appendChild(a); a.click(); a.remove();
    };
    m.body.querySelector('[data-a=copy]').onclick = function () {
      cv.toBlob(function (blob) {
        if (!blob) { say('이미지 변환 실패', true); return; }
        try {
          if (!navigator.clipboard || !window.ClipboardItem) throw new Error('unsupported');
          navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(function () { say('✔ 클립보드에 복사되었습니다. 메일에 Ctrl+V 로 붙여넣으세요.'); }, function () { say('복사 권한이 없습니다. 이미지를 우클릭하여 "이미지 복사"를 사용하세요.', true); });
        } catch (e) { say('이 브라우저는 자동 복사를 지원하지 않습니다. 이미지를 우클릭 → "이미지 복사"를 사용하세요.', true); }
      }, 'image/png');
    };
  }
  function capMkBtn(target) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'pxcap-btn'; b.title = '이미지로 캡처 (복사/저장)'; b.setAttribute('aria-label', '이미지 캡처');
    b.innerHTML = CAP_ICON;
    b.style.cssText = 'margin-left:auto;flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:1px solid #cbd5e1;border-radius:4px;background:#fff;color:#475569;cursor:pointer;';
    b.onmouseenter = function () { b.style.background = '#eff6ff'; b.style.color = '#1d4ed8'; };
    b.onmouseleave = function () { b.style.background = '#fff'; b.style.color = '#475569'; };
    b.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); capRun(target); });
    return b;
  }
  function capScan() {
    var dv = document.querySelector('#content .dashboard-view');
    if (!dv) return;
    var all = dv.querySelectorAll('div'), i, el, st;
    for (i = 0; i < all.length; i++) {
      el = all[i];
      if (el.getAttribute('data-pxcap')) continue;
      st = el.getAttribute('style') || '';
      var hd = el.firstElementChild;
      /* (a) 1번 섹션 헤더: 부모 전체(제목+4개 카드)를 캡처 */
      if (/font-size:14px/.test(st) && /font-weight:800/.test(st) && /display:flex/.test(st) && /^\s*🎯\s*1\./.test(el.textContent) && el.parentElement && el.parentElement !== dv) {
        el.setAttribute('data-pxcap', '1');
        var sec = el.parentElement;
        sec.setAttribute('data-cap-title', '1. 북서울지사 영업 현황' + (el.textContent.indexOf('-') > -1 ? ' ' + el.textContent.split(/\s-\s| - /).slice(1).join(' ').replace(/\s+/g, ' ').trim() : ''));
        el.appendChild(capMkBtn(sec));
        continue;
      }
      /* (b) 개별 카드 */
      if (el.closest('[data-cap-title]')) { el.setAttribute('data-pxcap', '1'); continue; }
      if (/background:\s*#fff/i.test(st) && /border:\s*1px solid #cbd5e1/.test(st) && /border-radius:\s*8px/.test(st) && hd && /display:\s*flex/.test(hd.getAttribute('style') || '')) {
        el.setAttribute('data-pxcap', '1');
        hd.appendChild(capMkBtn(el));
      }
    }
  }
  try {
    var capTimer = null;
    new MutationObserver(function () { clearTimeout(capTimer); capTimer = setTimeout(capScan, 200); }).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) { /* noop */ }
  setTimeout(capScan, 500);
  window.__pxCap = { scan: capScan };

  /* ------------------------------------------------------------ 종합대시보드 애니메이션 (그래프 그려지기 · 숫자 카운트업) */
  var ANIM_NUM = /-?\d[\d,]*(?:\.\d+)?/g;
  function animCount(root) {
    var els = root.querySelectorAll('div,span,b');
    var done = [], i, j, el, st, fs, fw, w, n, t;
    var jobs = [];
    for (i = 0; i < els.length; i++) {
      el = els[i]; st = el.getAttribute('style') || '';
      fs = /font-size:\s*([\d.]+)px/.exec(st); fw = /font-weight:\s*(\d+)/.exec(st);
      if (!fs || !fw || parseFloat(fs[1]) < 18 || parseInt(fw[1], 10) < 800) continue;
      if (el.closest('.pxcap-btn')) continue;
      w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      while ((n = w.nextNode())) {
        if (done.indexOf(n) > -1) continue;
        t = n.nodeValue;
        var toks = t.match(ANIM_NUM);
        if (!toks) continue;
        done.push(n);
        jobs.push({ node: n, text: t, toks: toks });
      }
    }
    if (!jobs.length) return;
    var DUR = 1200, t0 = null;
    function fmt(tok, v) {
      var dec = (tok.split('.')[1] || '').length, comma = tok.indexOf(',') > -1;
      var s = Math.abs(v).toFixed(dec);
      if (comma) { var p = s.split('.'); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); s = p.join('.'); }
      return (v < 0 ? '-' : '') + s;
    }
    function frame(ts) {
      if (t0 === null) t0 = ts;
      var k = Math.min(1, (ts - t0) / DUR), e = 1 - Math.pow(1 - k, 3), a, b, idx;
      for (a = 0; a < jobs.length; a++) {
        var jb = jobs[a];
        if (!jb.node.parentNode) continue;
        if (k >= 1) { jb.node.nodeValue = jb.text; continue; }
        idx = 0;
        jb.node.nodeValue = jb.text.replace(ANIM_NUM, function (tok) {
          var target = parseFloat(tok.replace(/,/g, ''));
          return fmt(tok, target * e);
        });
      }
      if (k < 1) requestAnimationFrame(frame);
    }
    for (j = 0; j < jobs.length; j++) jobs[j].node.nodeValue = jobs[j].text.replace(ANIM_NUM, function (tok) { return fmt(tok, 0); });
    requestAnimationFrame(frame);
  }
  function animGraphs(root) {
    if (!root.animate) return;
    var i, el, st, m;
    /* 가로 막대(너비 %) */
    var bars = root.querySelectorAll('[style*="width"]');
    for (i = 0; i < bars.length; i++) {
      el = bars[i]; st = el.getAttribute('style') || '';
      m = /(?:^|;)\s*width:\s*([\d.]+)%/.exec(st);
      if (!m || !(/height:\s*100%/.test(st) || el.classList.contains('comp-bar-fill')) || el.tagName === 'TABLE') continue;
      el.animate([{ width: '0%' }, { width: m[1] + '%' }], { duration: 1000, delay: Math.min(i * 30, 400), easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    }
    /* 누적 막대 / 도넛 */
    var all = root.querySelectorAll('div,svg'), C;
    for (i = 0; i < all.length; i++) {
      el = all[i];
      if (el.tagName === 'svg' || el.tagName === 'SVG') {
        var cs = el.querySelectorAll('circle[stroke-dasharray]');
        for (var c = 0; c < cs.length; c++) {
          var da = cs[c].getAttribute('stroke-dasharray').split(' ');
          cs[c].animate([{ strokeDasharray: '0 ' + da[1] }, { strokeDasharray: da[0] + ' ' + da[1] }], { duration: 1100, delay: c * 80, easing: 'ease-out', fill: 'backwards' });
        }
        continue;
      }
      st = el.getAttribute('style') || '';
      if (/display:\s*flex/.test(st) && /overflow:\s*hidden/.test(st) && /(?:^|;)\s*height:\s*\d+px/.test(st) && el.children.length > 1 && parseInt(/height:\s*(\d+)px/.exec(st)[1], 10) <= 32) {
        el.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: 1000, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
      }
    }
  }
  var animLast = null;
  function animScan() {
    var dv = document.querySelector('#content .dashboard-view');
    if (!dv || dv === animLast || dv.getAttribute('data-pxanim')) return;
    dv.setAttribute('data-pxanim', '1'); animLast = dv;
    requestAnimationFrame(function () { try { animGraphs(dv); animCount(dv); } catch (e) { /* noop */ } });
  }
  try {
    var animTimer = null;
    new MutationObserver(function () { clearTimeout(animTimer); animTimer = setTimeout(animScan, 120); }).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) { /* noop */ }
  window.__pxAnim = { scan: animScan };

  /* ------------------------------------------------------------ 로그인 감지: 공지 팝업 · 메모 표시 */
  var lastUser = '';
  function tick() {
    var u = me();
    if (u === lastUser) return;
    lastUser = u;
    clearMemos();
    if (!u) return;
    injectStyle();
    loadMemos();
    checkNotices();
    var tabs = document.getElementById('tabs');
    if (tabs && !document.getElementById('extrasTopBtn') && typeof window.renderTabs === 'function') {
      try { window.renderTabs(); } catch (e) { /* noop */ }
    }
  }
  setInterval(tick, 1200);
  setTimeout(tick, 300);
  window.__px = { hangulToKeys: hangulToKeys, isContractField: isContractField, scanInputs: scanInputs, sanitize: sanitize, checkNotices: checkNotices, loadMemos: loadMemos, newMemo: newMemo, isMaster: isMaster, tick: tick };
})();
