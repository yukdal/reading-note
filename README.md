# 독서노트

읽은 책과 읽을 책을 책장처럼 쌓아두고, 책마다 마인드맵(또는 아웃라인)으로 생각을 정리하는 개인용 웹앱입니다.
인터넷이 없어도 "데모 모드"로 바로 써볼 수 있고, Supabase를 연결하면 로그인 후 여러 기기에서 같은 책장을 봅니다.
이 문서는 **다른 PC로 폴더를 옮긴 뒤 이 문서만 보고 다시 실행**할 수 있도록 정리했습니다.

## 1. 준비물

- **Node.js** — 이 저장소는 GitHub Actions 배포 설정(`.github/workflows/deploy.yml`)에서 **Node.js 24**를 사용합니다.
  (쓰고 있는 도구들의 `package-lock.json` 요구사항상 최소 20.19 이상이면 대부분 동작하지만, 배포 환경과 맞추려면 24를 쓰세요.)
  [nodejs.org](https://nodejs.org)에서 설치하거나, 이미 여러 버전을 쓰고 있다면 nvm 등으로 24로 맞추세요.
- 폴더를 옮길 때 **`node_modules`와 `dist` 폴더는 복사하지 않습니다.** (용량만 크고, 새 PC에서 다시 설치하면 됩니다.)
  복사가 끝나면 이 폴더 안에서 아래 "2. 바로 실행"부터 따라 하세요.

## 2. 바로 실행해보기 (데모 모드)

Supabase를 아직 연결하지 않아도 가짜 책 데이터로 화면을 바로 볼 수 있습니다.

```
npm install
```
여러 패키지 이름이 쭉 나오고 마지막에 `added N packages` 같은 문구가 보이면 성공입니다.

```
npm run dev
```
`Local: http://localhost:5173/` 같은 주소가 출력됩니다. 이 주소를 브라우저로 열어보세요.

브라우저에 노란 띠로 "데모 모드 — Supabase 설정 전입니다..." 라는 안내와 책장이 보이면 정상입니다.
이 상태에서는 처음에는 예제 책이 보이며, 책 목록과 마인드맵 편집 내용은 이 브라우저(IndexedDB)에 저장되어 새로고침 후에도 유지됩니다. 다른 기기와 동기화되지는 않습니다.
dev 서버를 멈추려면 터미널에서 `Ctrl+C`를 누르세요.

### 데모 모드에서 JSON 가져오기

책장 아래 **JSON 가져오기 → 백업 파일 선택**에서 앱 형식의 JSON 파일을 고릅니다.
추가·변경·동일 권수와 제목을 확인하고 **적용**을 누르면 브라우저 책장에 저장됩니다.
취소하거나 잘못된 파일을 선택하면 기존 내용은 유지됩니다. 미저장 초안이 있으면 해당 책에서 먼저 저장해야 합니다.
파일에 없는 책은 삭제하지 않습니다. 같은 id의 기존 책은 파일 내용으로 변경되며 가지 자동 병합은 하지 않습니다.
이 기능은 .xmind 파일 직접 읽기가 아니라 books·mindmaps 배열이 있는 JSON 가져오기입니다.
브라우저 데이터를 지우면 기록도 사라집니다. 서버 저장과 전체 JSON 내보내기는 Supabase 연결 후 사용할 수 있습니다.

## 3. 검사하기

```
npm test
```
`Test Files  N passed`, `Tests  N passed` 같은 줄이 초록색으로 보이면 통과입니다.

```
npm run build
```
타입 검사와 빌드가 함께 돌며, 마지막에 `dist/...` 파일 목록과 `build completed` 류의 메시지가 보이면 성공입니다.
(이 명령이 실패하면 코드에 타입 오류가 있다는 뜻이니, 화면에 나온 파일/줄 번호를 먼저 확인하세요.)

## 4. Supabase 연결하기 (실제 로그인 + 서버 저장)

데모 모드를 벗어나 실제로 로그인하고 여러 기기에서 같은 데이터를 보려면 Supabase 프로젝트가 필요합니다.
아래 메뉴 이름·위치는 Supabase가 바꿀 수 있습니다(화면 위치는 바뀔 수 있음).

1. [supabase.com](https://supabase.com)에서 프로젝트를 하나 만듭니다.
2. Supabase 대시보드 왼쪽 메뉴의 **SQL Editor**를 열고, 이 저장소의 `supabase/migrations/0001_init.sql` 파일 **전체**를 복사해 붙여넣은 뒤 실행합니다.
   - 성공하면 테이블·함수가 만들어집니다.
3. 같은 파일의 **맨 끝 주석**에 있는 "실행 후 확인용 쿼리" 5개를 하나씩 SQL Editor에 복사해 실행해 보세요.
   - RLS가 켜져 있는지, 테이블 권한이 의도대로인지, 비로그인/직접 쓰기가 거부되는지를 확인하는 쿼리입니다.
   - 주석에 적힌 "이게 나와야 정상" 문구와 실제 결과가 같은지 비교하세요.
4. **Authentication > Users**(화면 위치는 바뀔 수 있음)에서 이메일 계정을 **1개** 직접 만듭니다.
   - 이 앱에는 회원가입 화면이 없습니다(로그인 + 비밀번호 재설정만). 계정은 관리자(나)가 대시보드에서 만듭니다.
5. **Authentication > Settings**(화면 위치는 바뀔 수 있음)에서 "새 사용자 가입 허용"류의 옵션을 꺼서 **신규 가입을 차단**하세요.
6. 프로젝트 루트의 `.env.example`을 복사해 `.env.local` 파일을 만들고, Supabase 대시보드의 **Project Settings > API Keys**에서 URL과 publishable key를 복사해 채웁니다.
   - **secret key(`sb_secret_...`)는 절대 넣지 마세요.** `VITE_` 로 시작하는 값은 브라우저에 그대로 노출됩니다.
7. `npm run dev`로 다시 실행하면 노란 데모 배너가 사라지고 로그인 화면이 보입니다. 4번에서 만든 이메일/비밀번호로 로그인하세요.

## 5. GitHub Pages로 배포하기

현재 서비스: https://yukdal.github.io/reading-note/
소스 저장소: https://github.com/yukdal/reading-note

전용 저장소와 Actions 자동 배포를 설정했습니다. main 변경 시 테스트 112개와 빌드가 통과하면 게시됩니다.
현재 저장소 이름은 reading-note이며, workflow의 빌드 경로도 /reading-note/입니다. 저장소 이름을 바꾸면 이 경로도 변경해야 합니다.
아래 순서는 새 저장소에 다시 배포할 때 참고하세요.

1. GitHub에 새 저장소를 만들고 이 폴더를 push 합니다.
2. 저장소 **Settings > Pages**(화면 위치는 바뀔 수 있음)에서 **Source**를 "GitHub Actions"로 바꿉니다.
3. 저장소 **Settings > Secrets and variables > Actions > Variables** 탭(화면 위치는 바뀔 수 있음)에 변수 2개를 추가합니다.
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - (`.github/workflows/deploy.yml`가 빌드할 때 이 변수들을 읽어 씁니다.)
4. `main` 브랜치에 push하면 Actions 탭에서 배포가 자동으로 돌아갑니다. `npm test`가 실패하면 배포(deploy) 단계는 실행되지 않습니다.
5. 배포가 끝나면 나온 Pages 주소(`https://<사용자명>.github.io/<저장소명>/` 형태)를 Supabase 대시보드의
   **Authentication > URL Configuration**(화면 위치는 바뀔 수 있음)의 **Site URL**과 **Redirect URLs**에 등록하세요.
   - 비밀번호 재설정 메일의 복귀 링크가 이 주소로 돌아오기 때문에 꼭 필요합니다.

## 6. Google Drive 주간 백업 설정하기

`scripts/backup.gs`는 Google Apps Script로, Supabase 데이터를 매주 한 번 Google Drive에 JSON 파일로 백업합니다.
설정 순서는 파일 맨 위 주석에 있고, 요약하면:

1. Apps Script 편집기에서 새 프로젝트를 만들고 `backup.gs` 내용을 붙여넣습니다.
2. 프로젝트 설정(톱니바퀴) > **스크립트 속성**에 3개를 추가합니다: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`(secret key, 공개 금지), `BACKUP_FOLDER_ID`(백업을 넣을 Drive 폴더 id).
3. `backupSupabaseToDrive` 함수를 한 번 수동 실행해 권한을 승인하고, Drive에 파일이 생기는지 확인합니다.
4. 트리거를 추가합니다: `backupSupabaseToDrive` / 시간 기반 / 주 단위. 실패 시 메일로 알림을 받도록 오류 알림 설정을 "즉시 알림"으로 둡니다.

오래된 백업 파일을 자동으로 지우는 기능은 일부러 넣지 않았습니다(실수로 지우는 쪽이 더 위험하다고 판단).

## 7. 백업 파일로 복원하기

앱 안에서(책장 화면, 로그인한 뒤) **백업 > 가져오기**에서 백업 JSON 파일(6번에서 만든 파일 또는 앱의 "내보내기"로 만든 파일)을 선택하면
추가/변경될 책 목록을 미리 보여줍니다. 내용을 확인한 뒤 "적용"을 누르면 반영됩니다. 파일에 없는 기존 책은 그대로 유지됩니다.

## 8. 문제 해결

- **연결 실패 / 책 목록이 안 보임**: 화면에 재시도 버튼이 보이면 인터넷 연결을 확인하고 눌러보세요. Supabase 무료 플랜은 일주일 가량
  쓰지 않으면 프로젝트가 자동으로 일시정지됩니다 — Supabase 대시보드에 들어가 보면 "프로젝트가 일시정지됨" 안내와 복구(Restore) 버튼이
  보일 것입니다. 복구한 뒤 다시 시도하세요.
- **"다른 기기에서 수정됨"이 뜸**: 같은 책을 다른 브라우저/기기에서 먼저 바꾼 경우입니다. 책 정보 수정은 최신 내용을 자동으로 다시 불러오니
  확인 후 다시 수정하면 됩니다. 마인드맵 편집 중이었다면 "최신본 불러오기"(초안 버림) 또는 "내 초안 내보내기"(파일로 저장 후 수동 비교) 중 선택하세요.
- **로그인이 안 됨**: 이메일/비밀번호가 맞는지 다시 확인하세요. 이 앱은 회원가입 화면이 없으므로, 계정이 없다면 4번 "Supabase 연결하기"의
  4단계대로 Supabase 대시보드에서 직접 계정을 만들어야 합니다. 비밀번호를 잊었다면 로그인 화면의 "비밀번호를 잊으셨나요"로 재설정 메일을 받으세요
  (메일의 복귀 주소가 5번 "GitHub Pages로 배포하기"에서 등록한 주소와 일치해야 동작합니다).

## 9. 연결·검증 상태

확인일: 2026-11-15. 현재 연결 대상은 서울 리전의 전용 Supabase 프로젝트 **reading-note**입니다.
프로젝트 URL은 https://ebocymgrroaadormiywu.supabase.co 이며, .env.local에는 프로젝트 URL과 publishable key만 들어 있습니다.
초기화 SQL은 이미 적용했습니다. **현재 프로젝트에 0001_init.sql을 다시 실행하지 마세요.** 다른 새 프로젝트를 준비할 때만 적용합니다.

| 확인한 항목 | 결과 |
| --- | --- |
| 본인 계정 로그인 | 앱에서 로그인한 책장 확인 |
| 가입 제한 | 신규 가입 차단, 이메일 로그인 유지. 실제 Auth settings API로도 확인 |
| 책 저장 | [연결 확인용] 독서노트 생성 후 새로고침으로 복원 확인 |
| 맵 저장 | 노드 작성·저장·새로고침 후 내용 유지 확인 |
| 접근 권한 | RLS, 익명 조회 차단, 테이블 직접 쓰기 차단, 함수별 실행 권한 분리 확인 |
| 충돌·소유권 | supabase/verify_runtime.sql로 실제 DB에서 오래된 버전 거부·타인/비로그인 쓰기 거부 확인. 임시 변경은 ROLLBACK |
| 자동 검사 | 로컬 및 GitHub Actions에서 테스트 112개 통과, 타입 검사와 빌드 성공 |
| 온라인 배포 | GitHub Pages 게시 성공. HTTPS에서 로그인·책장·마인드맵·아웃라인 확인 |
| 온라인 저장 | 연결 확인용 노드 수정 후 저장됨 표시, 새로고침 후 내용 유지 확인. 별도 로컬 실행 주소에서도 같은 서버 내용 확인 |
| 모바일 화면 | 390px 너비의 별도 브라우저 탭에서 로그인된 마인드맵·하단 도구와 화면 맞춤 확인. 실제 안드로이드 터치는 미검증 |
| 인증 복귀 주소 | Site URL 및 Redirect URLs에 https://yukdal.github.io/reading-note/ 저장 후 새로고침으로 유지 확인 |

실서버 검증 중 발견한 JSON 필드 순서에 따른 허위 충돌과 저장 후 초안 미정리를 수정했습니다.
저장 중 추가한 초안은 보존하며, 응답이 늦게 도착해도 더 최신인 로컬 저장본을 되돌리지 않습니다.

다음은 아직 확인하지 않았습니다: 실제 두 기기 간 동시 편집, 안드로이드 실기기 조작,
비밀번호 재설정 메일의 실제 복귀, 서버 백업 파일 내보내기·가져오기, Apps Script 예약 백업·복원.
데모 브라우저 기록은 서버로 자동 이전하지 않았으며 별도 브라우저 캐시에 남아 있습니다.

기준 소스는 GitHub 저장소(yukdal/reading-note)입니다. Google Drive 폴더는 GitHub 최신본을 복사해 둔 사본이며, 수정은 git으로 받은 폴더에서 한 뒤 push하고 Drive로 복사합니다. reading-note.zip은 2026-11-14의 옛 사본입니다.


## 10. 폴더 구조 한눈에 보기

```
index.html                              앱이 시작되는 HTML 한 장
src/
  main.tsx                              React를 화면에 그리는 시작점 (ErrorBoundary로 App을 감쌈)
  ErrorBoundary.tsx                      렌더링 오류를 잡아 안내 화면을 보여줌
  App.tsx                                라우팅 + 데모/실제 모드 분기 + 책장 화면 전체 조립
  styles.css                             전체 스타일(휴대폰 대응 포함)
  types.ts                               Book/Mindmap 등 공용 타입
  vite-env.d.ts                          Vite 환경변수 타입 선언
  data/
    demo.ts                              데모 모드용 가짜 책 14권
    api.ts                               Supabase RPC 호출 + 오류 분류(classifyError)
    api.test.ts                          classifyError 테스트
    demoStorage.ts / .test.ts            데모 모드용 브라우저(IndexedDB) 책장 저장
    xmindExample.ts / .test.ts           XMind 예제 책과 마인드맵 데이터
  lib/
    supabase.ts                          Supabase 클라이언트 생성(env 없으면 null → 데모 모드)
    localCache.ts                        브라우저 IndexedDB 캐시(맵 임시저장/저장본, 책 목록 캐시)
  features/
    auth/AuthScreen.tsx                  로그인 / 비밀번호 찾기 / 새 비밀번호 설정 화면
    books/
      Bookshelf.tsx                      책장(정렬·필터·책등) 화면
      BookDialog.tsx                     책 상세 보기 다이얼로그
      BookForm.tsx                       책 추가/수정 폼 다이얼로그
      bookInput.ts / .test.ts            폼 입력값 검증(순수 함수) + 테스트
    mindmap/
      model.ts / .test.ts                마인드맵 노드 조작(순수 함수) + 테스트
      MindmapEditor.tsx                  Mind Elixir 기반 맵 편집 화면
      OutlineEditor.tsx                  글 목록(아웃라인) 형태 편집 화면
      mindElixirAdapter.ts / .test.ts    내부 노드 배열 ↔ Mind Elixir 데이터 변환
      useAutosave.ts / .test.ts          디바운스 자동 저장 로직
      draftReconcile.ts / .test.ts       로컬 초안 ↔ 서버본 대조 규칙(순수 함수)
      RealMapEditorScreen.tsx            실제 모드의 맵/아웃라인 화면(오프라인·충돌·인증 오류 처리 포함)
    backup/
      backup.ts / .test.ts               백업 내보내기/가져오기 로직(검증·대조 포함)
      BackupPanel.tsx                    백업 내보내기/가져오기 화면
supabase/migrations/0001_init.sql        DB 테이블·RLS·RPC 함수 전체(맨 끝에 확인용 쿼리 포함)
scripts/backup.gs                        Google Apps Script 주간 백업(맨 위 주석에 설정 순서)
.github/workflows/deploy.yml             GitHub Pages 자동 배포 설정
```
