/* =====================================================================
 * calculator.js — 북서울지사 영업일보 포털 공용 계산기 (팝업)
 *  - Admin.html / User.html 우측 상단 "계산기" 버튼(#calcTopBtn)에서 열고 닫는다. (같은 폴더에 배포)
 *  - 모달이 아니라 떠 있는 창이라 화면의 숫자를 복사해 바로 붙여넣을 수 있다. 제목줄을 끌어 위치 이동.
 *  - 붙여넣기: 쉼표·공백·원/₩·한글 단위는 제거. 여러 줄(표에서 복사한 열)은 '+' 로 연결해 합계식으로 만든다.
 *  - 수식은 eval 을 쓰지 않고 직접 파싱한다. 지원: + − × ÷ ( ) % (10% = 0.1), 소수점, 음수
 * ===================================================================== */
(function () {
  'use strict';
  if (window.openCalculator_) return;

  var MAX_HIST = 10;
  var state = { open: false, just: false, hist: [], last: null, dom: null, dragging: null };

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
      if (!m) throw new Error('수식을 확인해 주세요');
      i += m[0].length; return parseFloat(m[0]);
    }
    function primary() {
      if (peek() === '(') {
        i++; var v = expr();
        if (peek() !== ')') throw new Error('괄호를 확인해 주세요');
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
        else if (c === '/') { i++; var d = unary(); if (d === 0) throw new Error('0으로 나눌 수 없습니다'); v = v / d; }
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
    if (i !== s.length) throw new Error('수식을 확인해 주세요');
    if (!isFinite(out)) throw new Error('계산할 수 없는 값입니다');
    out = Number(out.toPrecision(15));       // 0.1+0.2 같은 부동소수 오차 정리
    return out === 0 ? 0 : out;
  }

  function fmt(n) { return n.toLocaleString('ko-KR', { maximumFractionDigits: 10 }); }
  function plain(n) { return n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 10 }); }
  function readKo(n) {            // 정수 결과의 한글 단위 읽기: 123456789 → 1억 2,345만 6,789
    if (n !== Math.round(n)) return '';
    var a = Math.abs(n); if (a < 10000 || a >= 1e16) return '';
    var out = [];
    [['조', 1e12], ['억', 1e8], ['만', 1e4]].forEach(function (u) {
      var q = Math.floor(a / u[1]);
      if (q > 0) { out.push(q.toLocaleString('ko-KR') + u[0]); a -= q * u[1]; }
    });
    if (a > 0) out.push(a.toLocaleString('ko-KR'));
    return (n < 0 ? '-' : '') + out.join(' ');
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

  /* ------------------------------------------------------------------ 화면 */
  function injectStyle() {
    if (document.getElementById('calc-style')) return;
    var css = [
      '#calcWin{position:fixed;top:64px;right:18px;width:min(320px,calc(100vw - 16px));z-index:2000000;background:#fff;border:1px solid #94a3b8;border-radius:10px;box-shadow:0 10px 34px rgba(15,23,42,.35);font-family:inherit;color:#0f172a;display:none;user-select:none;-webkit-user-select:none;}',
      '#calcWin.open{display:block;}',
      '#calcWin .cw-title{display:flex;align-items:center;gap:6px;padding:7px 8px 7px 12px;background:#1f2937;color:#fff;border-radius:9px 9px 0 0;cursor:move;touch-action:none;font-size:13px;font-weight:700;}',
      '#calcWin .cw-title .sp{flex:1;}',
      '#calcWin .cw-title button{background:transparent;border:0;color:#cbd5e1;font-size:16px;cursor:pointer;padding:0 4px;line-height:1;}',
      '#calcWin .cw-title button:hover{color:#fff;}',
      '#calcWin .cw-body{padding:10px;}',
      '#calcWin input.cw-in{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:6px;padding:8px 10px;font-size:20px;text-align:right;font-variant-numeric:tabular-nums;user-select:text;-webkit-user-select:text;background:#fff;color:#0f172a;}',
      '#calcWin input.cw-in:focus{outline:2px solid #2563eb;outline-offset:0;border-color:#2563eb;}',
      '#calcWin input.cw-in.err{border-color:#dc2626;background:#fef2f2;}',
      '#calcWin .cw-res{text-align:right;font-size:26px;font-weight:700;min-height:34px;margin-top:6px;font-variant-numeric:tabular-nums;word-break:break-all;user-select:text;-webkit-user-select:text;}',
      '#calcWin .cw-res.dim{color:#94a3b8;}',
      '#calcWin .cw-sub{text-align:right;font-size:12px;color:#64748b;min-height:16px;user-select:text;-webkit-user-select:text;}',
      '#calcWin .cw-msg{font-size:12px;min-height:16px;text-align:right;color:#16a34a;}',
      '#calcWin .cw-msg.e{color:#dc2626;}',
      '#calcWin .cw-copy{display:flex;gap:6px;margin:4px 0 8px;}',
      '#calcWin .cw-copy button{flex:1;border:1px solid #cbd5e1;background:#f8fafc;border-radius:6px;padding:5px 0;font-size:12px;cursor:pointer;color:#334155;}',
      '#calcWin .cw-copy button:hover{background:#eef2f7;}',
      '#calcWin .cw-pad{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;}',
      '#calcWin .cw-pad button{border:1px solid #cbd5e1;background:#f1f5f9;border-radius:7px;padding:10px 0;font-size:17px;font-weight:600;cursor:pointer;color:#0f172a;}',
      '#calcWin .cw-pad button:hover{background:#e2e8f0;}',
      '#calcWin .cw-pad button:active{background:#cbd5e1;}',
      '#calcWin .cw-pad button.op{background:#e0e7ff;color:#3730a3;}',
      '#calcWin .cw-pad button.fn{background:#fee2e2;color:#991b1b;}',
      '#calcWin .cw-pad button.eq{background:#2563eb;color:#fff;grid-column:span 3;}',
      '#calcWin .cw-pad button.eq:hover{background:#1d4ed8;}',
      '#calcWin .cw-hist{margin-top:8px;border-top:1px solid #e2e8f0;padding-top:6px;max-height:130px;overflow:auto;}',
      '#calcWin .cw-hist .h{display:flex;gap:8px;justify-content:space-between;font-size:12px;padding:3px 4px;border-radius:4px;cursor:pointer;color:#334155;font-variant-numeric:tabular-nums;}',
      '#calcWin .cw-hist .h:hover{background:#eef2f7;}',
      '#calcWin .cw-hist .h .x{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#64748b;}',
      '#calcWin .cw-hist .h .r{font-weight:700;white-space:nowrap;}',
      '#calcWin .cw-histhead{display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;margin-top:8px;}',
      '#calcWin .cw-histhead a{cursor:pointer;text-decoration:underline;}',
      '#calcWin .cw-tip{font-size:11px;color:#94a3b8;margin-top:6px;line-height:1.35;}'
    ].join('\n');
    var st = document.createElement('style'); st.id = 'calc-style'; st.textContent = css; document.head.appendChild(st);
  }

  var KEYS = [
    ['C', 'fn', 'clear'], ['⌫', 'fn', 'back'], ['(', 'op', '('], [')', 'op', ')'],
    ['7', '', '7'], ['8', '', '8'], ['9', '', '9'], ['÷', 'op', '÷'],
    ['4', '', '4'], ['5', '', '5'], ['6', '', '6'], ['×', 'op', '×'],
    ['1', '', '1'], ['2', '', '2'], ['3', '', '3'], ['−', 'op', '−'],
    ['0', '', '0'], ['00', '', '00'], ['.', '', '.'], ['+', 'op', '+'],
    ['%', 'op', '%'], ['=', 'eq', 'eval']
  ];

  function build() {
    if (state.dom) return state.dom;
    injectStyle();
    var w = document.createElement('div'); w.id = 'calcWin'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-label', '계산기');
    w.innerHTML =
      '<div class="cw-title" id="calcTitle"><span>🧮 계산기</span><span class="sp"></span><button type="button" id="calcClose" title="닫기 (Esc)" aria-label="닫기">✕</button></div>' +
      '<div class="cw-body">' +
        '<input class="cw-in" id="calcIn" type="text" inputmode="decimal" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" placeholder="숫자·수식 입력 또는 붙여넣기">' +
        '<div class="cw-res dim" id="calcRes">0</div>' +
        '<div class="cw-sub" id="calcSub"></div>' +
        '<div class="cw-msg" id="calcMsg"></div>' +
        '<div class="cw-copy"><button type="button" data-cp="plain" title="쉼표 없는 숫자로 복사 (입력칸에 그대로 붙여넣기 좋음)">결과 복사</button><button type="button" data-cp="comma" title="천단위 쉼표 포함하여 복사">쉼표 포함 복사</button></div>' +
        '<div class="cw-pad" id="calcPad">' + KEYS.map(function (k) {
          return '<button type="button" class="' + k[1] + '" data-k="' + k[2] + '">' + k[0] + '</button>';
        }).join('') + '</div>' +
        '<div class="cw-histhead"><span>계산 내역 (누르면 결과를 불러옴)</span><a id="calcHistClr">지우기</a></div>' +
        '<div class="cw-hist" id="calcHist"></div>' +
        '<div class="cw-tip">표에서 복사한 숫자를 붙여넣으면 쉼표·단위는 자동 제거, 여러 줄은 합계식(a+b+c)으로 입력됩니다. Enter = 계산</div>' +
      '</div>';
    document.body.appendChild(w);
    var d = state.dom = {
      win: w, inp: w.querySelector('#calcIn'), res: w.querySelector('#calcRes'), sub: w.querySelector('#calcSub'),
      msg: w.querySelector('#calcMsg'), hist: w.querySelector('#calcHist'), title: w.querySelector('#calcTitle')
    };

    // 포털의 단축키/전역 핸들러와 충돌하지 않도록 계산기 안의 키 입력은 밖으로 전달하지 않는다
    ['keydown', 'keyup', 'keypress'].forEach(function (ev) { w.addEventListener(ev, function (e) { e.stopPropagation(); }); });
    w.querySelector('#calcClose').addEventListener('click', closeCalc);
    w.querySelector('#calcHistClr').addEventListener('click', function () { state.hist = []; renderHist(); d.inp.focus(); });

    d.inp.addEventListener('input', function () { state.just = false; update(); });
    d.inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === '=') { e.preventDefault(); evaluate(); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeCalc(); return; }
      if (state.just && !e.ctrlKey && !e.metaKey && !e.altKey && /^[0-9.(]$/.test(e.key)) d.inp.value = '';   // 계산 직후 숫자를 치면 새 계산
    });
    d.inp.addEventListener('paste', function (e) {
      var t = (e.clipboardData || window.clipboardData);
      if (!t) return;
      e.preventDefault();
      var r = processPaste(t.getData('text'));
      if (!r.text) { flash('붙여넣을 숫자가 없습니다', true); return; }
      insertAtCaret(r.text, true);
      if (r.sum) flash(r.count + '개 숫자를 합계식으로 붙여넣었습니다');
    });
    d.inp.addEventListener('drop', function (e) { e.preventDefault(); });

    w.querySelector('#calcPad').addEventListener('mousedown', function (e) { e.preventDefault(); });   // 입력칸 포커스 유지
    w.querySelector('#calcPad').addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button[data-k]'); if (!b) return;
      var k = b.getAttribute('data-k');
      if (k === 'clear') { d.inp.value = ''; state.just = false; update(); d.inp.focus(); }
      else if (k === 'back') backspace();
      else if (k === 'eval') evaluate();
      else insertAtCaret(k);
    });
    w.querySelector('.cw-copy').addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button[data-cp]'); if (!b) return;
      copyResult(b.getAttribute('data-cp'));
    });
    d.hist.addEventListener('click', function (e) {
      var h = e.target.closest && e.target.closest('.h'); if (!h) return;
      var item = state.hist[Number(h.getAttribute('data-i'))]; if (!item) return;
      d.inp.value = plain(item.res); state.just = true; update(); d.inp.focus();
    });

    // 제목줄 드래그
    d.title.addEventListener('pointerdown', function (e) {
      if (e.target.closest && e.target.closest('button')) return;
      var r = w.getBoundingClientRect();
      state.dragging = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      w.style.left = r.left + 'px'; w.style.top = r.top + 'px'; w.style.right = 'auto';
      try { d.title.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    });
    d.title.addEventListener('pointermove', function (e) {
      if (!state.dragging) return;
      place(e.clientX - state.dragging.dx, e.clientY - state.dragging.dy);
    });
    var endDrag = function () { state.dragging = null; };
    d.title.addEventListener('pointerup', endDrag); d.title.addEventListener('pointercancel', endDrag);
    window.addEventListener('resize', function () { if (state.open) { var r = w.getBoundingClientRect(); place(r.left, r.top); } });

    renderHist();
    return d;
  }

  function place(x, y) {          // 화면 밖으로 나가지 않게 제한
    var w = state.dom.win, vw = window.innerWidth, vh = window.innerHeight;
    var maxX = Math.max(0, vw - w.offsetWidth), maxY = Math.max(0, vh - 40);
    w.style.left = Math.min(Math.max(0, x), maxX) + 'px';
    w.style.top = Math.min(Math.max(0, y), maxY) + 'px';
    w.style.right = 'auto';
  }

  function insertAtCaret(t, fromPaste) {
    var el = state.dom.inp;
    if (state.just && /^[0-9.(]/.test(t)) el.value = '';
    state.just = false;
    var a = el.selectionStart, b = el.selectionEnd;
    if (a == null || (document.activeElement !== el && !fromPaste)) { a = b = el.value.length; }
    el.value = el.value.slice(0, a) + t + el.value.slice(b);
    var p = a + t.length; el.setSelectionRange(p, p);
    update(); el.focus();
  }
  function backspace() {
    var el = state.dom.inp, a = el.selectionStart, b = el.selectionEnd;
    if (a == null) { a = b = el.value.length; }
    if (a === b && a > 0) a = a - 1;
    el.value = el.value.slice(0, a) + el.value.slice(b);
    el.setSelectionRange(a, a); state.just = false; update(); el.focus();
  }

  function flash(msg, isErr) {
    var m = state.dom.msg; m.textContent = msg; m.className = 'cw-msg' + (isErr ? ' e' : '');
    clearTimeout(flash.t); flash.t = setTimeout(function () { m.textContent = ''; }, 2600);
  }

  function showResult(n) {
    var d = state.dom;
    state.last = n;
    d.inp.classList.remove('err');
    if (n == null) { d.res.textContent = '0'; d.res.className = 'cw-res dim'; d.sub.textContent = ''; return; }
    d.res.textContent = fmt(n); d.res.className = 'cw-res'; d.sub.textContent = readKo(n);
  }
  function update() {
    var d = state.dom, v = d.inp.value;
    if (!v.trim()) { showResult(null); return; }
    try { showResult(parse(v)); }
    catch (e) { state.last = null; d.res.className = 'cw-res dim'; d.sub.textContent = ''; }   // 입력 중(예: 12+)에는 오류 표시 없이 대기
  }
  function evaluate() {
    var d = state.dom, v = d.inp.value;
    if (!v.trim()) return;
    var n;
    try { n = parse(v); }
    catch (e) { d.inp.classList.add('err'); flash(e.message || '수식을 확인해 주세요', true); return; }
    var exprShown = normalize(v).replace(/\*/g, '×').replace(/\//g, '÷').replace(/([+\-×÷])/g, ' $1 ').replace(/\s+/g, ' ').trim();
    if (!/^-?[\d.]+$/.test(normalize(v))) {            // 숫자 하나만 입력한 경우는 내역에 남기지 않음
      state.hist.unshift({ expr: exprShown, res: n });
      if (state.hist.length > MAX_HIST) state.hist.pop();
      renderHist();
    }
    d.inp.value = plain(n); state.just = true;
    showResult(n); d.inp.focus();
  }
  function renderHist() {
    var d = state.dom;
    d.hist.innerHTML = state.hist.length ? state.hist.map(function (h, i) {
      return '<div class="h" data-i="' + i + '"><span class="x" title="' + h.expr.replace(/"/g, '&quot;') + '">' + h.expr.replace(/</g, '&lt;') + '</span><span class="r">= ' + fmt(h.res) + '</span></div>';
    }).join('') : '<div class="h" style="cursor:default;color:#94a3b8;">아직 계산 내역이 없습니다</div>';
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
  function copyResult(kind) {
    var d = state.dom, n = state.last;
    if (n == null) { try { n = parse(d.inp.value); } catch (e) { n = null; } }
    if (n == null) { flash('복사할 결과가 없습니다', true); return; }
    var text = kind === 'comma' ? fmt(n) : plain(n);
    Promise.resolve().then(function () { return copyText(text); })
      .then(function () { flash('복사됨: ' + text); })
      .catch(function () { flash('복사하지 못했습니다. 결과를 직접 선택해 복사해 주세요', true); });
  }

  function openCalc() {
    var d = build();
    d.win.classList.add('open'); state.open = true;
    var r = d.win.getBoundingClientRect(); place(r.left, r.top);
    d.inp.focus(); d.inp.select();
  }
  function closeCalc() {
    if (!state.dom) return;
    state.dom.win.classList.remove('open'); state.open = false;
  }
  window.openCalculator_ = function () { if (state.open) closeCalc(); else openCalc(); };    // 버튼으로 열기/닫기 전환
  window.closeCalculator_ = closeCalc;
  window.__calc = { parse: parse, processPaste: processPaste, readKo: readKo, state: state };
})();
