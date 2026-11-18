# 독서노트 작업 안내 (인수인계 메모)

마지막 갱신: 2026-11-19

이 파일은 다른 PC나 새 대화에서 작업을 이어가기 위한 메모입니다. Claude Code는 이 파일을 자동으로 읽습니다.
**이 저장소는 공개(public)입니다.** 이 파일과 커밋에 개인 정보, 계정 정보, 키를 적지 마세요.

## 사용자와 일하는 방식
- 쉬운 한국어로 설명한다. 전문 용어는 풀어서 말한다.
- 고치기 전에 무엇을 어떻게 고칠지 정리해 보여 주고, 사용자가 고르게 한다.
- 실제로 확인한 것과 코드만 읽고 판단한 것을 구분해서 보고한다. 확인하지 못한 것은 그렇다고 말한다.
- 작업이 끝나면 GitHub과 구글 드라이브 사본 양쪽에 저장한다(아래 "저장 순서").

## 프로젝트 한눈에
- 사이트: https://yukdal.github.io/reading-note/#/ (해시 라우팅 단일 페이지 앱)
- 구성: React 19 + TypeScript + Vite, 마인드맵 부품 Mind Elixir 6, 서버 Supabase
- 배포: `main`에 push하면 GitHub Actions(`.github/workflows/deploy.yml`)가 GitHub Pages로 배포한다. 1~3분 걸린다.
- 기능과 폴더 구조 설명은 `README.md`에 있다.

## 원본은 GitHub 하나
- **원본은 GitHub `yukdal/reading-note`의 `main`이다.** 작업은 GitHub에서 받은(clone) 폴더에서만 한다.
- 구글 드라이브·OneDrive 안에서 git 작업을 하지 않는다(동기화와 충돌하고, `node_modules`가 계속 동기화된다).
- 구글 드라이브에 있는 `reading-note` 폴더는 **보관용 사본**이다. 거기서 직접 고치지 않는다. 같은 곳의 `reading-note.zip`은 2026-11-14의 옛 버전이다.
- 두 PC에서 동시에 고치지 않는다. 시작할 때 받고, 끝나면 올린다.

## 작업 시작할 때
```bash
git pull --ff-only
npm ci
```

## 확인 방법
```bash
npm test
npx tsc -b
npm run build
```
- 화면 확인은 **데모 모드**로 한다. `.env.local`이 없으면 `npx vite`로 띄웠을 때 자동으로 데모 모드가 된다(노란 띠). 데이터는 그 브라우저에만 저장된다.
- 휴대폰은 375px 폭에서 확인한다. 맵 화면 도구막대는 600px 이하에서 한 줄 가로 스크롤이다.
- `.env.local`(Supabase 설정)은 GitHub에 올리지 않는 파일이다. 열거나 출력하거나 커밋하지 않는다. 로그인 상태 시험이 꼭 필요할 때만 사용자에게 물어본다.

## 저장 순서
1. 위 확인 방법이 모두 통과해야 한다. 하나라도 실패하면 올리지 않는다.
2. 사용자의 허락을 받고 `main`에 커밋·push한다. 강제 push는 하지 않는다.
3. 사이트에 반영됐는지 확인한다(배포된 `index.html`이 가리키는 js·css 파일에 바뀐 내용이 들어 있는지 본다).
4. 구글 드라이브 사본을 맞춘다: git이 관리하는 파일만 덮어쓴다. `.git`, `node_modules`, `dist`는 복사하지 않고, 사본의 `.env.local`과 `node_modules`는 건드리지 않으며, 아무것도 지우지 않는다. 끝나면 파일 내용이 같은지 대조한다.

## 알아 두면 좋은 기술 메모
- **마인드맵 노드 데이터**: `{ id, parentId, text, color, collapsed, order }`가 필수이고, `note`(메모, 최대 2,000자)와 `textColor`(정해진 글씨색 9가지 중 하나)는 선택 칸이다. 값이 없으면 칸 자체를 넣지 않는다.
- **서버 검사**: `supabase/migrations/0001_init.sql`의 `validate_mindmap_nodes`는 필수 6개 키만 검사하고 다른 키는 막지 않는다. 그래서 선택 칸을 추가할 때 마이그레이션이 필요 없었다.
- **Mind Elixir 6**:
  - 항목은 `<me-tpc>` 태그가 아니라 `class="me-tpc"`인 `div`다. 📝 위를 눌러도 클릭 대상은 항목 `div`라서, 📝 클릭은 좌표가 `.icons` 영역 안인지로 판단한다(`MindmapEditor.tsx`의 `handleCanvasClick`).
  - `diffRefresh`는 설계상 선택을 지운다. 그래서 다시 그린 뒤 같은 항목을 다시 선택한다(`MindmapEditor.tsx`의 `redraw`). 삭제됐거나 접혀서 안 보이면 `findEle`가 오류를 내므로 선택 해제로 둔다.
  - 맵 변환은 `mindElixirAdapter.ts`. 메모·글씨색은 Mind Elixir 쪽에서 바뀌지 않으므로 직전 노드에서 id로 다시 붙인다.
- **.xmind 내보내기**(`src/features/mindmap/xmindFile.ts`): `.xmind`는 **무압축 ZIP**이고 안에 `content.json`(맵 데이터, 최상위가 시트 배열), `metadata.json`, `manifest.json`이 들어간다. 항목은 `{id, class:"topic", title, children:{attached:[...]}}`이고 메모는 `notes.plain.content`다. 이건 전부 XMind가 만든 실제 파일의 바이트에서 확인한 것이다(XMind 26.01, xmind-generator, 공식 샘플 3종).
  - **가지색·글씨색·접힘은 아직 넣지 않는다.** XMind 파일에서 이 세 가지가 어느 키에 저장되는지 확인하지 못했다. 확인하려면 XMind에서 항목 하나의 색을 **직접** 바꾸고 접은 뒤 저장한 파일이 필요하다(테마 기본색으로 칠해진 맵은 색이 항목이 아니라 `theme.map.properties.color-list`에서 나오므로 증거가 되지 않는다). 추측해서 넣으면 XMind가 조용히 무시하거나 파일을 거부할 수 있다.
- **글씨색 고르기**(`NodeExtras.tsx`의 `TextColorPicker`): PC와 아웃라인에서는 색 버튼이 펼쳐져 있고, 휴대폰 맵 도구막대에서만 "글씨색 ●" 버튼 하나로 접혀 누르면 위에 창이 뜬다.
- Windows PowerShell 5.1에서는 `git push`의 정상 안내가 빨간 오류처럼 보인다. 종료 코드로 판단한다.

## 작업 기록
### 2026-11-19
- `18d9529` 백업 화면에 **XMind 파일(.xmind) 내보내기** 추가. 책 한 권 = 시트 하나라서 책 전체가 `.xmind` 파일 하나에 들어간다. ZIP 쓰기는 `fflate`(3KB)를 썼고, 검사는 기존 `model.ts`의 `validateNodes`를 그대로 재사용했다.
- `abab7fe` 항목 메모(📝)도 함께 내보낸다.
- `9e3d6fe` XMind 본체가 쓴 파일과 대조해서 두 군데 수정: `topicPositioning: "fixed"` 제거(좌표가 없는 우리 항목들이 겹칠 위험), `metadata.json`에 `dataStructureVersion: "2"` 추가.
- **실기기 확인 완료**: 내보낸 파일을 XMind에서 열었더니 구조와 메모가 정상으로 나온다.

### 2026-11-17
- `fe988be` 점검에서 나온 문제 수정: 빈 칸 로그인 안내, 아웃라인 선택 줄 버튼 유지, 데모 모드 휴대폰 맵 높이, 대체 표지 글씨색, 오류 문구 화면 낭독, favicon과 밝은 화면 고정, README 정리
- `b4ce4da` 마인드맵·아웃라인에 항목별 메모(📝)와 글씨색 추가
- `2e3e0ec` 맵의 📝를 눌러도 메모가 열리지 않던 문제 수정
- `157ce46` 색 변경·접기 뒤에도 항목 선택이 유지되게 수정
- `62d1076` 휴대폰 맵 도구막대 정리(1,378px → 848px)
- 휴대폰 맵 도구막대 더 줄임(848px → 638px): 버튼 이름 짧게(+자식·+형제·수정·맞춤, 화면 낭독은 원래 이름), 확대·축소·맞춤을 "보기 ▾" 창으로 묶음. "보기"와 "글씨색" 창은 한 번에 하나만 열린다(`MindmapEditor.tsx`의 `openPopover`). PC는 그대로.

## 아직 확인하지 못한 것 / 다음 후보
- 아이폰·Mac Safari 실기기: 아웃라인 버튼, 맵의 📝, 휴대폰 "글씨색 ●" 창
- 로그인한 실제 계정에서 메모·글씨색이 서버에 저장되고 새로고침 뒤 남는지
- 휴대폰 도구막대는 아직 화면 폭의 약 1.7배(638px)다. 더 줄이려면 다른 버튼(삭제·접기 등)도 묶어야 한다(사용자 결정 필요). "보기 ▾" 창은 실기기에서 아직 확인하지 못했다.
- 중심 항목(책 제목)은 배경이 책 색이라, 어두운 책에 어두운 글씨색을 고르면 잘 안 보일 수 있다.
- 책이 여러 권일 때 `.xmind` 시트 탭이 XMind에서 전부 보이는지 아직 확인하지 못했다(한 권짜리만 열어봤다).
- `.xmind` **읽어오기**(가져오기)는 아직 없다. 지금은 내보내기만 된다.
