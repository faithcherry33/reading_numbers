한글 수 읽기 대결 — 유령 대결/퇴장/화면 배열 수정본

[교체 또는 추가할 파일]
1. app.js               기존 파일 전체 교체
2. index.html            기존 파일 전체 교체
3. battle-final.css      기존 파일 전체 교체
4. firestore.rules       저장소와 Firebase 콘솔 규칙 확인
5. reset-ghosts.html     일회성 유령 데이터 초기화 도구

[이번 수정의 핵심]
- 방 나가기 화살표와 대결 퇴장 버튼은 Firestore에 퇴장 기록이 성공한 뒤에만 화면을 나갑니다.
- 퇴장 기록이 실패하면 유령 참가자를 만들지 않도록 현재 방에 남고 오류 안내를 표시합니다.
- 모집 중 제안자가 나가면 제안 삭제, 참여자가 나가면 참여 취소 처리합니다.
- 진행 중 참가자가 직접 나가면 즉시 eliminated=true와 left-intentionally 사유를 저장합니다.
- 마지막 활동 참가자가 나가면 대결을 finished 상태로 종료합니다.
- 3분 동안 답 제출이 없거나 3분 동안 접속이 돌아오지 않은 참가자는 자동 퇴장합니다.
- 오래된 완료 대결은 10분 뒤 자동 삭제됩니다.
- 단계 카드는 PC에서 3개+2개 중앙 정렬, 태블릿 2열, 모바일 1열로 표시됩니다.
- 방 안의 혼자하기/대결하기 카드는 PC에서 가로 2열로 정렬됩니다.

[현재 유령 데이터 1회 초기화]
1. 학생들이 연 앱과 탭을 모두 닫습니다.
2. 위 파일들을 branch1에 커밋하고 GitHub Pages 배포를 기다립니다.
3. 배포 주소 끝에 /reset-ghosts.html을 붙여 엽니다.
   예: https://faithcherry33.github.io/reading_numbers/reset-ghosts.html
4. '모든 방의 대결 데이터 초기화' 버튼을 한 번 누릅니다.
5. 완료 문구를 확인한 뒤 앱을 새로고침합니다.
6. reset-ghosts.html은 저장소에서 삭제하고 다시 커밋합니다.

[Firestore 규칙]
firestore.rules를 저장소에 넣는 것만으로 Firebase에 자동 반영되지 않는 배포 구조라면,
Firebase 콘솔 > Firestore Database > 규칙에도 같은 내용을 붙여넣고 게시해야 합니다.

[권장 커밋 메시지]
Fix battle exit, ghost cleanup, and room layout
