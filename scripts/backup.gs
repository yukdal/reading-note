/**
 * 독서노트 주간 백업 (Supabase -> Google Drive)
 *
 * 설정 순서
 *  1) Apps Script 편집기 > 프로젝트 설정(톱니바퀴) > 스크립트 속성에 3개 추가
 *       SUPABASE_URL      : https://<프로젝트ref>.supabase.co
 *       SUPABASE_SECRET_KEY : secret key (sb_secret_... / 공개 금지)
 *       BACKUP_FOLDER_ID  : 백업을 넣을 Drive 폴더 URL 의 .../folders/<이 부분>
 *  2) 함수 backupSupabaseToDrive 를 한 번 수동 실행 -> 권한 승인 -> Drive 에 파일 생성 확인
 *  3) 트리거 추가: backupSupabaseToDrive / 시간 기반 / 주 단위,
 *     그리고 "오류 알림 설정"을 '즉시 알림' 으로. (실패하면 throw 해서 메일이 오게 해 둠)
 *
 * 오래된 백업을 지우는 기능은 일부러 넣지 않았습니다 (실수로 지우는 쪽이 더 위험).
 */

function backupSupabaseToDrive() {
  var props = PropertiesService.getScriptProperties();
  var baseUrl = requireProp_(props, 'SUPABASE_URL').replace(/\/+$/, '');
  var secretKey = requireProp_(props, 'SUPABASE_SECRET_KEY');
  var folderId = requireProp_(props, 'BACKUP_FOLDER_ID');

  // 키는 apikey 헤더로만 보냅니다 (Authorization: Bearer 에 넣지 않음).
  var res = UrlFetchApp.fetch(baseUrl + '/rest/v1/rpc/export_backup', {
    method: 'post',
    contentType: 'application/json',
    payload: '{}',
    headers: { apikey: secretKey },
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code !== 200) {
    // 키는 로그/예외에 남기지 않습니다.
    throw new Error('export_backup 실패: HTTP ' + code + ' / ' + body.slice(0, 300));
  }

  var data;
  try {
    data = JSON.parse(body);
  } catch (e) {
    throw new Error('응답이 JSON 이 아닙니다: ' + body.slice(0, 300));
  }
  if (!data || !Array.isArray(data.books) || !Array.isArray(data.mindmaps)) {
    throw new Error('응답 형식 오류: books / mindmaps 배열이 없습니다');
  }

  // 책 id 와 맵 book_id 가 1:1 로 맞는지 (하나라도 어긋나면 파일을 만들지 않음)
  var bookIds = data.books.map(function (b) { return String(b && b.id); }).sort();
  var mapIds = data.mindmaps.map(function (m) { return String(m && m.book_id); }).sort();
  if (bookIds.length !== mapIds.length) {
    throw new Error('책 ' + bookIds.length + '권 / 맵 ' + mapIds.length + '개 - 개수가 다릅니다');
  }
  for (var i = 0; i < bookIds.length; i++) {
    if (bookIds[i] !== mapIds[i]) {
      throw new Error('책과 맵이 1:1 로 대응하지 않습니다 (' + bookIds[i] + ')');
    }
  }

  // 같은 날 다시 실행해도 기존 파일은 그대로 두고 같은 이름으로 하나 더 만듭니다.
  var name = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd') + '-reading-note-backup.json';
  var file = DriveApp.getFolderById(folderId).createFile(name, body, 'application/json');

  // 만든 파일을 다시 읽어 확인
  var saved = DriveApp.getFileById(file.getId()).getBlob().getDataAsString();
  if (saved.length !== body.length) {
    throw new Error('저장 확인 실패: 길이가 다릅니다 (' + saved.length + ' / ' + body.length + ')');
  }
  JSON.parse(saved);

  console.log(name + ' 저장 완료 - 책 ' + bookIds.length + '권, ' + saved.length + '자');
}

function requireProp_(props, name) {
  var value = (props.getProperty(name) || '').trim();
  if (!value) {
    throw new Error('스크립트 속성 ' + name + ' 이(가) 비어 있습니다. 프로젝트 설정에서 입력하세요.');
  }
  return value;
}
