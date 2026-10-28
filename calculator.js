/* =====================================================================
 * calculator.js — 북서울지사 영업일보 포털 공용 계산기 (팝업, 탁상용 계산기 모양)
 *  - Admin.html / User.html 우측 상단 계산기 버튼(#calcTopBtn)으로 열고 닫는다. (같은 폴더에 배포)
 *  - 모달이 아니라 떠 있는 창: 윗부분을 끌어 이동, 오른쪽 아래 모서리를 끌어 크기 조절(숫자 포함 전체 비율 확대/축소).
 *    마지막 크기와 소수점/반올림 설정은 브라우저에 기억한다.
 *  - 숫자 붙여넣기: 쉼표·공백·원/₩·한글 단위는 제거, 여러 줄은 '+' 로 연결(합계식).
 *  - 수식은 eval 을 쓰지 않고 직접 파싱한다. 지원: + − × ÷ ( ) % (10% = 0.1), 소수점, 음수
 * ===================================================================== */
(function () {
  'use strict';
  if (window.openCalculator_) return;

  var W = 280, H = 450;                       // 설계 크기(px). 실제 창은 이 크기 × 배율
  var KMIN = 0.55, KMAX = 2.5;
  var LS_SCALE = 's1_calc_scale_v1', LS_PREF = 's1_calc_pref_v1';
  var DECS = ['F', '4', '3', '2', '1', '0'];  // 소수점 자리수 (F = 제한 없음)
  var RNDS = ['up', 'half', 'cut'];           // 올림 / 반올림 / 버림
  var state = { open: false, just: false, last: null, k: 1, mem: 0, gt: 0, dec: 'F', rnd: 'half', err: false, dom: null, drag: null, rs: null };

  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* 저장 불가 환경은 무시 */ } }

  /* ------------------------------------------------------------------ 수식 처리 */
  function normalize(s) {
    s = String(s == null ? '' : s);
    try { s = s.normalize('NFKC'); } catch (e) { /* 구형 브라우저 */ }
    return s.replace(/[×✕✖xX]/g, '*').replace(/÷/g, '/').replace(/[−–—]/g, '-')
      .replace(/[,\s ₩]/g, '').replace(/원/g, '');
  }

  function parse(src) {          // 비어 있으면 null, 잘못된 수식이면 Error
    var s = normalize(src), i = 0;
    if (s === '') return null;
    function peek() { return s.charAt(i); }
    function num() {
      var m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
      if (!m) throw new Error('syntax');
      i += m[0].length; return parseFloat(m[0]);
    }
    function primary() {
      if (peek() === '(') {
        i++; var v = expr();
        if (peek() !== ')') throw new Error('syntax');
        i++; return v;
      }
      return num();
    }
    function postfix() { var v = primary(); while (peek() === '%') { i++; v = v / 100; } return v; }
    function unary() {
      if (peek() === '-') { i++; return -unary(); }
      if (peek() === '+') { i++; return unary(); }
      return postfix();
    }
    function term() {
      var v = unary();
      for (;;) {
        var c = peek();
        if (c === '*') { i++; v = v * unary(); }
        else if (c === '/') { i++; var d = unary(); if (d === 0) throw new Error('div0'); v = v / d; }
        else if (c === '(') { v = v * postfix(); }          // 2(3+1) 처럼 괄호 앞 곱셈 생략
        else break;
      }
      return v;
    }
    function expr() {
      var v = term();
      for (;;) {
        var c = peek();
        if (c === '+') { i++; v = v + term(); }
        else if (c === '-') { i++; v = v - term(); }
        else break;
      }
      return v;
    }
    var out = expr();
    if (i !== s.length) throw new Error('syntax');
    if (!isFinite(out)) throw new Error('range');
    out = Number(out.toPrecision(15));       // 0.1+0.2 같은 부동소수 오차 정리
    return out === 0 ? 0 : out;
  }

  /* 소수점 자리수 / 올림·반올림·버림 설정 적용 */
  function applyRound(n) {
    if (state.dec === 'F') return n;
    var f = Math.pow(10, Number(state.dec)), sg = n < 0 ? -1 : 1;
    var a = Number((Math.abs(n) * f).toPrecision(15));
    var r = state.rnd === 'up' ? Math.ceil(a) : state.rnd === 'cut' ? Math.floor(a) : Math.round(a);
    var out = Number((sg * r / f).toPrecision(15));
    return out === 0 ? 0 : out;
  }
  function value(src) {            // 수식 → 설정이 적용된 값 (비면 null)
    var n = parse(src);
    if (n === null) return null;
    if (Math.abs(n) >= 1e15) throw new Error('range');
    return applyRound(n);
  }

  function plain(n) { return n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 10 }); }
  function lcdText(n) {            // 화면 표시용: 천단위 쉼표, 소수는 유효숫자 12자리까지
    var s = Number.isInteger(n) ? String(Math.abs(n)) : Math.abs(n).toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 12 });
    if (/e/i.test(s)) s = Math.abs(n).toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
    var p = s.split('.'), ip = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 ? '-' : '') + ip + (p.length > 1 ? '.' + p[1] : '');
  }

  /* 붙여넣기 정리 */
  function cleanToken(t) { return String(t).replace(/[,\s ₩]/g, '').replace(/[가-힣]+/g, ''); }
  function isNum(t) { return /^-?(\d+\.?\d*|\.\d+)%?$/.test(t); }
  function processPaste(text) {
    text = String(text == null ? '' : text).replace(/\r/g, '');
    var toks = text.split(/[\n\t]+/).map(cleanToken).filter(Boolean)
      .map(function (t) { var m = /^\((\d+\.?\d*)\)$/.exec(t); return m ? '-' + m[1] : t; });   // (1,234) 회계식 음수
    if (toks.length > 1 && toks.every(isNum)) return { text: toks.join('+'), count: toks.length, sum: true };
    return { text: toks.join(''), count: toks.length, sum: false };
  }

  /* ------------------------------------------------------------------ 7세그먼트 LCD (SVG) */
  var T = 3.2, CW = 14, CH = 34;
  function hseg(x0, x1, yc) { var h = T / 2; return [[x0, yc], [x0 + h, yc - h], [x1 - h, yc - h], [x1, yc], [x1 - h, yc + h], [x0 + h, yc + h]]; }
  function vseg(xc, y0, y1) { var h = T / 2; return [[xc, y0], [xc + h, y0 + h], [xc + h, y1 - h], [xc, y1], [xc - h, y1 - h], [xc - h, y0 + h]]; }
  function pts(a, dx) { return a.map(function (p) { return (p[0] + dx).toFixed(2) + ',' + p[1].toFixed(2); }).join(' '); }
  var SEG = {
    a: hseg(2.2, CW - 2.2, T / 2), g: hseg(2.2, CW - 2.2, CH / 2), d: hseg(2.2, CW - 2.2, CH - T / 2),
    f: vseg(T / 2, 2.4, CH / 2 - 0.6), b: vseg(CW - T / 2, 2.4, CH / 2 - 0.6),
    e: vseg(T / 2, CH / 2 + 0.6, CH - 2.4), c: vseg(CW - T / 2, CH / 2 + 0.6, CH - 2.4)
  };
  var GLYPH = { '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', 'E': 'afged' };
  function lcdSvg(text) {
    var x = 0, out = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (GLYPH[ch]) {
        GLYPH[ch].split('').forEach(function (sg) { out += '<polygon points="' + pts(SEG[sg], x) + '"/>'; });
        x += CW + 3;
      } else if (ch === '.') { out += '<rect x="' + (x + 0.8) + '" y="' + (CH - 3.6) + '" width="3.6" height="3.6"/>'; x += 6.5; }
      else if (ch === ',') { out += '<polygon points="' + (x + 1.4) + ',1 ' + (x + 4) + ',1 ' + (x + 2.4) + ',9 ' + (x - 0.2) + ',9"/>'; x += 5.5; }
    }
    var vbW = Math.max(236, x + 8), off = vbW - x - 7;
    return '<svg viewBox="0 0 ' + vbW + ' ' + CH + '" preserveAspectRatio="xMaxYMid meet" width="100%" height="100%" aria-hidden="true"><g fill="#11181d" transform="translate(' + (off + 6).toFixed(2) + ' 0) skewX(-10)">' + out + '</g></svg>';
  }

  /* ------------------------------------------------------------------ 화면 */
  function injectStyle() {
    if (document.getElementById('calc-style')) return;
    var css = [
      '#calcWin{position:fixed;z-index:2000000;display:none;user-select:none;-webkit-user-select:none;font-family:"Segoe UI","Malgun Gothic",system-ui,sans-serif;}',
      '#calcWin.open{display:block;}',
      '#calcBody{position:absolute;left:0;top:0;width:' + W + 'px;height:' + H + 'px;box-sizing:border-box;transform-origin:0 0;border-radius:18px;background:linear-gradient(180deg,#fdfdfe 0%,#f0f2f5 55%,#e8ebef 100%);border:1px solid #c9d0d8;box-shadow:0 14px 40px rgba(15,23,42,.38),inset 0 1px 0 #fff;}',
      '#calcBody .top{position:absolute;left:0;right:0;top:0;height:132px;border-radius:17px 17px 0 0;background:linear-gradient(180deg,#f9fafb,#e9edf1);border-bottom:1px solid #bfc7d0;box-shadow:0 1px 0 #fff;cursor:move;touch-action:none;}',
      '#calcBody .x{position:absolute;right:9px;top:6px;width:18px;height:18px;border-radius:50%;border:0;background:rgba(0,0,0,.07);color:#6b7480;font-size:11px;line-height:18px;padding:0;cursor:pointer;}',
      '#calcBody .x:hover{background:rgba(0,0,0,.16);color:#222;}',
      '#calcBody .lcd{position:absolute;left:14px;right:14px;top:30px;height:90px;border-radius:7px;border:1px solid #93a8b0;background:linear-gradient(180deg,#c9dee5 0%,#e3eef0 100%);box-shadow:inset 0 3px 6px rgba(0,0,0,.28),0 1px 0 #fff;overflow:hidden;cursor:default;}',
      '#calcBody .ann{position:absolute;left:8px;top:4px;display:flex;gap:7px;font:700 8px/1 Consolas,"Courier New",monospace;color:#11181d;height:9px;}',
      '#calcBody .ann span{visibility:hidden;}#calcBody .ann span.on{visibility:visible;}',
      '#calcBody .expr{position:absolute;left:6px;right:8px;top:13px;height:20px;box-sizing:border-box;border:0;background:transparent;outline:0;text-align:right;font:500 12px/20px Consolas,"Courier New",monospace;color:#1d2a31;caret-color:#11181d;padding:0;user-select:text;-webkit-user-select:text;}',
      '#calcBody .expr.err{color:#b91c1c;}',
      '#calcBody .res{position:absolute;left:6px;right:8px;top:38px;height:46px;}',
      '#calcBody .ctl{position:absolute;left:14px;right:14px;top:144px;height:28px;display:flex;gap:8px;align-items:flex-end;}',
      '#calcBody .sl{position:relative;height:26px;cursor:pointer;flex:none;}',
      '#calcBody .sl.rnd{width:46px;}#calcBody .sl.dec{width:92px;}',
      '#calcBody .sl .dots{display:flex;justify-content:space-between;padding:0 8px;height:7px;}',
      '#calcBody .sl .dots i{width:3px;height:3px;border-radius:50%;background:#b4bbc4;display:block;}',
      '#calcBody .sl .dots i.on{background:#475569;}',
      '#calcBody .sl .trk{position:absolute;left:0;right:0;bottom:0;height:16px;border-radius:9px;border:1px solid #c3cad2;background:linear-gradient(180deg,#e4e8ed,#fff);box-shadow:inset 0 1px 3px rgba(0,0,0,.18);}',
      '#calcBody .sl .knob{position:absolute;top:1px;width:18px;height:12px;border-radius:7px;border:1px solid #aab3bd;background:linear-gradient(180deg,#fff,#e2e6ea);box-shadow:0 1px 2px rgba(0,0,0,.25);transition:left .12s;}',
      '#calcBody .keys1{position:absolute;left:14px;right:14px;top:182px;height:26px;display:grid;grid-template-columns:repeat(5,1fr);gap:8px;}',
      '#calcBody .keys{position:absolute;left:14px;right:14px;top:218px;bottom:16px;display:grid;grid-template-columns:repeat(5,1fr);grid-template-rows:repeat(5,1fr);gap:8px;}',
      '#calcBody button.k{position:relative;border:1px solid #c5ccd4;border-radius:11px;padding:0;cursor:pointer;color:#3b4350;font-weight:600;font-family:inherit;background:linear-gradient(180deg,#ffffff 0%,#f1f3f6 100%);box-shadow:0 2px 0 #b9c1ca,0 3px 5px rgba(0,0,0,.14),inset 0 1px 0 #fff;}',
      '#calcBody button.k::before{content:"";position:absolute;left:4px;right:4px;top:4px;bottom:4px;border-radius:8px;background:radial-gradient(ellipse at 50% 30%,#fbfcfd 0%,#eceff3 100%);border:1px solid #e1e5ea;pointer-events:none;}',
      '#calcBody button.k span{position:relative;}',
      '#calcBody button.k:hover{filter:brightness(.985);}',
      '#calcBody button.k:active{transform:translateY(1px);box-shadow:0 1px 0 #b9c1ca,0 1px 3px rgba(0,0,0,.18),inset 0 1px 2px rgba(0,0,0,.1);}',
      '#calcBody button.pill{border-radius:14px;font-size:9.5px;letter-spacing:.3px;}',
      '#calcBody button.pill::before{border-radius:11px;left:3px;right:3px;top:3px;bottom:3px;}',
      '#calcBody .keys button.k{font-size:16px;}',
      '#calcBody .keys button.k.m,#calcBody .keys button.k.c{font-size:13px;}',
      '#calcBody .keys button.k.op{font-size:21px;font-weight:500;}',
      '#calcBody .keys button.k.tall{grid-row:span 2;}',
      '#calcBody .grip{position:absolute;right:3px;bottom:3px;width:16px;height:16px;cursor:nwse-resize;touch-action:none;opacity:.55;background:linear-gradient(135deg,transparent 0 48%,#8b95a1 48% 54%,transparent 54% 66%,#8b95a1 66% 72%,transparent 72% 84%,#8b95a1 84% 90%,transparent 90%);border-radius:0 0 14px 0;}'
    ].join('\n');
    var st = document.createElement('style'); st.id = 'calc-style'; st.textContent = css; document.head.appendChild(st);
  }

  var ROW1 = [['COPY', 'copy'], ['%', 'pct'], ['√', 'sqrt'], ['▶', 'back'], ['GT', 'gt']];
  var MAIN = [
    ['MC', 'mc', 'm'], ['MR', 'mr', 'm'], ['M−', 'mminus', 'm'], ['M+', 'mplus', 'm'], ['÷', '÷', 'op'],
    ['+/−', 'neg', 'm'], ['7', '7', ''], ['8', '8', ''], ['9', '9', ''], ['×', '×', 'op'],
    ['C', 'clear', 'c'], ['4', '4', ''], ['5', '5', ''], ['6', '6', ''], ['−', '−', 'op'],
    ['AC', 'ac', 'c'], ['1', '1', ''], ['2', '2', ''], ['3', '3', ''], ['+', '+', 'op tall'],
    ['0', '0', ''], ['00', '00', ''], ['·', '.', ''], ['=', 'eval', 'op']
  ];
  function keyHtml(k, cls) { return '<button type="button" class="k ' + cls + '" data-k="' + k[1] + '"><span>' + k[0] + '</span></button>'; }
  function dotsHtml(n) { var s = ''; for (var i = 0; i < n; i++) s += '<i></i>'; return s; }

  function build() {
    if (state.dom) return state.dom;
    injectStyle();
    var w = document.createElement('div'); w.id = 'calcWin'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-label', '계산기');
    w.innerHTML =
      '<div id="calcBody">' +
        '<div class="top" id="calcTop"><button type="button" class="x" id="calcClose" aria-label="닫기">✕</button>' +
          '<div class="lcd"><div class="ann"><span id="calcAM">M</span><span id="calcAG">GT</span><span id="calcAE">E</span><span id="calcAC">COPY</span></div>' +
            '<input class="expr" id="calcIn" type="text" inputmode="decimal" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" aria-label="수식">' +
            '<div class="res" id="calcRes"></div></div></div>' +
        '<div class="ctl">' +
          '<div class="sl rnd" data-sl="rnd" title="올림 / 반올림 / 버림"><div class="dots">' + dotsHtml(3) + '</div><div class="trk"><div class="knob"></div></div></div>' +
          '<div class="sl dec" data-sl="dec" title="소수점 자리수 (F = 제한 없음)"><div class="dots">' + dotsHtml(6) + '</div><div class="trk"><div class="knob"></div></div></div>' +
          '<button type="button" class="k pill" data-k="tax-" title="부가세 10% 제외 (÷1.1)" style="flex:1;height:26px;"><span>TAX−</span></button>' +
          '<button type="button" class="k pill" data-k="tax+" title="부가세 10% 포함 (×1.1)" style="flex:1;height:26px;"><span>TAX+</span></button>' +
        '</div>' +
        '<div class="keys1">' + ROW1.map(function (k) { return keyHtml(k, 'pill'); }).join('') + '</div>' +
        '<div class="keys" id="calcKeys">' + MAIN.map(function (k) { return keyHtml(k, k[2]); }).join('') + '</div>' +
        '<div class="grip" id="calcGrip"></div>' +
      '</div>';
    document.body.appendChild(w);
    var d = state.dom = {
      win: w, body: w.querySelector('#calcBody'), inp: w.querySelector('#calcIn'), res: w.querySelector('#calcRes'),
      top: w.querySelector('#calcTop'), grip: w.querySelector('#calcGrip'),
      aM: w.querySelector('#calcAM'), aG: w.querySelector('#calcAG'), aE: w.querySelector('#calcAE'), aC: w.querySelector('#calcAC')
    };

    // 포털의 단축키/전역 핸들러와 충돌하지 않도록 계산기 안의 키 입력은 밖으로 전달하지 않는다
    ['keydown', 'keyup', 'keypress'].forEach(function (ev) { w.addEventListener(ev, function (e) { e.stopPropagation(); }); });
    w.querySelector('#calcClose').addEventListener('click', closeCalc);

    d.inp.addEventListener('input', function () { state.just = false; setErr(false); update(); });
    d.inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === '=') { e.preventDefault(); evaluate(); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeCalc(); return; }
      if (state.just && !e.ctrlKey && !e.metaKey && !e.altKey && /^[0-9.(]$/.test(e.key)) d.inp.value = '';   // 계산 직후 숫자를 치면 새 계산
    });
    w.addEventListener('paste', function (e) {
      var t = (e.clipboardData || window.clipboardData);
      if (!t) return;
      e.preventDefault();
      var r = processPaste(t.getData('text'));
      if (r.text) insertAtCaret(r.text, true);
    });
    d.inp.addEventListener('drop', function (e) { e.preventDefault(); });

    var keysWrap = d.body;
    keysWrap.addEventListener('mousedown', function (e) {          // 입력칸 포커스 유지
      if (e.target.closest && e.target.closest('button.k,.sl')) e.preventDefault();
    });
    keysWrap.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button.k[data-k]');
      if (b) { press(b.getAttribute('data-k')); return; }
      var s = e.target.closest && e.target.closest('.sl[data-sl]');
      if (s) clickSlider(s, e);
    });

    // 윗부분 드래그로 이동
    d.top.addEventListener('pointerdown', function (e) {
      if (e.target.closest && e.target.closest('input,button')) return;
      var r = w.getBoundingClientRect();
      state.drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      try { d.top.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    });
    d.top.addEventListener('pointermove', function (e) { if (state.drag) place(e.clientX - state.drag.dx, e.clientY - state.drag.dy); });
    var endDrag = function () { state.drag = null; };
    d.top.addEventListener('pointerup', endDrag); d.top.addEventListener('pointercancel', endDrag);

    // 오른쪽 아래 모서리 드래그로 크기 조절 (숫자·키 전체가 같은 비율로 커지고 작아짐)
    d.grip.addEventListener('pointerdown', function (e) {
      var r = w.getBoundingClientRect();
      state.rs = { left: r.left, top: r.top };
      try { d.grip.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      e.preventDefault(); e.stopPropagation();
    });
    d.grip.addEventListener('pointermove', function (e) {
      if (!state.rs) return;
      setScale(Math.max((e.clientX - state.rs.left + 6) / W, (e.clientY - state.rs.top + 6) / H), false);
    });
    var endRs = function () { if (state.rs) { state.rs = null; lsSet(LS_SCALE, String(state.k)); } };
    d.grip.addEventListener('pointerup', endRs); d.grip.addEventListener('pointercancel', endRs);

    window.addEventListener('resize', function () { if (state.open) { setScale(state.k, false); } });

    var pref = null; try { pref = JSON.parse(lsGet(LS_PREF) || 'null'); } catch (e) { pref = null; }
    if (pref && DECS.indexOf(pref.dec) >= 0) state.dec = pref.dec;
    if (pref && RNDS.indexOf(pref.rnd) >= 0) state.rnd = pref.rnd;
    var sv = parseFloat(lsGet(LS_SCALE)); if (isFinite(sv) && sv > 0) state.k = sv;
    renderSliders(); update(); setAnn();
    return d;
  }

  function maxScale() { return Math.max(KMIN, Math.min(KMAX, (window.innerWidth - 8) / W, (window.innerHeight - 8) / H)); }
  function setScale(k, save) {
    k = Math.min(Math.max(k, KMIN), maxScale()); state.k = k;
    var d = state.dom;
    d.win.style.width = (W * k) + 'px'; d.win.style.height = (H * k) + 'px';
    d.body.style.transform = 'scale(' + k + ')';
    var r = d.win.getBoundingClientRect(); place(r.left, r.top);
    if (save) lsSet(LS_SCALE, String(k));
  }
  function place(x, y) {          // 화면 밖으로 나가지 않게 제한
    var w = state.dom.win, vw = window.innerWidth, vh = window.innerHeight;
    var ww = W * state.k, hh = H * state.k;
    w.style.left = Math.min(Math.max(0, x), Math.max(0, vw - ww)) + 'px';
    w.style.top = Math.min(Math.max(0, y), Math.max(0, vh - Math.min(hh, 60))) + 'px';
    w.style.right = 'auto';
  }

  /* 슬라이드 스위치 (왼쪽: 올림/반올림/버림, 오른쪽: 소수점 자리수) */
  function renderSliders() {
    state.dom.win.querySelectorAll('.sl[data-sl]').forEach(function (s) {
      var list = s.getAttribute('data-sl') === 'rnd' ? RNDS : DECS, cur = s.getAttribute('data-sl') === 'rnd' ? state.rnd : state.dec;
      var idx = list.indexOf(cur), n = list.length;
      s.querySelector('.knob').style.left = 'calc((100% - 18px) * ' + (idx / (n - 1)) + ')';
      s.querySelectorAll('.dots i').forEach(function (dot, i) { dot.classList.toggle('on', i === idx); });
    });
  }
  function clickSlider(s, e) {
    var kind = s.getAttribute('data-sl'), list = kind === 'rnd' ? RNDS : DECS;
    var r = s.getBoundingClientRect(), idx = Math.min(list.length - 1, Math.max(0, Math.floor((e.clientX - r.left) / r.width * list.length)));
    if (kind === 'rnd') state.rnd = list[idx]; else state.dec = list[idx];
    lsSet(LS_PREF, JSON.stringify({ dec: state.dec, rnd: state.rnd }));
    renderSliders(); update(); state.dom.inp.focus();
  }

  /* 표시 */
  function setAnn(copyFlash) {
    var d = state.dom;
    d.aM.classList.toggle('on', state.mem !== 0);
    d.aG.classList.toggle('on', state.gt !== 0);
    d.aE.classList.toggle('on', state.err);
    d.aC.classList.toggle('on', !!copyFlash);
  }
  function setErr(on) { state.err = !!on; state.dom.inp.classList.toggle('err', !!on); setAnn(); }
  function show(n) {
    var d = state.dom, t = n == null ? '0' : lcdText(n);
    state.last = n;
    d.res.setAttribute('data-v', t);
    d.res.innerHTML = lcdSvg(state.err ? 'E ' + t : t);
  }
  function update() {
    var d = state.dom, v = d.inp.value;
    if (!v.trim()) { show(null); return; }
    try { show(value(v)); }
    catch (e) { /* 입력 중(예: 12+)에는 마지막 값을 그대로 둔다 */ }
  }

  /* 입력 조작 */
  function insertAtCaret(t, fromPaste) {
    var el = state.dom.inp;
    if (state.just && /^[0-9.(]/.test(t)) el.value = '';
    state.just = false; setErr(false);
    var a = el.selectionStart, b = el.selectionEnd;
    if (a == null || (document.activeElement !== el && !fromPaste)) { a = b = el.value.length; }
    el.value = el.value.slice(0, a) + t + el.value.slice(b);
    var p = a + t.length; el.setSelectionRange(p, p);
    update(); el.focus();
  }
  function backspace() {
    var el = state.dom.inp, a = el.selectionStart, b = el.selectionEnd;
    if (a == null || document.activeElement !== el) { a = b = el.value.length; }
    if (a === b && a > 0) a = a - 1;
    el.value = el.value.slice(0, a) + el.value.slice(b);
    el.setSelectionRange(a, a); state.just = false; setErr(false); update(); el.focus();
  }
  function setNum(n) { var el = state.dom.inp; el.value = plain(n); state.just = true; setErr(false); update(); el.focus(); }
  function cur() {                // 현재 입력의 값(없거나 잘못되면 마지막 표시값)
    try { var n = value(state.dom.inp.value); if (n !== null) return n; } catch (e) { return null; }
    return state.last;
  }
  function fail() { setErr(true); show(state.last); state.dom.inp.focus(); }

  function evaluate() {
    var d = state.dom, v = d.inp.value;
    if (!v.trim()) return;
    var n;
    try { n = value(v); } catch (e) { fail(); return; }
    state.gt = Number((state.gt + n).toPrecision(15)); setAnn();
    setNum(n);
  }
  function press(k) {
    var d = state.dom, n;
    switch (k) {
      case 'clear': d.inp.value = ''; state.just = false; setErr(false); update(); d.inp.focus(); break;
      case 'ac': d.inp.value = ''; state.just = false; state.gt = 0; setErr(false); update(); setAnn(); d.inp.focus(); break;
      case 'back': backspace(); break;
      case 'eval': evaluate(); break;
      case 'copy': copyResult(); break;
      case 'pct': insertAtCaret('%'); break;
      case 'sqrt': n = cur(); if (n === null) { fail(); break; } if (n < 0) { fail(); break; } setNum(applyRound(Number(Math.sqrt(n).toPrecision(15)))); break;
      case 'neg': n = cur(); if (n === null) break; setNum(n === 0 ? 0 : -n); break;
      case 'tax+': n = cur(); if (n === null) break; setNum(applyRound(Number((n * 1.1).toPrecision(15)))); break;
      case 'tax-': n = cur(); if (n === null) break; setNum(applyRound(Number((n / 1.1).toPrecision(15)))); break;
      case 'gt': setNum(state.gt); break;
      case 'mc': state.mem = 0; setAnn(); d.inp.focus(); break;
      case 'mr': insertAtCaret(state.mem < 0 ? '(' + plain(state.mem) + ')' : plain(state.mem)); break;
      case 'mplus': case 'mminus':
        n = cur(); if (n === null) break;
        state.mem = Number((state.mem + (k === 'mplus' ? n : -n)).toPrecision(15)); state.just = true; setAnn(); d.inp.focus(); break;
      default: insertAtCaret(k);
    }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext !== false) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    var ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    document.body.appendChild(ta); ta.select();
    var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    if (!ok) throw new Error('copy failed');
  }
  function copyResult() {         // 화면에 보이는 값을 쉼표 없는 숫자로 복사 (입력칸에 그대로 붙여넣기 좋음)
    var n = cur();
    if (n === null) return;
    Promise.resolve().then(function () { return copyText(plain(n)); })
      .then(function () { setAnn(true); clearTimeout(copyResult.t); copyResult.t = setTimeout(function () { setAnn(false); }, 900); })
      .catch(function () { setErr(true); });
  }

  function openCalc() {
    var d = build();
    d.win.classList.add('open'); state.open = true;
    if (!d.win.style.left) { d.win.style.left = Math.max(0, window.innerWidth - W * state.k - 18) + 'px'; d.win.style.top = '64px'; }
    setScale(state.k, false);
    d.inp.focus(); d.inp.select();
  }
  function closeCalc() {
    if (!state.dom) return;
    state.dom.win.classList.remove('open'); state.open = false;
  }
  window.openCalculator_ = function () { if (state.open) closeCalc(); else openCalc(); };    // 버튼으로 열기/닫기 전환
  window.closeCalculator_ = closeCalc;
  window.__calc = { parse: parse, processPaste: processPaste, lcdText: lcdText, state: state };
})();
