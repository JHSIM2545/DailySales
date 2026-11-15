/* 북서울 영업일보 - 앱 설치 버튼 + 서비스워커 등록 */
(function(){
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function(){ navigator.serviceWorker.register('sw.js').catch(function(e){ console.warn('[pwa] sw 등록 실패', e); }); });
  }
  var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (standalone) return;                       // 이미 앱으로 실행 중이면 버튼 숨김
  var wantBtn = /Login\.html/i.test(location.pathname) || /\/$/.test(location.pathname);
  var deferred = null;
  function makeBtn(){
    if (!wantBtn || document.getElementById('pwaInstallBtn')) return;
    var b = document.createElement('button');
    b.id = 'pwaInstallBtn'; b.type = 'button'; b.textContent = '📲 앱으로 설치';
    b.style.cssText = 'position:fixed; right:14px; bottom:14px; z-index:99998; padding:9px 14px; border:none; border-radius:20px; background:#5c1c2f; color:#fff; font-size:13px; font-weight:700; box-shadow:0 2px 8px rgba(0,0,0,.3); cursor:pointer;';
    b.onclick = function(){
      if (deferred) {
        deferred.prompt();
        deferred.userChoice.then(function(){ deferred = null; b.remove(); });
      } else {
        var ua = navigator.userAgent || '';
        if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) {
          alert('아이폰/아이패드: Safari 하단의 공유(□↑) 버튼 → "홈 화면에 추가"를 누르세요.');
        } else {
          alert('브라우저 메뉴(⋮) → "앱 설치" 또는 "홈 화면에 추가"를 눌러 설치하세요.');
        }
      }
    };
    document.body.appendChild(b);
  }
  window.addEventListener('beforeinstallprompt', function(e){ e.preventDefault(); deferred = e; if (document.body) makeBtn(); else document.addEventListener('DOMContentLoaded', makeBtn); });
  window.addEventListener('appinstalled', function(){ var b = document.getElementById('pwaInstallBtn'); if (b) b.remove(); });
  // 설치 이벤트를 못 받는 브라우저(iOS Safari 등)에서도 안내 버튼 표시
  document.addEventListener('DOMContentLoaded', function(){ setTimeout(makeBtn, 800); });
})();
