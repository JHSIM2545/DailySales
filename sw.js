/* 북서울 영업일보 - 앱 설치(PWA)용 서비스워커.
   데이터가 항상 최신이어야 하므로 캐시하지 않고 네트워크 요청을 그대로 통과시킨다. */
self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function(){ /* 네트워크 그대로 사용 */ });
