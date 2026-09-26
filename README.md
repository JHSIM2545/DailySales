# 에스원 북서울지사 영업일보 관리 포털 (Supabase + GitHub Pages)

본 포털은 기존 Google Apps Script(구글 시트) 기반 시스템을 Supabase PostgreSQL 데이터베이스 및 GitHub Pages 환경으로 100% 이관한 버전입니다.

## 파일 구성
1. `Login.html` : 사용자 로그인 및 회원가입 화면 (Supabase Auth 연동)
2. `Admin.html` : 지사장 및 관리자 전용 포털 (수주개시, 해약중지, 인상인하, 재개시, 상품일보, 종합대시보드 등)
3. `Index.html` : 일반 사용자용 영업일보 조회 화면
4. `supabase-adapter.js` : 구글 시트 API를 Supabase DB 쿼리로 변환해주는 핵심 브릿지 모듈

## GitHub Pages 배포 안내
1. 이 압축파일의 내용물을 GitHub 리포지토리(`JHSIM2545/DailySales`)의 루트 디렉터리에 그대로 업로드(Commit)합니다.
2. GitHub 저장소의 `Settings` -> `Pages`에서 `Source`를 `Deploy from a branch` (main / root)로 지정합니다.
3. 배포 완료 후 `https://jhsim2545.github.io/DailySales/Login.html` 로 접속하시면 됩니다.
