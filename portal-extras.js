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
  var ALLOW = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, BR: 1, P: 1, DIV: 1, UL: 1, OL: 1, LI: 1, IMG: 1, H3: 1, H4: 1, BLOCKQUOTE: 1 };
  var DROP = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, LINK: 1, META: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, MATH: 1, FORM: 1, INPUT: 1, BUTTON: 1, TEXTAREA: 1, SELECT: 1 };
  var IMG_RE = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+\/=]+$/;
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
      if (t === 'IMG') {
        var src = c.getAttribute('src') || '';
        if (!IMG_RE.test(src)) { node.removeChild(c); return; }
        while (c.attributes.length) c.removeAttribute(c.attributes[0].name);
        c.setAttribute('src', src);
        return;
      }
      while (c.attributes.length) c.removeAttribute(c.attributes[0].name);
      cleanNode(c);
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
      '.px-hd{display:flex;align-items:center;gap:8px;padding:11px 16px;background:var(--px-head,#1c2f4a);color:#fff;}',
      '.px-hd b{font-size:16px;}',
      '.px-hd .sp,.px-bar .sp{flex:1;}',
      '.px-hd .px-x{background:none;border:0;color:#fff;font-size:18px;cursor:pointer;padding:2px 6px;border-radius:6px;}',
      '.px-hd .px-x:hover{background:rgba(255,255,255,.22);}',
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
      '.px-tbl th{background:#eef1f5;border-bottom:2px solid #cfd6df;padding:8px;text-align:center;font-size:13px;}',
      '.px-tbl td{border-bottom:1px solid #e3e8ee;padding:8px;text-align:center;}',
      '.px-tbl td.l{text-align:left;}',
      '.px-tbl tbody tr.cl{cursor:pointer;}',
      '.px-tbl tbody tr.cl:hover{background:#f3f7fc;}',
      '.px-cnt{color:#c2410c;font-weight:700;margin-left:5px;font-size:12px;}',
      '.px-meta{color:#6b7280;font-size:13px;margin:4px 0 14px;}',
      '.px-content{border-top:1px solid #dfe5ec;border-bottom:1px solid #dfe5ec;padding:14px 4px;min-height:80px;line-height:1.65;font-size:14.5px;word-break:break-word;overflow-wrap:anywhere;}',
      '.px-content img,.px-ed img{max-width:100%;height:auto;display:block;margin:8px 0;border-radius:4px;cursor:zoom-in;}',
      '.px-content ul,.px-content ol,.px-ed ul,.px-ed ol{margin:6px 0 6px 22px;padding:0;}',
      '.px-cm{margin-top:18px;}',
      '.px-cm h4{margin:0 0 8px;font-size:14px;}',
      '.px-c{border:1px solid #e1e6ed;border-radius:8px;padding:8px 12px;margin-bottom:7px;background:#fafbfd;}',
      '.px-c .top{display:flex;align-items:center;gap:8px;font-size:12.5px;color:#6b7280;}',
      '.px-c .top b{color:#1f2937;font-size:13px;}',
      '.px-c .txt{white-space:pre-wrap;word-break:break-word;margin-top:4px;font-size:14px;}',
      '.px-tools{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:6px;}',
      '.px-ed{border:1px solid #c3ccd8;border-radius:7px;min-height:230px;max-height:52vh;overflow:auto;padding:10px 12px;line-height:1.6;font-size:14.5px;outline:none;}',
      '.px-ed:focus{border-color:#4b6fa5;}',
      '.px-ed:empty:before{content:attr(data-ph);color:#9aa4b2;}',
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
  function modal(opt) {
    injectStyle();
    var ov = h('div', 'px-ov');
    ov.style.setProperty('--px-head', themeColor());
    var box = h('div', 'px-box');
    box.style.width = (opt.w || 720) + 'px';
    var hd = h('div', 'px-hd', '<b></b><span class="sp"></span><button class="px-x" type="button" title="닫기">✕</button>');
    hd.querySelector('b').textContent = opt.title || '';
    var bd = h('div', 'px-bd');
    box.appendChild(hd); box.appendChild(bd);
    ov.appendChild(box);
    document.body.appendChild(ov);
    var m = { ov: ov, box: box, body: bd, closed: false };
    m.close = function () {
      if (m.closed) return;
      m.closed = true;
      if (ov.parentNode) ov.parentNode.removeChild(ov);
      if (opt.onClose) opt.onClose();
    };
    hd.querySelector('.px-x').addEventListener('click', m.close);
    return m;
  }
  function lightbox(src) {
    var lb = h('div', 'px-lb');
    var im = h('img'); im.src = src;
    lb.appendChild(im);
    lb.addEventListener('click', function () { lb.parentNode && lb.parentNode.removeChild(lb); });
    document.body.appendChild(lb);
  }
  function bindZoom(root) {
    root.addEventListener('click', function (e) {
      if (e.target && e.target.tagName === 'IMG') lightbox(e.target.src);
    });
  }

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
  function makeEditor(initialHtml) {
    var wrap = h('div');
    var tools = h('div', 'px-tools');
    var ed = h('div', 'px-ed');
    ed.contentEditable = 'true';
    ed.setAttribute('data-ph', '내용을 입력하세요. 그림은 [그림 추가] 버튼, 붙여넣기(Ctrl+V), 끌어놓기로 넣을 수 있습니다.');
    ed.innerHTML = sanitize(initialHtml || '');
    var fi = h('input'); fi.type = 'file'; fi.accept = 'image/*'; fi.multiple = true; fi.style.display = 'none';
    function btn(label, title, fn) {
      var b = h('button', 'px-b sm'); b.type = 'button'; b.innerHTML = label; b.title = title;
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.addEventListener('click', fn);
      tools.appendChild(b);
    }
    function cmd(c) { ed.focus(); try { document.execCommand(c, false, null); } catch (e) { /* noop */ } }
    btn('<b>B</b>', '굵게', function () { cmd('bold'); });
    btn('<i>I</i>', '기울임', function () { cmd('italic'); });
    btn('<u>U</u>', '밑줄', function () { cmd('underline'); });
    btn('• 목록', '글머리 기호', function () { cmd('insertUnorderedList'); });
    btn('🖼 그림 추가', '그림 추가', function () { fi.click(); });
    function addFiles(files) {
      var list = Array.prototype.filter.call(files || [], function (f) { return /^image\//.test(f.type); });
      list.reduce(function (p, f) {
        return p.then(function () {
          return compressImage(f).then(function (url) {
            ed.focus();
            try { document.execCommand('insertImage', false, url); } catch (e) { /* noop */ }
          });
        });
      }, Promise.resolve()).catch(function (e) { alert(e.message || e); });
    }
    fi.addEventListener('change', function () { addFiles(fi.files); fi.value = ''; });
    ed.addEventListener('paste', function (e) {
      var cd = e.clipboardData; if (!cd) return;
      var imgs = Array.prototype.filter.call(cd.files || [], function (f) { return /^image\//.test(f.type); });
      e.preventDefault();
      if (imgs.length) { addFiles(imgs); return; }
      var t = cd.getData('text/plain');
      if (t) { try { document.execCommand('insertText', false, t); } catch (x) { /* noop */ } }
    });
    ed.addEventListener('dragover', function (e) { e.preventDefault(); });
    ed.addEventListener('drop', function (e) {
      var fs = e.dataTransfer && e.dataTransfer.files;
      e.preventDefault();
      if (fs && fs.length) addFiles(fs);
    });
    bindZoom(ed);
    wrap.appendChild(tools); wrap.appendChild(ed); wrap.appendChild(fi);
    return {
      el: wrap, node: ed,
      getHtml: function () { return sanitize(ed.innerHTML).replace(/^(<br>|\s)+|(<br>|\s)+$/g, ''); },
      isEmpty: function () { return !ed.querySelector('img') && !ed.textContent.trim(); }
    };
  }

  /* ------------------------------------------------------------ 게시판 */
  function canEditBy(author) { return isMaster() || (!!author && author === me()); }

  window.openBoard_ = function () {
    if (!me()) { alert('로그인 후 이용해 주세요.'); return; }
    var m = modal({ title: '게시판', w: 980 });
    m.box.style.height = '90vh';
    var body = m.body;
    var page = 0, PER = 20, query = '';
    function fail(e) { body.innerHTML = '<div class="px-err">' + esc(errMsg(e)) + '</div>'; }

    function showList() {
      body.innerHTML = '<div class="px-load">불러오는 중…</div>';
      Promise.all([
        db().from('portal_posts').select('id,title,author,created_at,updated_at').order('id', { ascending: false }).limit(1000),
        db().from('portal_comments').select('post_id').limit(30000)
      ]).then(function (rs) {
        if (rs[0].error) throw rs[0].error;
        if (rs[1].error) throw rs[1].error;
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
            (cnt[p.id] ? '<span class="px-cnt">[' + cnt[p.id] + ']</span>' : '') + '</td><td style="width:110px">' + esc(p.author) +
            '</td><td style="width:140px">' + fmtDate(p.created_at) + '</td></tr>';
        }).join('') || '<tr><td colspan="4" style="padding:30px;color:#6b7280">게시물이 없습니다.</td></tr>';
        body.innerHTML = '<div class="px-bar"><input class="px-in" id="pxBq" placeholder="제목/작성자 검색" style="max-width:260px" value="' + esc(query) + '">' +
          '<button class="px-b" id="pxBs" type="button">검색</button><span class="sp"></span><button class="px-b pri" id="pxBw" type="button">✎ 글쓰기</button></div>' +
          '<table class="px-tbl"><thead><tr><th>번호</th><th>제목</th><th>작성자</th><th>작성일</th></tr></thead><tbody>' + rows + '</tbody></table>' +
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
      body.innerHTML = '<div class="px-load">불러오는 중…</div>';
      Promise.all([
        db().from('portal_posts').select('*').eq('id', id).maybeSingle(),
        db().from('portal_comments').select('*').eq('post_id', id).order('id')
      ]).then(function (rs) {
        if (rs[0].error) throw rs[0].error;
        if (rs[1].error) throw rs[1].error;
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
          '<div class="px-cm"><h4>댓글 ' + cs.length + '</h4><div id="pxCl"></div>' +
          '<textarea class="px-in" id="pxCt" rows="3" maxlength="2000" placeholder="댓글을 입력하세요"></textarea>' +
          '<div style="text-align:right;margin-top:6px"><button class="px-b pri" id="pxCa" type="button">댓글 등록</button></div></div>';
        var ct = body.querySelector('.px-content');
        ct.innerHTML = sanitize(p.body_html);
        bindZoom(ct);
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
          db().from('portal_posts').delete().eq('id', id).then(function (r) {
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
      body.innerHTML = '<div class="px-bar"><b style="font-size:16px">' + (p ? '게시물 수정' : '새 글 쓰기') + '</b></div>' +
        '<input class="px-in" id="pxTi" maxlength="150" placeholder="제목" style="margin-bottom:10px">';
      body.querySelector('#pxTi').value = p ? p.title : '';
      var ed = makeEditor(p ? p.body_html : '');
      body.appendChild(ed.el);
      var bar = h('div', 'px-bar', '<span class="sp"></span><button class="px-b" type="button" id="pxEc">취소</button><button class="px-b pri" type="button" id="pxEs">저장</button>');
      bar.style.marginTop = '12px';
      body.appendChild(bar);
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
          btn.disabled = false;
          if (r.error) { alert(errMsg(r.error)); return; }
          showPost(r.data ? r.data.id : (p && p.id));
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
    list.forEach(function (n, i) { cs[i].innerHTML = sanitize(n.body_html); bindZoom(cs[i]); });
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
    m.box.style.height = '88vh';
    var body = m.body;
    function fail(e) { body.innerHTML = '<div class="px-err">' + esc(errMsg(e)) + '</div>'; }
    function plain(n) {
      if (n.title) return n.title;
      var d = h('div'); d.innerHTML = sanitize(n.body_html);
      var t = d.textContent.trim();
      return t ? t.slice(0, 40) : (d.querySelector('img') ? '(그림 공지)' : '(내용 없음)');
    }
    function showList() {
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
      body.innerHTML = '<div class="px-bar"><b style="font-size:16px">' + (n ? '공지사항 수정' : '새 공지사항') + '</b></div>' +
        '<input class="px-in" id="pxNt" maxlength="150" placeholder="제목 (선택)" style="margin-bottom:10px">';
      body.querySelector('#pxNt').value = n ? n.title : '';
      var ed = makeEditor(n ? n.body_html : '');
      body.appendChild(ed.el);
      var bar = h('div', 'px-bar', '<label style="font-size:14px;display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" id="pxNp"> 저장 후 바로 게시</label><span class="sp"></span>' +
        '<button class="px-b" type="button" id="pxNc">취소</button><button class="px-b pri" type="button" id="pxNs">저장</button>');
      bar.style.marginTop = '12px';
      body.appendChild(bar);
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
  function memoSave(m, fields) {
    fields = fields || {};
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
      memos.forEach(buildMemo);
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
    return '<div class="tab" id="extrasTopBtn" title="부가기능" aria-label="부가기능" role="button" onclick="openExtrasMenu_(event)" style="padding:8px 12px;' +
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
    var menu = h('div'); menu.id = 'pxMenu';
    items.forEach(function (it) {
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
  window.__px = { sanitize: sanitize, checkNotices: checkNotices, loadMemos: loadMemos, newMemo: newMemo, isMaster: isMaster, tick: tick };
})();
