# 한글 수 읽기 대결

초등학생이 숫자를 보고 정확한 한글 수 읽기를 입력하는 실시간 웹게임입니다.

## 포함된 기능

- 닉네임을 탭이 열려 있는 동안 유지
- 단계별 수 범위
  - 1단계: 1~4자리
  - 2단계: 5~8자리
  - 3단계: 9~12자리
  - 4단계: 13~16자리
  - 자유 채널: 1~16자리
- 혼자하기: 라운드 없이 계속 연습
- 대결하기: 혼자하기 중이 아닌 접속자가 자동 참가
- 한 라운드 20문제
- Easy: 오답 감점 없음
- Hard: 오답 시 1점 감점, 0점에서 다시 오답이면 퇴장
- 첫 정답자에게 1점
- 라운드 종료 후 참가자 전원 방에서 퇴장
- 정답은 한글만 허용
- 만·억·조 단위 사이의 띄어쓰기를 정확히 검사
- Firebase가 설정되지 않으면 혼자하기 데모 모드로 실행

## 깃허브에 올릴 파일

이 폴더 안의 파일을 모두 같은 저장소의 최상위 경로에 올리면 됩니다.

```text
number-reading-battle/
├─ index.html
├─ style.css
├─ app.js
├─ firebase-config.js
├─ firestore.rules
├─ firebase.json
└─ README.md
```

## Firebase 연결 순서

### 1. 기존 Firebase 프로젝트에 웹 앱 추가

Firebase 콘솔에서 기존 프로젝트를 연 뒤:

1. 프로젝트 설정
2. 내 앱
3. 웹 앱 추가
4. 표시되는 `firebaseConfig` 값을 복사

새 Firebase 프로젝트를 만들 필요는 없습니다. 기존 프로젝트 안에서 이 게임 전용 컬렉션 이름을 사용합니다.

- `numberReadingRooms`
- `numberReadingMatches`

### 2. `firebase-config.js` 수정

파일 안의 `YOUR_...` 값을 Firebase 콘솔에서 복사한 값으로 바꿉니다.

```js
export const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

### 3. 익명 로그인 켜기

Firebase 콘솔에서:

1. Authentication
2. Sign-in method
3. 익명(Anonymous)
4. 사용 설정

### 4. Firestore 만들기

Firebase 콘솔에서 Cloud Firestore 데이터베이스를 생성합니다.

기존 프로젝트에서 이미 Firestore를 사용 중이라면 새로 만들 필요가 없습니다.

### 5. 보안 규칙 적용

`firestore.rules`의 내용을 Firebase 콘솔의 Firestore > 규칙에 붙여넣고 게시합니다.

기존 프로젝트 규칙이 이미 있다면 전체를 덮어쓰지 말고, 아래 두 `match` 블록만 기존
`match /databases/{database}/documents` 블록 안에 추가하세요.

- `/numberReadingRooms/{roomId}/presence/{userId}`
- `/numberReadingMatches/{roomId}`

## 배포

### GitHub Pages

이 앱은 Firebase SDK를 CDN에서 불러오는 정적 웹앱입니다. 빌드 명령이 필요하지 않습니다.

1. 저장소에 파일 업로드
2. 저장소 Settings
3. Pages
4. Deploy from a branch
5. `main` / `(root)` 선택

### Netlify 또는 Vercel

저장소를 연결한 뒤 빌드 명령은 비워 두고, 배포 폴더는 저장소 루트로 설정합니다.

## 수 읽기 방식

- 네 자리 안에서는 띄어쓰지 않습니다.
- 만·억·조 단위가 바뀌면 한 칸 띄어씁니다.
- `일십`, `일백`, `일천`이 아니라 `십`, `백`, `천`으로 읽습니다.
- 큰 단위 앞의 1은 표시합니다.
  - 10,000 → `일만`
  - 100,000,000 → `일억`
  - 1,000,000,000,000 → `일조`

이 규칙을 바꾸려면 `app.js`의 `numberStringToKorean()` 함수를 수정하세요.

## 주의

현재 대결 점수는 Firestore 클라이언트 트랜잭션으로 처리합니다. 같은 정답이 거의 동시에
도착하면 Firestore가 먼저 처리한 제출을 승자로 확정합니다.

교실 연습용으로는 사용할 수 있지만, 개발자 도구를 이용한 점수 조작까지 막는 구조는
아닙니다. 공식 대회나 상금이 걸린 서비스라면 정답 판정과 점수 처리를 Cloud Functions
같은 서버 코드로 옮겨야 합니다.
