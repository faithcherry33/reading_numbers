import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";

const CHANNELS = [
  { id: "stage1", label: "1단계", range: "1~4자리 수", minDigits: 1, maxDigits: 4, unit: "천 자리까지" },
  { id: "stage2", label: "2단계", range: "5~8자리 수", minDigits: 5, maxDigits: 8, unit: "만~천만 자리" },
  { id: "stage3", label: "3단계", range: "9~12자리 수", minDigits: 9, maxDigits: 12, unit: "억~천억 자리" },
  { id: "stage4", label: "4단계", range: "13~16자리 수", minDigits: 13, maxDigits: 16, unit: "조~천조 자리" },
  { id: "free", label: "자유 채널", range: "1~16자리 수", minDigits: 1, maxDigits: 16, unit: "모든 범위" }
];

const FIREBASE_COLLECTIONS = {
  rooms: "numberReadingRooms",
  matches: "numberReadingMatches"
};

const MATCH_INACTIVITY_LIMIT_MS = 3 * 60 * 1000;
const MATCH_CLEANUP_INTERVAL_MS = 15 * 1000;

const state = {
  nickname: "",
  firebaseReady: false,
  auth: null,
  db: null,
  uid: null,
  channel: null,
  mode: "idle",
  presenceUnsubscribe: null,
  matchUnsubscribe: null,
  heartbeatId: null,
  matchCleanupId: null,
  onlineUsers: [],
  match: null,
  soloQuestion: null,
  soloCorrect: 0,
  soloAttempts: 0,
  advanceTimers: new Set(),
  handledRoundIds: new Set(JSON.parse(sessionStorage.getItem("handledRoundIds") || "[]")),
  handledEliminations: new Set(JSON.parse(sessionStorage.getItem("handledEliminations") || "[]"))
};

const $ = (selector) => document.querySelector(selector);

const elements = {
  nicknameScreen: $("#nickname-screen"),
  channelScreen: $("#channel-screen"),
  roomScreen: $("#room-screen"),
  nicknameForm: $("#nickname-form"),
  nicknameInput: $("#nickname-input"),
  homeNickname: $("#home-nickname"),
  roomNickname: $("#room-nickname"),
  changeNicknameButton: $("#change-nickname-button"),
  connectionBadge: $("#connection-badge"),
  channelGrid: $("#channel-grid"),
  roomTitle: $("#room-title"),
  roomRange: $("#room-range"),
  leaveRoomButton: $("#leave-room-button"),
  roomStatusBanner: $("#room-status-banner"),
  modeSelectPanel: $("#mode-select-panel"),
  soloPanel: $("#solo-panel"),
  battlePanel: $("#battle-panel"),
  soloButton: $("#solo-button"),
  battleButton: $("#battle-button"),
  soloNumber: $("#solo-number"),
  soloAnswerForm: $("#solo-answer-form"),
  soloAnswerInput: $("#solo-answer-input"),
  soloFeedback: $("#solo-feedback"),
  soloCorrectCount: $("#solo-correct-count"),
  soloAttemptCount: $("#solo-attempt-count"),
  stopSoloButton: $("#stop-solo-button"),
  onlineCount: $("#online-count"),
  onlineUserList: $("#online-user-list"),
  scorePanel: $("#score-panel"),
  scoreList: $("#score-list"),
  difficultyPill: $("#difficulty-pill"),
  battleModeLabel: $("#battle-mode-label"),
  battleProgress: $("#battle-progress"),
  battleNumber: $("#battle-number"),
  battleAnswerForm: $("#battle-answer-form"),
  battleAnswerInput: $("#battle-answer-input"),
  battleSubmitButton: $("#battle-submit-button"),
  battleFeedback: $("#battle-feedback"),
  winnerMessage: $("#winner-message"),
  countdownBox: $("#countdown-box"),
  modalBackdrop: $("#modal-backdrop"),
  modalContent: $("#modal-content"),
  modalCloseButton: $("#modal-close-button")
};

function showScreen(screenName) {
  elements.nicknameScreen.classList.toggle("hidden", screenName !== "nickname");
  elements.channelScreen.classList.toggle("hidden", screenName !== "channels");
  elements.roomScreen.classList.toggle("hidden", screenName !== "room");
}

function setFeedback(element, message = "", type = "") {
  element.textContent = message;
  element.className = `feedback${type ? ` ${type}` : ""}`;
}

function openModal(html, { closable = true } = {}) {
  elements.modalContent.innerHTML = html;
  elements.modalBackdrop.classList.remove("hidden");
  elements.modalCloseButton.classList.toggle("hidden", !closable);
}

function closeModal() {
  elements.modalBackdrop.classList.add("hidden");
  elements.modalContent.innerHTML = "";
}

function sanitizeNickname(value) {
  return value.replace(/[<>&"'`]/g, "").trim().slice(0, 12);
}

function loadNickname() {
  const saved = sessionStorage.getItem("numberReadingNickname");
  if (!saved) return;
  state.nickname = saved;
  elements.homeNickname.textContent = saved;
  elements.roomNickname.textContent = saved;
  showScreen("channels");
}

function saveNickname(nickname) {
  state.nickname = nickname;
  sessionStorage.setItem("numberReadingNickname", nickname);
  elements.homeNickname.textContent = nickname;
  elements.roomNickname.textContent = nickname;
}

function renderChannels() {
  elements.channelGrid.innerHTML = CHANNELS.map((channel, index) => `
    <button class="channel-card" data-channel-id="${channel.id}" type="button">
      <span class="channel-number">${index < 4 ? index + 1 : "★"}</span>
      <h3>${channel.label}</h3>
      <p>${channel.range}<br>${channel.unit}</p>
    </button>
  `).join("");

  elements.channelGrid.querySelectorAll("[data-channel-id]").forEach((button) => {
    button.addEventListener("click", () => enterRoom(button.dataset.channelId));
  });
}

async function initializeFirebase() {
  if (!isFirebaseConfigured) {
    state.firebaseReady = false;
    elements.connectionBadge.textContent = "데모 모드 · 혼자하기만 가능";
    elements.connectionBadge.className = "connection-badge demo";
    return;
  }

  try {
    const app = initializeApp(firebaseConfig);
    state.auth = getAuth(app);
    state.db = getFirestore(app);
    const credential = await signInAnonymously(state.auth);
    state.uid = credential.user.uid;
    state.firebaseReady = true;
    elements.connectionBadge.textContent = "실시간 대결 연결됨";
    elements.connectionBadge.className = "connection-badge online";
  } catch (error) {
    console.error(error);
    state.firebaseReady = false;
    elements.connectionBadge.textContent = "Firebase 연결 실패 · 혼자하기만 가능";
    elements.connectionBadge.className = "connection-badge demo";
  }
}

function getChannel(channelId = state.channel?.id) {
  return CHANNELS.find((channel) => channel.id === channelId);
}

function generateNumberString(channel) {
  const digitCount =
    channel.minDigits +
    Math.floor(Math.random() * (channel.maxDigits - channel.minDigits + 1));

  let number = String(1 + Math.floor(Math.random() * 9));
  for (let i = 1; i < digitCount; i += 1) {
    number += String(Math.floor(Math.random() * 10));
  }
  return number;
}

function readFourDigitGroup(groupString) {
  const padded = groupString.padStart(4, "0");
  const digitNames = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
  const placeNames = ["천", "백", "십", ""];
  let result = "";

  [...padded].forEach((character, index) => {
    const digit = Number(character);
    if (digit === 0) return;

    const place = placeNames[index];
    if (digit === 1 && place) {
      result += place;
    } else {
      result += digitNames[digit] + place;
    }
  });

  return result;
}

function numberStringToKorean(numberString) {
  const normalized = numberString.replace(/^0+(?=\d)/, "");
  if (normalized === "0") return "영";

  const largeUnits = ["", "만", "억", "조"];
  const groups = [];
  for (let end = normalized.length; end > 0; end -= 4) {
    groups.unshift(normalized.slice(Math.max(0, end - 4), end));
  }

  return groups
    .map((group, index) => {
      const value = Number(group);
      if (value === 0) return "";
      const unitIndex = groups.length - 1 - index;
      return `${readFourDigitGroup(group)}${largeUnits[unitIndex]}`;
    })
    .filter(Boolean)
    .join(" ");
}

function formatNumber(numberString) {
  return numberString;
}

function createQuestion(channel) {
  const number = generateNumberString(channel);
  return {
    number,
    display: formatNumber(number),
    answer: numberStringToKorean(number)
  };
}

function isHangulOnlyAnswer(raw) {
  const trimmed = raw.trim();
  return Boolean(trimmed) && /^[가-힣 ]+$/.test(trimmed);
}

function isExactAnswer(raw, expected) {
  return raw.trim() === expected;
}

async function enterRoom(channelId) {
  const channel = getChannel(channelId);
  if (!channel) return;

  state.channel = channel;
  state.mode = "idle";
  state.match = null;

  elements.roomTitle.textContent = `${channel.label} 방`;
  elements.roomRange.textContent = `${channel.range} · ${channel.unit}`;
  elements.roomNickname.textContent = state.nickname;
  showScreen("room");
  renderRoom();

  if (!state.firebaseReady) {
    state.onlineUsers = [{ uid: "local", nickname: state.nickname, mode: "idle" }];
    renderOnlineUsers();
    return;
  }

  await createOrUpdatePresence("idle");

/*
 * 구독하기 전에 전날 멈춘 대결을 먼저 정리합니다.
 */
await cleanupStaleMatch(channel.id);

subscribeToPresence();
subscribeToMatch();
startHeartbeat();
startMatchCleanup();

cleanupStalePresence();
}

async function leaveRoom({ forced = false } = {}) {
  const oldChannel = state.channel;
  stopRoomListeners();

  if (state.firebaseReady && oldChannel && state.uid) {
    try {
      await deleteDoc(
        doc(state.db, FIREBASE_COLLECTIONS.rooms, oldChannel.id, "presence", state.uid)
      );
    } catch (error) {
      console.warn("접속자 정보 삭제 실패", error);
    }
  }

  state.channel = null;
  state.mode = "idle";
  state.match = null;
  state.onlineUsers = [];
  elements.battleAnswerInput.value = "";
  elements.soloAnswerInput.value = "";

  showScreen("channels");

  if (!forced) closeModal();
}

function stopRoomListeners() {
  state.presenceUnsubscribe?.();
  state.matchUnsubscribe?.();
  state.presenceUnsubscribe = null;
  state.matchUnsubscribe = null;

  if (state.heartbeatId) {
    clearInterval(state.heartbeatId);
    state.heartbeatId = null;
  }
  if (state.matchCleanupId) {
    clearInterval(state.matchCleanupId);
    state.matchCleanupId = null;
  }
}

async function createOrUpdatePresence(mode = state.mode) {
  if (!state.firebaseReady || !state.channel) return;

  await setDoc(
    doc(state.db, FIREBASE_COLLECTIONS.rooms, state.channel.id, "presence", state.uid),
    {
      uid: state.uid,
      nickname: state.nickname,
      mode,
      joinedAt: serverTimestamp(),
      lastSeen: serverTimestamp(),
      lastSeenMs: Date.now()
    },
    { merge: true }
  );
}

async function setPresenceMode(mode) {
  state.mode = mode;

  if (!state.firebaseReady || !state.channel) {
    state.onlineUsers = [{ uid: "local", nickname: state.nickname, mode }];
    renderOnlineUsers();
    renderRoom();
    return;
  }

  try {
    await updateDoc(
      doc(state.db, FIREBASE_COLLECTIONS.rooms, state.channel.id, "presence", state.uid),
      {
        mode,
        nickname: state.nickname,
        lastSeen: serverTimestamp(),
        lastSeenMs: Date.now()
      }
    );
  } catch (error) {
    console.warn(error);
    await createOrUpdatePresence(mode);
  }

  renderRoom();
}

function startHeartbeat() {
  if (!state.firebaseReady || state.heartbeatId) return;

  state.heartbeatId = window.setInterval(() => {
    createOrUpdatePresence(state.mode).catch(console.warn);
  }, 20000);
}

async function cleanupStalePresence() {
  async function cleanupStaleMatch(channelId = state.channel?.id) {
  if (!state.firebaseReady || !channelId) return;

  const matchRef = doc(
    state.db,
    FIREBASE_COLLECTIONS.matches,
    channelId
  );

  const now = Date.now();

  try {
    await runTransaction(state.db, async (transaction) => {
      const snapshot = await transaction.get(matchRef);

      if (!snapshot.exists()) return;

      const match = snapshot.data();

      /*
       * 아직 초대 기능을 적용하기 전이므로 waiting은 현재 없지만,
       * 다음 단계에서 사용할 수 있도록 미리 처리합니다.
       */
      if (match.status === "waiting") {
        const proposalTime =
          match.proposalUpdatedAtMs ||
          match.createdAtMs ||
          0;

        if (
          proposalTime &&
          now - proposalTime >= MATCH_INACTIVITY_LIMIT_MS
        ) {
          transaction.delete(matchRef);
        }

        return;
      }

      if (match.status !== "playing") return;

      const participantIds = match.participantIds || [];
      const eliminated = match.eliminated || {};
      const lastActivityAtMs = match.lastActivityAtMs || {};

      /*
       * 수정 전에 만들어진 옛 대결에는 lastActivityAtMs가 없습니다.
       * 이런 대결이 3분 이상 멈춰 있으면 문서를 삭제하여
       * 전날 대결 때문에 방이 영구 잠기는 문제를 해제합니다.
       */
      const isLegacyMatch =
        participantIds.length > 0 &&
        Object.keys(lastActivityAtMs).length === 0;

      if (isLegacyMatch) {
        const legacyLastTime =
          match.questionStartedAtMs ||
          match.startsAtMs ||
          match.createdAtMs ||
          0;

        if (
          legacyLastTime &&
          now - legacyLastTime >= MATCH_INACTIVITY_LIMIT_MS
        ) {
          transaction.delete(matchRef);
        }

        return;
      }

      const inactiveIds = participantIds.filter((uid) => {
        if (eliminated[uid]) return false;

        const lastActivity =
          lastActivityAtMs[uid] ||
          match.startedAtMs ||
          match.startsAtMs ||
          match.createdAtMs ||
          now;

        return (
          now - lastActivity >= MATCH_INACTIVITY_LIMIT_MS
        );
      });

      if (!inactiveIds.length) return;

      const nextEliminated = {
        ...eliminated
      };

      const updates = {};

      inactiveIds.forEach((uid) => {
        nextEliminated[uid] = true;

        updates[`eliminated.${uid}`] = true;
        updates[`eliminatedAtMs.${uid}`] = now;
        updates[`exitReasons.${uid}`] = "inactive-3-minutes";
      });

      const remainingActiveCount = participantIds.filter(
        (uid) => !nextEliminated[uid]
      ).length;

      if (remainingActiveCount === 0) {
        updates.status = "finished";
        updates.finishedAt = serverTimestamp();
        updates.finishedAtMs = now;
        updates.finishedReason = "all-players-inactive";
      }

      transaction.update(matchRef, updates);
    });
  } catch (error) {
    console.warn("오래된 대결 정리 실패", error);
  }
}

function startMatchCleanup() {
  if (
    !state.firebaseReady ||
    !state.channel ||
    state.matchCleanupId
  ) {
    return;
  }

  cleanupStaleMatch().catch(console.warn);

  state.matchCleanupId = window.setInterval(() => {
    cleanupStaleMatch().catch(console.warn);
  }, MATCH_CLEANUP_INTERVAL_MS);
}

  try {
    const snapshot = await getDocs(
      collection(state.db, FIREBASE_COLLECTIONS.rooms, state.channel.id, "presence")
    );
    const cutoff = Date.now() - 120000;

    const deletions = snapshot.docs
      .filter((item) => (item.data().lastSeenMs || 0) < cutoff)
      .map((item) => deleteDoc(item.ref));

    await Promise.allSettled(deletions);
  } catch (error) {
    console.warn("오래된 접속자 정리 실패", error);
  }
}

function subscribeToPresence() {
  if (!state.firebaseReady || !state.channel) return;

  state.presenceUnsubscribe?.();
  const channelId = state.channel.id;

  state.presenceUnsubscribe = onSnapshot(
    collection(state.db, FIREBASE_COLLECTIONS.rooms, channelId, "presence"),
    (snapshot) => {
      if (state.channel?.id !== channelId) return;
      const cutoff = Date.now() - 65000;

      state.onlineUsers = snapshot.docs
        .map((item) => item.data())
        .filter((user) => (user.lastSeenMs || Date.now()) >= cutoff)
        .sort((a, b) => a.nickname.localeCompare(b.nickname, "ko"));

      renderOnlineUsers();
    },
    (error) => {
      console.error(error);
      elements.roomStatusBanner.textContent = "접속자 목록을 불러오지 못했습니다.";
      elements.roomStatusBanner.className = "status-banner alert";
    }
  );
}

function subscribeToMatch() {
  if (!state.firebaseReady || !state.channel) return;

  state.matchUnsubscribe?.();
  const channelId = state.channel.id;
  const matchRef = doc(state.db, FIREBASE_COLLECTIONS.matches, channelId);

  state.matchUnsubscribe = onSnapshot(
    matchRef,
    async (snapshot) => {
      if (state.channel?.id !== channelId) return;

      if (!snapshot.exists()) {
        state.match = null;
        renderRoom();
        return;
      }

      const match = snapshot.data();
      state.match = match;

      const isParticipant = match.participantIds?.includes(state.uid);
      const isEliminated = Boolean(match.eliminated?.[state.uid]);

      if (
        match.status === "playing" &&
        isParticipant &&
        !isEliminated &&
        !state.handledRoundIds.has(match.roundId)
      ) {
        if (state.mode !== "battle") {
          await setPresenceMode("battle");
        }
        state.mode = "battle";
      }

      if (
        match.status === "playing" &&
        isParticipant &&
        isEliminated &&
        !state.handledEliminations.has(match.roundId)
      ) {
        handleElimination(match);
        return;
      }

      if (
        match.status === "finished" &&
        isParticipant &&
        !state.handledRoundIds.has(match.roundId)
      ) {
        handleFinishedRound(match);
        return;
      }

      renderRoom();
    },
    (error) => {
      console.error(error);
      elements.roomStatusBanner.textContent = "대결 정보를 불러오지 못했습니다.";
      elements.roomStatusBanner.className = "status-banner alert";
    }
  );
}

function renderRoom() {
  if (!state.channel) return;

  const activeMatch = state.match?.status === "playing";
  const isParticipant = state.match?.participantIds?.includes(state.uid);
  const eliminated = Boolean(state.match?.eliminated?.[state.uid]);

  elements.modeSelectPanel.classList.toggle("hidden", state.mode !== "idle");
  elements.soloPanel.classList.toggle("hidden", state.mode !== "solo");
  elements.battlePanel.classList.toggle(
    "hidden",
    !(state.mode === "battle" && activeMatch && isParticipant && !eliminated)
  );

  const battleUnavailable = !state.firebaseReady || activeMatch;
  elements.battleButton.disabled = battleUnavailable;

  if (!state.firebaseReady) {
    elements.roomStatusBanner.textContent =
      "Firebase가 연결되지 않아 현재는 혼자하기만 이용할 수 있습니다.";
    elements.roomStatusBanner.className = "status-banner alert";
  } else if (activeMatch && !isParticipant) {
    elements.roomStatusBanner.textContent =
      "현재 이 방에서 대결이 진행 중입니다. 대결이 끝날 때까지 혼자하기만 가능합니다.";
    elements.roomStatusBanner.className = "status-banner alert";
  } else if (state.mode === "solo") {
    elements.roomStatusBanner.textContent =
      "혼자 연습 중입니다. 그만두기 버튼을 누르면 대결에 참여할 수 있습니다.";
    elements.roomStatusBanner.className = "status-banner";
  } else if (state.mode === "battle") {
    elements.roomStatusBanner.textContent =
      "대결 중입니다. 가장 먼저 정확한 정답을 제출하면 1점을 얻습니다.";
    elements.roomStatusBanner.className = "status-banner";
  } else {
    elements.roomStatusBanner.textContent =
      "혼자하기 중이 아닌 접속자는 누군가 대결을 시작하면 자동으로 참가합니다.";
    elements.roomStatusBanner.className = "status-banner";
  }

  elements.scorePanel.classList.toggle("hidden", !activeMatch);

  if (state.mode === "battle" && activeMatch) {
    renderBattle();
  }

  if (activeMatch) {
    renderScores();
  }
}

function renderOnlineUsers() {
  elements.onlineCount.textContent = `${state.onlineUsers.length}명`;

  if (!state.onlineUsers.length) {
    elements.onlineUserList.innerHTML = "<li>접속자가 없습니다.</li>";
    return;
  }

  const modeLabels = {
    idle: "대기 중",
    solo: "혼자하기",
    battle: "대결 중"
  };

  elements.onlineUserList.innerHTML = state.onlineUsers.map((user) => `
    <li>
      <strong>${escapeHtml(user.nickname || "익명")}</strong>
      <span class="mode-tag">${modeLabels[user.mode] || "대기 중"}</span>
    </li>
  `).join("");
}

function startSolo() {
  state.soloCorrect = 0;
  state.soloAttempts = 0;
  elements.soloCorrectCount.textContent = "0";
  elements.soloAttemptCount.textContent = "0";
  setPresenceMode("solo");
  nextSoloQuestion();
}

function nextSoloQuestion() {
  state.soloQuestion = createQuestion(state.channel);
  elements.soloNumber.textContent = state.soloQuestion.display;
  elements.soloAnswerInput.value = "";
  elements.soloAnswerInput.disabled = false;
  setFeedback(elements.soloFeedback);
  setTimeout(() => elements.soloAnswerInput.focus(), 50);
}

function submitSoloAnswer(event) {
  event.preventDefault();
  if (!state.soloQuestion) return;

  const answer = elements.soloAnswerInput.value;
  state.soloAttempts += 1;
  elements.soloAttemptCount.textContent = String(state.soloAttempts);

  if (!isHangulOnlyAnswer(answer)) {
    setFeedback(elements.soloFeedback, "숫자나 기호 없이 한글과 띄어쓰기만 입력하세요.", "error");
    return;
  }

  if (!isExactAnswer(answer, state.soloQuestion.answer)) {
    setFeedback(
      elements.soloFeedback,
      "아직 정답이 아닙니다. 큰 단위의 띄어쓰기도 확인해 보세요.",
      "error"
    );
    return;
  }

  state.soloCorrect += 1;
  elements.soloCorrectCount.textContent = String(state.soloCorrect);
  elements.soloAnswerInput.disabled = true;
  setFeedback(elements.soloFeedback, "정답입니다! 다음 문제로 넘어갑니다.", "success");
  setTimeout(nextSoloQuestion, 650);
}

async function stopSolo() {
  state.soloQuestion = null;
  await setPresenceMode("idle");
  state.mode = "idle";
  renderRoom();
}

function showDifficultyModal() {
  if (!state.firebaseReady || state.match?.status === "playing") return;

  openModal(`
    <p class="eyebrow">20문제 대결</p>
    <h2>난이도를 선택하세요.</h2>
    <p class="subtext">혼자하기 중이 아닌 현재 접속자가 모두 자동으로 참가합니다.</p>
    <div class="difficulty-grid">
      <button class="difficulty-option" data-difficulty="easy" type="button">
        <strong>Easy</strong>
        <p>오답을 입력해도 점수가 깎이지 않습니다.</p>
      </button>
      <button class="difficulty-option" data-difficulty="hard" type="button">
        <strong>Hard</strong>
        <p>오답 시 1점 감점. 0점에서 다시 틀리면 즉시 퇴장합니다.</p>
      </button>
    </div>
  `);

  elements.modalContent.querySelectorAll("[data-difficulty]").forEach((button) => {
    button.addEventListener("click", async () => {
      const difficulty = button.dataset.difficulty;
      button.disabled = true;
      await startBattle(difficulty);
    });
  });
}

async function startBattle(difficulty) {
  if (!state.firebaseReady || !state.channel) return;

  try {
    await createOrUpdatePresence("idle");

    const presenceSnapshot = await getDocs(
      collection(state.db, FIREBASE_COLLECTIONS.rooms, state.channel.id, "presence")
    );
    const cutoff = Date.now() - 65000;

    const participants = presenceSnapshot.docs
      .map((item) => item.data())
      .filter((user) => (user.lastSeenMs || 0) >= cutoff && user.mode !== "solo")
      .map((user) => ({ uid: user.uid, nickname: user.nickname }));

    if (!participants.some((participant) => participant.uid === state.uid)) {
      participants.push({ uid: state.uid, nickname: state.nickname });
    }

    const participantIds = [...new Set(participants.map((participant) => participant.uid))];
    const uniqueParticipants = participantIds.map((uid) =>
      participants.find((participant) => participant.uid === uid)
    );

    const questions = Array.from({ length: 20 }, () => createQuestion(state.channel));
    const scores = Object.fromEntries(
  participantIds.map((uid) => [uid, 0])
);

const eliminated = Object.fromEntries(
  participantIds.map((uid) => [uid, false])
);

const battleStartTime = Date.now();

const lastActivityAtMs = Object.fromEntries(
  participantIds.map((uid) => [uid, battleStartTime])
);

const hasSubmitted = Object.fromEntries(
  participantIds.map((uid) => [uid, false])
);

const roundId = crypto.randomUUID();
    const matchRef = doc(state.db, FIREBASE_COLLECTIONS.matches, state.channel.id);

    await runTransaction(state.db, async (transaction) => {
      const currentSnapshot = await transaction.get(matchRef);
      const current = currentSnapshot.exists() ? currentSnapshot.data() : null;

      if (current?.status === "playing") {
        throw new Error("MATCH_ALREADY_RUNNING");
      }

      transaction.set(matchRef, {
        roundId,
        channelId: state.channel.id,
        status: "playing",
        difficulty,
        hostUid: state.uid,
        participants: uniqueParticipants,
        participantIds,
        scores,
        eliminated,
        lastActivityAtMs,
        hasSubmitted,
        exitReasons: {},
        startedAtMs: battleStartTime,
        questions,
        questionIndex: 0,
        questionWinnerUid: null,
        questionWinnerNickname: null,
        createdAt: serverTimestamp(),
        createdAtMs:  battleStartTime,
        startsAtMs:  battleStartTime + 4000,
        questionStartedAtMs:  battleStartTime + 4000
      });
    });

    closeModal();
  } catch (error) {
    console.error(error);
    const message =
      error.message === "MATCH_ALREADY_RUNNING"
        ? "이미 이 방에서 대결이 진행 중입니다."
        : "대결을 시작하지 못했습니다. Firebase 연결과 보안 규칙을 확인하세요.";

    openModal(`
      <h2>대결을 시작할 수 없습니다.</h2>
      <p class="subtext">${message}</p>
      <button id="error-modal-confirm" class="primary-button" type="button">확인</button>
    `);
    $("#error-modal-confirm").addEventListener("click", closeModal);
  }
}

function renderBattle() {
  const match = state.match;
  if (!match?.questions?.length) return;

  const question = match.questions[match.questionIndex];
  elements.battleModeLabel.textContent =
    match.difficulty === "hard" ? "HARD · 오답 감점" : "EASY · 감점 없음";
  elements.battleProgress.textContent = `${match.questionIndex + 1} / 20`;
  elements.battleNumber.textContent = question.display;
  elements.difficultyPill.textContent = match.difficulty.toUpperCase();

  const now = Date.now();
  const secondsLeft = Math.ceil((match.startsAtMs - now) / 1000);
  const winnerExists = Boolean(match.questionWinnerUid);

  if (secondsLeft > 0) {
    elements.countdownBox.classList.remove("hidden");
    elements.countdownBox.textContent = String(secondsLeft);
    elements.battleAnswerInput.disabled = true;
    elements.battleSubmitButton.disabled = true;

    setTimeout(() => {
      if (state.mode === "battle") renderBattle();
    }, 250);
  } else {
    elements.countdownBox.classList.add("hidden");
    elements.battleAnswerInput.disabled = winnerExists;
    elements.battleSubmitButton.disabled = winnerExists;
  }

  if (winnerExists) {
    elements.winnerMessage.textContent =
      `⚡ ${match.questionWinnerNickname} 님이 가장 먼저 맞혔습니다!`;
    elements.winnerMessage.classList.remove("hidden");
    scheduleAdvance(match.roundId, match.questionIndex);
  } else {
    elements.winnerMessage.classList.add("hidden");
  }

  const inputQuestionKey = `${match.roundId}:${match.questionIndex}`;
  if (elements.battleAnswerInput.dataset.questionKey !== inputQuestionKey) {
    elements.battleAnswerInput.dataset.questionKey = inputQuestionKey;
    elements.battleAnswerInput.value = "";
    setFeedback(elements.battleFeedback);
    if (secondsLeft <= 0) setTimeout(() => elements.battleAnswerInput.focus(), 40);
  }
}

function scheduleAdvance(roundId, questionIndex) {
  const timerKey = `${roundId}:${questionIndex}`;
  if (state.advanceTimers.has(timerKey)) return;

  state.advanceTimers.add(timerKey);
  setTimeout(async () => {
    try {
      await advanceQuestion(roundId, questionIndex);
    } finally {
      state.advanceTimers.delete(timerKey);
    }
  }, 1300);
}

async function advanceQuestion(roundId, questionIndex) {
  if (!state.firebaseReady || !state.channel) return;

  const matchRef = doc(state.db, FIREBASE_COLLECTIONS.matches, state.channel.id);
  await runTransaction(state.db, async (transaction) => {
    const snapshot = await transaction.get(matchRef);
    if (!snapshot.exists()) return;

    const match = snapshot.data();
    if (
      match.roundId !== roundId ||
      match.status !== "playing" ||
      match.questionIndex !== questionIndex ||
      !match.questionWinnerUid
    ) {
      return;
    }

    if (questionIndex >= 19) {
      transaction.update(matchRef, {
        status: "finished",
        finishedAt: serverTimestamp(),
        finishedAtMs: Date.now()
      });
      return;
    }

    transaction.update(matchRef, {
      questionIndex: questionIndex + 1,
      questionWinnerUid: null,
      questionWinnerNickname: null,
      questionStartedAtMs: Date.now()
    });
  });
}

async function submitBattleAnswer(event) {
  event.preventDefault();

  const match = state.match;
  if (!match || match.status !== "playing" || state.mode !== "battle") return;
  if (Date.now() < match.startsAtMs || match.questionWinnerUid) return;

  const rawAnswer = elements.battleAnswerInput.value;
  if (!isHangulOnlyAnswer(rawAnswer)) {
  try {
    await updateDoc(
      doc(
        state.db,
        FIREBASE_COLLECTIONS.matches,
        state.channel.id
      ),
      {
        [`lastActivityAtMs.${state.uid}`]: Date.now(),
        [`hasSubmitted.${state.uid}`]: true
      }
    );
  } catch (error) {
    console.warn("활동 시각 저장 실패", error);
  }

  setFeedback(
    elements.battleFeedback,
    "숫자나 기호 없이 한글로만 입력하세요.",
    "error"
  );

  return;
}

  const expected = match.questions[match.questionIndex].answer;
  const correct = isExactAnswer(rawAnswer, expected);
  const matchRef = doc(state.db, FIREBASE_COLLECTIONS.matches, state.channel.id);

  try {
    const result = await runTransaction(state.db, async (transaction) => {
      const snapshot = await transaction.get(matchRef);
      if (!snapshot.exists()) return { type: "stale" };

      const fresh = snapshot.data();
      if (
        fresh.roundId !== match.roundId ||
        fresh.status !== "playing" ||
        fresh.questionIndex !== match.questionIndex ||
        fresh.eliminated?.[state.uid]
      ) {
        return { type: "stale" };
      }

      const activityUpdates = {
  [`lastActivityAtMs.${state.uid}`]: Date.now(),
  [`hasSubmitted.${state.uid}`]: true
};

      if (correct) {
        if (fresh.questionWinnerUid) {
  transaction.update(matchRef, activityUpdates);
  return { type: "late" };
}

        const nextScore = (fresh.scores?.[state.uid] || 0) + 1;
        transaction.update(matchRef, {
  ...activityUpdates,
  [`scores.${state.uid}`]: nextScore,
  questionWinnerUid: state.uid,
          questionWinnerNickname: state.nickname,
          answerReceivedAt: serverTimestamp(),
          answerReceivedAtMs: Date.now()
        });

        return { type: "correct", score: nextScore };
      }

      if (fresh.difficulty !== "hard") {
  transaction.update(matchRef, activityUpdates);
  return { type: "wrong-easy" };
}

      const currentScore = fresh.scores?.[state.uid] || 0;
      if (currentScore > 0) {
        transaction.update(matchRef, {
  ...activityUpdates,
  [`scores.${state.uid}`]: currentScore - 1
});
        return { type: "wrong-hard", score: currentScore - 1 };
      }

      const nextEliminated = { ...(fresh.eliminated || {}), [state.uid]: true };
      const activeCount = fresh.participantIds.filter(
        (uid) => !nextEliminated[uid]
      ).length;

      const updates = {
  ...activityUpdates,
  [`eliminated.${state.uid}`]: true,
  [`eliminatedAtMs.${state.uid}`]: Date.now(),
  [`exitReasons.${state.uid}`]: "hard-mistake"
};

      if (activeCount === 0) {
        updates.status = "finished";
        updates.finishedAt = serverTimestamp();
        updates.finishedAtMs = Date.now();
      }

      transaction.update(matchRef, updates);
      return { type: "eliminated" };
    });

    elements.battleAnswerInput.value = "";

    if (result.type === "correct") {
      setFeedback(elements.battleFeedback, "정답! 가장 먼저 제출했습니다.", "success");
    } else if (result.type === "late") {
      setFeedback(elements.battleFeedback, "정답이지만 다른 친구가 조금 더 빨랐습니다.", "error");
    } else if (result.type === "wrong-easy") {
      setFeedback(elements.battleFeedback, "오답입니다. 다시 입력하세요.", "error");
    } else if (result.type === "wrong-hard") {
      setFeedback(
        elements.battleFeedback,
        `오답으로 1점 감점되었습니다. 현재 ${result.score}점입니다.`,
        "error"
      );
    } else if (result.type === "eliminated") {
      setFeedback(elements.battleFeedback, "0점에서 다시 틀려 퇴장됩니다.", "error");
    }
  } catch (error) {
    console.error(error);
    setFeedback(elements.battleFeedback, "답을 처리하지 못했습니다. 다시 제출하세요.", "error");
  }
}

function renderScores() {
  const match = state.match;
  if (!match?.participants) return;

  const sorted = [...match.participants].sort((a, b) => {
    const scoreDifference = (match.scores?.[b.uid] || 0) - (match.scores?.[a.uid] || 0);
    if (scoreDifference !== 0) return scoreDifference;
    return a.nickname.localeCompare(b.nickname, "ko");
  });

  elements.scoreList.innerHTML = sorted.map((participant) => {
    const eliminated = match.eliminated?.[participant.uid];
    return `
      <li class="${eliminated ? "eliminated" : ""}">
        <span class="score-name">${escapeHtml(participant.nickname)}</span>
        <span class="score-value">${match.scores?.[participant.uid] || 0}점</span>
      </li>
    `;
  }).join("");
}

async function handleElimination(match) {
  state.handledEliminations.add(match.roundId);
  sessionStorage.setItem(
    "handledEliminations",
    JSON.stringify([...state.handledEliminations].slice(-20))
  );

  const score = match.scores?.[state.uid] || 0;
  await leaveRoom({ forced: true });

  openModal(`
    <p class="eyebrow">HARD MODE</p>
    <h2>대결에서 퇴장되었습니다.</h2>
    <p class="subtext">0점인 상태에서 오답을 한 번 더 입력했습니다.</p>
    <div class="notice-box">현재 점수: ${score}점<br>다시 참가하려면 단계별 방에 다시 입장하세요.</div>
    <button id="elimination-confirm" class="primary-button" type="button">방 선택으로 돌아가기</button>
  `, { closable: false });

  $("#elimination-confirm").addEventListener("click", closeModal);
}

async function handleFinishedRound(match) {
  state.handledRoundIds.add(match.roundId);
  sessionStorage.setItem(
    "handledRoundIds",
    JSON.stringify([...state.handledRoundIds].slice(-20))
  );

  const sorted = [...match.participants].sort(
    (a, b) => (match.scores?.[b.uid] || 0) - (match.scores?.[a.uid] || 0)
  );

  const resultItems = sorted.map((participant, index) => `
    <li>
      <span>${index + 1}위 · ${escapeHtml(participant.nickname)}</span>
      <strong>${match.scores?.[participant.uid] || 0}점</strong>
    </li>
  `).join("");

  await leaveRoom({ forced: true });

  openModal(`
    <p class="eyebrow">ROUND FINISHED</p>
    <h2>20문제 대결이 끝났습니다.</h2>
    <p class="subtext">참가자는 모두 방에서 퇴장되었습니다.</p>
    <ol class="result-list">${resultItems}</ol>
    <button id="result-confirm" class="primary-button" type="button">방 선택으로 돌아가기</button>
  `, { closable: false });

  $("#result-confirm").addEventListener("click", closeModal);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

elements.nicknameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const nickname = sanitizeNickname(elements.nicknameInput.value);

  if (!nickname) {
    elements.nicknameInput.setCustomValidity("닉네임을 입력하세요.");
    elements.nicknameInput.reportValidity();
    return;
  }

  elements.nicknameInput.setCustomValidity("");
  saveNickname(nickname);
  showScreen("channels");
});

elements.nicknameInput.addEventListener("input", () => {
  elements.nicknameInput.setCustomValidity("");
});

elements.changeNicknameButton.addEventListener("click", () => {
  sessionStorage.removeItem("numberReadingNickname");
  state.nickname = "";
  elements.nicknameInput.value = "";
  showScreen("nickname");
  elements.nicknameInput.focus();
});

elements.leaveRoomButton.addEventListener("click", () => leaveRoom());
elements.soloButton.addEventListener("click", startSolo);
elements.battleButton.addEventListener("click", showDifficultyModal);
elements.soloAnswerForm.addEventListener("submit", submitSoloAnswer);
elements.stopSoloButton.addEventListener("click", stopSolo);
elements.battleAnswerForm.addEventListener("submit", submitBattleAnswer);
elements.modalCloseButton.addEventListener("click", closeModal);
elements.modalBackdrop.addEventListener("click", (event) => {
  if (event.target === elements.modalBackdrop && !elements.modalCloseButton.classList.contains("hidden")) {
    closeModal();
  }
});

window.addEventListener("beforeunload", () => {
  if (state.firebaseReady && state.channel && state.uid) {
    deleteDoc(
      doc(state.db, FIREBASE_COLLECTIONS.rooms, state.channel.id, "presence", state.uid)
    ).catch(() => {});
  }
});

renderChannels();
loadNickname();
initializeFirebase();
