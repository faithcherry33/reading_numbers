// Firebase 콘솔 > 프로젝트 설정 > 내 앱 > SDK 설정 및 구성에서 복사해 넣으세요.
// 아래 값이 그대로 남아 있으면 앱은 '데모 모드'로 실행되며 혼자하기만 사용할 수 있습니다.

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

export const isFirebaseConfigured = Object.values(firebaseConfig).every(
  (value) => value && !String(value).includes("YOUR_")
);
