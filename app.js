import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
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

const STORAGE_KEYS = {
  nickname: "numberReadingNickname",
  handledRounds: "handledRoundIds",
  handledEliminations: "handledEliminations"
};

const MIN_BATTLE_PLAYERS = 4;
const PRESENCE_VISIBLE_MS = 65 * 1000;
const STALE_PRESENCE_MS = 2 * 60 * 1000;
const MATCH_INACTIVITY_LIMIT_MS = 3 * 60 * 1000;
const MATCH_CLEANUP_INTERVAL_MS = 15 * 1000;
const RECENT_EVENT_WINDOW_MS = 90 * 1000;

const state = {
  nickname: "",
  firebaseReady: false,
  auth: null,
  db: null,
  uid: null,
  channel: null,
  mode: "idle",
  match: null,
  onlineUsers: [],
  soloQuestion: null,
  soloCorrect: 0,
  soloAttempts: 0,
  presenceUnsubscribe: null,
  matchUnsubscribe: null,
  heartbeatId: null,
  matchCleanupId: null,
  advanceTimers: new Set(),
  handledRoundIds: new Set(
    JSON.parse(sessionStorage.getItem(STORAGE_KEYS.handledRounds) || "[]")
  ),
  handledEliminations: new Set(
    JSON.parse(sessionStorage.getItem(STORAGE_KEYS.handledEliminations) || "[]")
  ),
  suppressNextPopstate: false,
  exitInProgress: false,
  sessionPromptOpen: false
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
  battleLobbyPanel: $("#battle-lobby-panel"),
  battleLobbyTitle: $("#battle-lobby-title"),
  battleLobbyDescription: $("#battle-lobby-description"),
  battleAcceptedCount: $("#battle-accepted-count"),
  acceptBattleButton: $("#accept-battle-button"),
  startBattleButton: $("#start-battle-button"),
  cancelBattleButton: $("#cancel-battle-button"),
  soloPanel: $("#solo-panel"),
  soloBattleInvite: $("#solo-battle-invite"),
  openBattleInviteButton: $("#open-battle-invite-button"),
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
  battleExitButton: $("#battle-exit-button"),
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
  state.sessionPromptOpen = false;
}

function sanitizeNickname(value) {
  return value.replace(/[<>&"'`]/g, "").trim().slice(0, 12);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function saveHandledSet(storageKey, values) {
  sessionStorage.setItem(storageKey, JSON.stringify([...values].slice(-30)));
}

function loadNickname() {
  const saved = sessionStorage.getItem(STORAGE_KEYS.nickname);
  if (!saved) return;

  state.nickname = saved;
  elements.homeNickname.textContent = saved;
  elements.roomNickname.textContent = saved;
  elements.nicknameInput.value = saved;
  showScreen("channels");
}

function saveNickname(nickname) {
  state.nickname = nickname;
  sessionStorage.setItem(STORAGE_KEYS.nickname, nickname);
  elements.homeNickname.textContent = nickname;
  elements.roomNickname.textContent = nickname;
  elements.nicknameInput.value = nickname;
}

function getChannel(channelId = state.channel?.id) {
  return CHANNELS.find((channel) => channel.id === channelId);
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
    button.addEventListener("click", () => {
      enterRoom(button.dataset.channelId).catch(console.error);
    });
  });
}

function generateNumberString(channel) {
  const digitCount =
    channel.minDigits +
    Math.floor(Math.random() * (channel.maxDigits - channel.minDigits + 1));

  let number = String(1 + Math.floor(Math.random() * 9));
  for (let index = 1; index < digitCount; index += 1) {
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

function createQuestion(channel) {
  const number = generateNumberString(channel);
  return {
    number,
    display: number,
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

function getSessionNickname(session) {
  const match = session.match;

  if (match.status === "playing") {
    return (
      match.participants?.find((participant) => participant.uid === state.uid)?.nickname ||
      state.nickname ||
      "익명"
    );
  }

  return (
    match.acceptedPlayers?.[state.uid] ||
    (match.hostUid === state.uid ? match.hostNickname : "") ||
    state.nickname ||
    "익명"
  );
}

function getSessionSortTime(session) {
  const match = session.match;
  return (
    match.startedAtMs ||
    match.proposalUpdatedAtMs ||
    match.createdAtMs ||
    0
  );
}

async function findActiveSessionsForCurrentUser() {
  if (!state.firebaseReady || !state.uid) return [];

  const snapshot = await getDocs(
    collection(state.db, FIREBASE_COLLECTIONS.matches)
  );

  return snapshot.docs
    .map((item) => ({
      channelId: item.id,
      match: item.data()
    }))
    .filter(({ match }) => {
      if (match.status === "waiting") {
        return (
          match.hostUid === state.uid ||
          Boolean(match.acceptedPlayers?.[state.uid])
        );
      }

      if (match.status === "playing") {
        return (
          match.participantIds?.includes(state.uid) &&
          !match.eliminated?.[state.uid]
        );
      }

      return false;
    })
    .sort((first, second) => getSessionSortTime(second) - getSessionSortTime(first));
}

async function getNormalizedActiveSessions() {
  const sessions = await findActiveSessionsForCurrentUser();
  if (sessions.length <= 1) return sessions;

  const [primarySession, ...duplicates] = sessions;
  await Promise.allSettled(
    duplicates.map((session) =>
      abandonSession(session, "duplicate-session-cleanup")
    )
  );

  return [primarySession];
}

async function findBlockingSession({ allowedRoundId = null } = {}) {
  const sessions = await getNormalizedActiveSessions();
  return sessions.find(({ match }) => match.roundId !== allowedRoundId) || null;
}

async function abandonSession(session, reason = "abandoned-previous-match") {
  if (!state.firebaseReady || !session) return;

  const matchRef = doc(
    state.db,
    FIREBASE_COLLECTIONS.matches,
    session.channelId
  );

  await runTransaction(state.db, async (transaction) => {
    const snapshot = await transaction.get(matchRef);
    if (!snapshot.exists()) return;

    const fresh = snapshot.data();
    if (fresh.roundId !== session.match.roundId) return;

    if (fresh.status === "waiting") {
      if (fresh.hostUid === state.uid) {
        transaction.delete(matchRef);
        return;
      }

      const acceptedPlayers = { ...(fresh.acceptedPlayers || {}) };
      delete acceptedPlayers[state.uid];
      transaction.update(matchRef, { acceptedPlayers });
      return;
    }

    if (
      fresh.status !== "playing" ||
      !fresh.participantIds?.includes(state.uid) ||
      fresh.eliminated?.[state.uid]
    ) {
      return;
    }

    const now = Date.now();
    const nextEliminated = {
      ...(fresh.eliminated || {}),
      [state.uid]: true
    };

    const updates = {
      [`eliminated.${state.uid}`]: true,
      [`eliminatedAtMs.${state.uid}`]: now,
      [`exitReasons.${state.uid}`]: reason
    };

    const remainingActiveCount = fresh.participantIds.filter(
      (uid) => !nextEliminated[uid]
    ).length;

    if (remainingActiveCount === 0) {
      updates.status = "finished";
      updates.finishedAt = serverTimestamp();
      updates.finishedAtMs = now;
      updates.finishedReason = "all-players-left";
    }

    transaction.update(matchRef, updates);
  });
}

function showExistingSessionPrompt(session, { afterAbandon = null } = {}) {
  if (state.sessionPromptOpen) return;
  state.sessionPromptOpen = true;

  const channel = getChannel(session.channelId);
  const oldNickname = getSessionNickname(session);
  const statusText =
    session.match.status === "playing" ? "진행 중인 대결" : "참여 중인 대결 모집";

  openModal(
    `
      <p class="eyebrow">이전 대결 발견</p>
      <h2>${escapeHtml(oldNickname)} 님의 ${statusText}이 있습니다.</h2>
      <p class="subtext">
        ${escapeHtml(channel?.label || session.channelId)}에서 이어서 참여하거나,
        이전 참여를 포기한 뒤 현재 닉네임을 사용할 수 있습니다.
      </p>
      <div class="modal-action-stack">
        <button id="resume-existing-session" class="primary-button" type="button">
          ${escapeHtml(oldNickname)} 닉네임으로 이어하기
        </button>
        <button id="abandon-existing-session" class="secondary-button danger-outline" type="button">
          이전 대결 포기하기
        </button>
      </div>
    `,
    { closable: false }
  );

  $("#resume-existing-session").addEventListener("click", async () => {
    saveNickname(oldNickname);
    closeModal();
    await enterRoom(session.channelId, {
      skipSessionCheck: true,
      replaceExistingRoom: false
    });
  });

  $("#abandon-existing-session").addEventListener("click", async () => {
    const button = $("#abandon-existing-session");
    button.disabled = true;

    try {
      await abandonSession(session);
      closeModal();
      if (typeof afterAbandon === "function") {
        await afterAbandon();
      }
    } catch (error) {
      console.error(error);
      button.disabled = false;
      elements.modalContent.insertAdjacentHTML(
        "beforeend",
        '<p class="feedback error">이전 대결 포기 처리를 완료하지 못했습니다.</p>'
      );
    }
  });
}

async function resumePreviousSessionIfAvailable() {
  const sessions = await getNormalizedActiveSessions();
  if (!sessions.length) return false;

  const session = sessions[0];
  const oldNickname = getSessionNickname(session);

  if (!state.nickname || state.nickname === oldNickname) {
    saveNickname(oldNickname);
    await enterRoom(session.channelId, {
      skipSessionCheck: true,
      replaceExistingRoom: false
    });
    return true;
  }

  showExistingSessionPrompt(session);
  return true;
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

    await cleanupAllStaleMatches();
    await resumePreviousSessionIfAvailable();
  } catch (error) {
    console.error(error);
    state.firebaseReady = false;
    elements.connectionBadge.textContent = "Firebase 연결 실패 · 혼자하기만 가능";
    elements.connectionBadge.className = "connection-badge demo";
  }
}

function setRoomHistory(channelId, { replace = false } = {}) {
  const nextState = { screen: "room", channelId };

  if (replace) {
    history.replaceState(nextState, "", location.href);
    return;
  }

  if (
    history.state?.screen === "room" &&
    history.state?.channelId === channelId
  ) {
    return;
  }

  history.pushState(nextState, "", location.href);
}

function returnHistoryToChannels() {
  if (history.state?.screen !== "room") {
    history.replaceState({ screen: "channels" }, "", location.href);
    return;
  }

  state.suppressNextPopstate = true;
  history.back();
}

async function enterRoom(
  channelId,
  { skipSessionCheck = false, replaceExistingRoom = false } = {}
) {
  const channel = getChannel(channelId);
  if (!channel || state.exitInProgress) return;

  if (state.channel?.id === channelId) {
    showScreen("room");
    return;
  }

  let shouldReplaceRoomHistory = replaceExistingRoom;

  if (state.channel && state.channel.id !== channelId) {
    await requestIntentionalRoomExit({ navigateHistory: false });
    if (state.channel) return;
    shouldReplaceRoomHistory = true;
  }

  if (state.firebaseReady && !skipSessionCheck) {
    const blockingSession = await findBlockingSession();
    if (blockingSession) {
      showExistingSessionPrompt(blockingSession, {
        afterAbandon: () =>
          enterRoom(channelId, {
            skipSessionCheck: true,
            replaceExistingRoom
          })
      });
      return;
    }
  }

  state.channel = channel;
  state.mode = "idle";
  state.match = null;
  state.onlineUsers = [];

  elements.roomTitle.textContent = `${channel.label} 방`;
  elements.roomRange.textContent = `${channel.range} · ${channel.unit}`;
  elements.roomNickname.textContent = state.nickname;
  showScreen("room");
  renderRoom();
  setRoomHistory(channel.id, { replace: shouldReplaceRoomHistory });

  if (!state.firebaseReady) {
    state.onlineUsers = [
      { uid: "local", nickname: state.nickname, mode: "idle", lastSeenMs: Date.now() }
    ];
    renderOnlineUsers();
    return;
  }

  try {
    await createOrUpdatePresence("idle", { preserveJoinedAt: false });
    await cleanupStaleMatch(channel.id);
    subscribeToPresence();
    subscribeToMatch();
    startHeartbeat();
    startMatchCleanup();
    cleanupStalePresence().catch(console.warn);
  } catch (error) {
    console.error(error);
    elements.roomStatusBanner.textContent =
      "방에 연결하지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도하세요.";
    elements.roomStatusBanner.className = "status-banner alert";
  }
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

async function clearRoomState({ closeCurrentModal = true } = {}) {
  const oldChannel = state.channel;
  stopRoomListeners();

  if (state.firebaseReady && oldChannel && state.uid) {
    try {
      await deleteDoc(
        doc(
          state.db,
          FIREBASE_COLLECTIONS.rooms,
          oldChannel.id,
          "presence",
          state.uid
        )
      );
    } catch (error) {
      console.warn("접속자 정보 삭제 실패", error);
    }
  }

  state.channel = null;
  state.mode = "idle";
  state.match = null;
  state.onlineUsers = [];
  state.soloQuestion = null;
  elements.battleAnswerInput.value = "";
  elements.soloAnswerInput.value = "";
  elements.battleAnswerInput.dataset.questionKey = "";

  showScreen(state.nickname ? "channels" : "nickname");

  if (closeCurrentModal) closeModal();
}

function currentRoomExitNeedsConfirmation() {
  const match = state.match;
  if (!match || !state.uid) return false;

  if (match.status === "waiting") {
    return (
      match.hostUid === state.uid ||
      Boolean(match.acceptedPlayers?.[state.uid])
    );
  }

  if (match.status === "playing") {
    return (
      match.participantIds?.includes(state.uid) &&
      !match.eliminated?.[state.uid]
    );
  }

  return false;
}

function getIntentionalExitMessage() {
  const match = state.match;

  if (match?.status === "waiting" && match.hostUid === state.uid) {
    return "방을 나가면 현재 대결 제안이 즉시 취소됩니다. 나갈까요?";
  }

  if (match?.status === "waiting" && match.acceptedPlayers?.[state.uid]) {
    return "방을 나가면 대결 참여가 취소됩니다. 나갈까요?";
  }

  if (
    match?.status === "playing" &&
    match.participantIds?.includes(state.uid) &&
    !match.eliminated?.[state.uid]
  ) {
    return "대결 중 방을 나가면 즉시 퇴장 처리되며 현재 점수만 결과에 남습니다. 나갈까요?";
  }

  return "이 방에서 나갈까요?";
}

async function recordIntentionalExitFromCurrentSession() {
  const match = state.match;
  const channel = state.channel;

  if (!state.firebaseReady || !match || !channel) return;

  const session = {
    channelId: channel.id,
    match
  };

  await abandonSession(session, "left-intentionally");
}

async function requestIntentionalRoomExit({ navigateHistory = true } = {}) {
  if (!state.channel || state.exitInProgress) return false;

  const needsConfirmation = currentRoomExitNeedsConfirmation();
  if (needsConfirmation && !window.confirm(getIntentionalExitMessage())) {
    return false;
  }

  state.exitInProgress = true;
  stopRoomListeners();

  try {
    await recordIntentionalExitFromCurrentSession();
  } catch (error) {
    console.error("대결 퇴장 기록 실패", error);
  }

  await clearRoomState();
  state.exitInProgress = false;

  if (navigateHistory) {
    returnHistoryToChannels();
  }

  return true;
}

async function createOrUpdatePresence(
  mode = state.mode,
  { preserveJoinedAt = true } = {}
) {
  if (!state.firebaseReady || !state.channel || !state.uid) return;

  const data = {
    uid: state.uid,
    nickname: state.nickname,
    mode,
    lastSeen: serverTimestamp(),
    lastSeenMs: Date.now()
  };

  if (!preserveJoinedAt) {
    data.joinedAt = serverTimestamp();
    data.joinedAtMs = Date.now();
  }

  await setDoc(
    doc(
      state.db,
      FIREBASE_COLLECTIONS.rooms,
      state.channel.id,
      "presence",
      state.uid
    ),
    data,
    { merge: true }
  );
}

async function setPresenceMode(mode) {
  state.mode = mode;

  if (!state.firebaseReady || !state.channel) {
    state.onlineUsers = [
      { uid: "local", nickname: state.nickname, mode, lastSeenMs: Date.now() }
    ];
    renderOnlineUsers();
    renderRoom();
    return;
  }

  try {
    await updateDoc(
      doc(
        state.db,
        FIREBASE_COLLECTIONS.rooms,
        state.channel.id,
        "presence",
        state.uid
      ),
      {
        mode,
        nickname: state.nickname,
        lastSeen: serverTimestamp(),
        lastSeenMs: Date.now()
      }
    );
  } catch (error) {
    console.warn(error);
    await createOrUpdatePresence(mode, { preserveJoinedAt: false });
  }

  renderRoom();
}

async function heartbeatOnce() {
  if (!state.firebaseReady || !state.channel || !state.uid) return;

  try {
    await updateDoc(
      doc(
        state.db,
        FIREBASE_COLLECTIONS.rooms,
        state.channel.id,
        "presence",
        state.uid
      ),
      {
        nickname: state.nickname,
        mode: state.mode,
        lastSeen: serverTimestamp(),
        lastSeenMs: Date.now()
      }
    );
  } catch (error) {
    console.warn("접속 상태 갱신 실패", error);
    await createOrUpdatePresence(state.mode, { preserveJoinedAt: false });
  }

  if (
    state.match?.status === "waiting" &&
    state.match.hostUid === state.uid
  ) {
    try {
      await updateDoc(
        doc(
          state.db,
          FIREBASE_COLLECTIONS.matches,
          state.channel.id
        ),
        { proposalUpdatedAtMs: Date.now() }
      );
    } catch (error) {
      console.warn("대결 제안 유지 시각 갱신 실패", error);
    }
  }
}

function startHeartbeat() {
  if (!state.firebaseReady || state.heartbeatId) return;

  state.heartbeatId = window.setInterval(() => {
    heartbeatOnce().catch(console.warn);
  }, 20 * 1000);
}

async function cleanupStalePresence() {
  if (!state.firebaseReady || !state.channel) return;

  try {
    const snapshot = await getDocs(
      collection(
        state.db,
        FIREBASE_COLLECTIONS.rooms,
        state.channel.id,
        "presence"
      )
    );

    const cutoff = Date.now() - STALE_PRESENCE_MS;
    const deletions = snapshot.docs
      .filter((item) => (item.data().lastSeenMs || 0) < cutoff)
      .map((item) => deleteDoc(item.ref));

    await Promise.allSettled(deletions);
  } catch (error) {
    console.warn("오래된 접속자 정리 실패", error);
  }
}

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
      if (participantIds.length === 0) {
        transaction.delete(matchRef);
        return;
      }

      const eliminated = match.eliminated || {};
      const lastActivityAtMs = match.lastActivityAtMs || {};

      const isLegacyMatch = Object.keys(lastActivityAtMs).length === 0;
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

        return now - lastActivity >= MATCH_INACTIVITY_LIMIT_MS;
      });

      if (!inactiveIds.length) return;

      const nextEliminated = { ...eliminated };
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

async function cleanupAllStaleMatches() {
  if (!state.firebaseReady) return;

  await Promise.allSettled(
    CHANNELS.map((channel) => cleanupStaleMatch(channel.id))
  );
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

function subscribeToPresence() {
  if (!state.firebaseReady || !state.channel) return;

  state.presenceUnsubscribe?.();
  const channelId = state.channel.id;

  state.presenceUnsubscribe = onSnapshot(
    collection(
      state.db,
      FIREBASE_COLLECTIONS.rooms,
      channelId,
      "presence"
    ),
    (snapshot) => {
      if (state.channel?.id !== channelId) return;

      const cutoff = Date.now() - PRESENCE_VISIBLE_MS;
      state.onlineUsers = snapshot.docs
        .map((item) => item.data())
        .filter((user) => (user.lastSeenMs || 0) >= cutoff)
        .sort((first, second) =>
          String(first.nickname || "").localeCompare(
            String(second.nickname || ""),
            "ko"
          )
        );

      renderOnlineUsers();
      renderRoom();
    },
    (error) => {
      console.error(error);
      elements.roomStatusBanner.textContent =
        "접속자 목록을 불러오지 못했습니다.";
      elements.roomStatusBanner.className = "status-banner alert";
    }
  );
}

function subscribeToMatch() {
  if (!state.firebaseReady || !state.channel) return;

  state.matchUnsubscribe?.();
  const channelId = state.channel.id;
  const matchRef = doc(
    state.db,
    FIREBASE_COLLECTIONS.matches,
    channelId
  );

  state.matchUnsubscribe = onSnapshot(
    matchRef,
    async (snapshot) => {
      if (state.channel?.id !== channelId || state.exitInProgress) return;

      if (!snapshot.exists()) {
        state.match = null;
        if (state.mode === "battle") {
          await setPresenceMode("idle");
        }
        renderOnlineUsers();
        renderRoom();
        return;
      }

      const match = snapshot.data();
      state.match = match;

      const isParticipant = match.participantIds?.includes(state.uid);
      const isEliminated = Boolean(match.eliminated?.[state.uid]);
      const eliminatedAtMs = match.eliminatedAtMs?.[state.uid] || 0;
      const recentlyEliminated =
        eliminatedAtMs > 0 &&
        Date.now() - eliminatedAtMs < RECENT_EVENT_WINDOW_MS;
      const finishedAtMs = match.finishedAtMs || 0;
      const recentlyFinished =
        finishedAtMs > 0 &&
        Date.now() - finishedAtMs < RECENT_EVENT_WINDOW_MS;

      if (
        match.status === "playing" &&
        isParticipant &&
        !isEliminated
      ) {
        if (state.mode !== "battle") {
          await setPresenceMode("battle");
        }
        state.mode = "battle";
      } else if (state.mode === "battle") {
        await setPresenceMode("idle");
      }

      if (
        match.status === "playing" &&
        isParticipant &&
        isEliminated &&
        recentlyEliminated &&
        !state.handledEliminations.has(match.roundId)
      ) {
        await handleElimination(match);
        return;
      }

      if (
        match.status === "finished" &&
        isParticipant &&
        recentlyFinished &&
        !state.handledRoundIds.has(match.roundId)
      ) {
        await handleFinishedRound(match);
        return;
      }

      renderOnlineUsers();
      renderRoom();
    },
    (error) => {
      console.error(error);
      elements.roomStatusBanner.textContent =
        "대결 정보를 불러오지 못했습니다.";
      elements.roomStatusBanner.className = "status-banner alert";
    }
  );
}

function renderRoom() {
  if (!state.channel) return;

  const waitingMatch = state.match?.status === "waiting";
  const activeMatch = state.match?.status === "playing";
  const isParticipant = state.match?.participantIds?.includes(state.uid);
  const eliminated = Boolean(state.match?.eliminated?.[state.uid]);
  const showLobby = waitingMatch && state.mode === "idle";
  const showBattle =
    state.mode === "battle" &&
    activeMatch &&
    isParticipant &&
    !eliminated;

  elements.modeSelectPanel.classList.toggle(
    "hidden",
    state.mode !== "idle" || waitingMatch || showBattle
  );
  elements.battleLobbyPanel.classList.toggle("hidden", !showLobby);
  elements.soloPanel.classList.toggle("hidden", state.mode !== "solo");
  elements.battlePanel.classList.toggle("hidden", !showBattle);
  elements.soloBattleInvite.classList.toggle(
    "hidden",
    !(waitingMatch && state.mode === "solo")
  );

  elements.battleButton.disabled =
    !state.firebaseReady || waitingMatch || activeMatch;

  if (!state.firebaseReady) {
    elements.roomStatusBanner.textContent =
      "Firebase가 연결되지 않아 현재는 혼자하기만 이용할 수 있습니다.";
    elements.roomStatusBanner.className = "status-banner alert";
  } else if (waitingMatch && state.mode === "solo") {
    elements.roomStatusBanner.textContent =
      `${state.match.hostNickname || "접속자"} 님이 대결을 제안했습니다. 혼자하기를 마친 뒤 참여할 수 있습니다.`;
    elements.roomStatusBanner.className = "status-banner alert";
  } else if (waitingMatch) {
    elements.roomStatusBanner.textContent =
      `대결 참여자를 모집 중입니다. ${MIN_BATTLE_PLAYERS}명 이상 참여해야 시작할 수 있습니다.`;
    elements.roomStatusBanner.className = "status-banner";
  } else if (activeMatch && !isParticipant) {
    elements.roomStatusBanner.textContent =
      "현재 이 방에서 대결이 진행 중입니다. 대결이 끝날 때까지 혼자하기만 가능합니다.";
    elements.roomStatusBanner.className = "status-banner alert";
  } else if (activeMatch && isParticipant && eliminated) {
    elements.roomStatusBanner.textContent =
      "이 대결에서는 이미 퇴장 처리되었습니다.";
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
      "대결을 제안하거나 혼자 연습할 수 있습니다.";
    elements.roomStatusBanner.className = "status-banner";
  }

  elements.scorePanel.classList.toggle("hidden", !activeMatch);

  if (showLobby) renderBattleLobby();
  if (showBattle) renderBattle();
  if (activeMatch) renderScores();
}

function renderOnlineUsers() {
  elements.onlineCount.textContent = `${state.onlineUsers.length}명`;

  if (!state.onlineUsers.length) {
    elements.onlineUserList.innerHTML = "<li>접속자가 없습니다.</li>";
    return;
  }

  const waitingMatch = state.match?.status === "waiting";
  const acceptedPlayers = state.match?.acceptedPlayers || {};
  const modeLabels = {
    idle: "대기 중",
    solo: "혼자하기",
    battle: "대결 중"
  };

  elements.onlineUserList.innerHTML = state.onlineUsers
    .map((user) => {
      let label = modeLabels[user.mode] || "대기 중";
      let tagClass = "";

      if (waitingMatch) {
        if (user.mode === "solo") {
          label = acceptedPlayers[user.uid]
            ? "참여 예약 · 혼자하기"
            : "혼자하기";
        } else if (acceptedPlayers[user.uid]) {
          label = "✓ 참여";
          tagClass = " accepted";
        } else {
          label = "미참여";
          tagClass = " not-accepted";
        }
      }

      return `
        <li>
          <strong>${escapeHtml(user.nickname || "익명")}</strong>
          <span class="mode-tag${tagClass}">${escapeHtml(label)}</span>
        </li>
      `;
    })
    .join("");
}

function getActiveAcceptedUsers(match = state.match) {
  const acceptedPlayers = match?.acceptedPlayers || {};
  return state.onlineUsers.filter(
    (user) =>
      user.mode !== "solo" &&
      Boolean(acceptedPlayers[user.uid])
  );
}

function renderBattleLobby() {
  const match = state.match;
  if (!match || match.status !== "waiting") return;

  const activeAcceptedUsers = getActiveAcceptedUsers(match);
  const acceptedPlayers = match.acceptedPlayers || {};
  const isHost = match.hostUid === state.uid;
  const isAccepted = Boolean(acceptedPlayers[state.uid]);
  const difficulty =
    match.difficulty === "hard"
      ? "Hard · 오답 감점"
      : "Easy · 감점 없음";

  elements.battleLobbyTitle.textContent =
    `${match.hostNickname || "접속자"} 님의 대결 제안`;
  elements.battleLobbyDescription.textContent =
    `${difficulty} 방식입니다. 현재 접속 중이며 혼자하기가 아닌 참여자 ${MIN_BATTLE_PLAYERS}명 이상일 때 시작할 수 있습니다.`;
  elements.battleAcceptedCount.textContent =
    `${activeAcceptedUsers.length}명 참여`;

  elements.acceptBattleButton.classList.toggle("hidden", isHost);
  elements.startBattleButton.classList.toggle("hidden", !isHost);
  elements.cancelBattleButton.classList.toggle("hidden", !isHost);

  elements.acceptBattleButton.textContent =
    isAccepted ? "참여 취소" : "참여하기";
  elements.startBattleButton.disabled =
    activeAcceptedUsers.length < MIN_BATTLE_PLAYERS;
}

function startSolo() {
  state.soloCorrect = 0;
  state.soloAttempts = 0;
  elements.soloCorrectCount.textContent = "0";
  elements.soloAttemptCount.textContent = "0";
  setPresenceMode("solo").catch(console.error);
  nextSoloQuestion();
}

function nextSoloQuestion() {
  if (!state.channel || state.mode !== "solo") return;

  state.soloQuestion = createQuestion(state.channel);
  elements.soloNumber.textContent = state.soloQuestion.display;
  elements.soloAnswerInput.value = "";
  elements.soloAnswerInput.disabled = false;
  setFeedback(elements.soloFeedback);
  setTimeout(() => elements.soloAnswerInput.focus(), 50);
}

function submitSoloAnswer(event) {
  event.preventDefault();
  if (!state.soloQuestion || state.mode !== "solo") return;

  const answer = elements.soloAnswerInput.value;
  state.soloAttempts += 1;
  elements.soloAttemptCount.textContent = String(state.soloAttempts);

  if (!isHangulOnlyAnswer(answer)) {
    setFeedback(
      elements.soloFeedback,
      "숫자나 기호 없이 한글과 띄어쓰기만 입력하세요.",
      "error"
    );
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
  setFeedback(
    elements.soloFeedback,
    "정답입니다! 다음 문제로 넘어갑니다.",
    "success"
  );
  setTimeout(nextSoloQuestion, 650);
}

async function stopSolo() {
  state.soloQuestion = null;
  await setPresenceMode("idle");
  state.mode = "idle";
  renderRoom();
}

async function openBattleInviteFromSolo() {
  await stopSolo();
  renderRoom();
}

function showDifficultyModal() {
  if (
    !state.firebaseReady ||
    state.match?.status === "waiting" ||
    state.match?.status === "playing"
  ) {
    return;
  }

  openModal(`
    <p class="eyebrow">20문제 대결</p>
    <h2>제안할 난이도를 선택하세요.</h2>
    <p class="subtext">난이도를 고르면 방 안의 학생들에게 참여 버튼이 나타납니다.</p>
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

  elements.modalContent
    .querySelectorAll("[data-difficulty]")
    .forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        await proposeBattle(button.dataset.difficulty);
      });
    });
}

async function proposeBattle(difficulty) {
  if (!state.firebaseReady || !state.channel || state.mode !== "idle") return;

  const blockingSession = await findBlockingSession();
  if (blockingSession) {
    showExistingSessionPrompt(blockingSession, {
      afterAbandon: () => proposeBattle(difficulty)
    });
    return;
  }

  const roundId = crypto.randomUUID();
  const now = Date.now();
  const matchRef = doc(
    state.db,
    FIREBASE_COLLECTIONS.matches,
    state.channel.id
  );

  try {
    await runTransaction(state.db, async (transaction) => {
      const snapshot = await transaction.get(matchRef);
      const current = snapshot.exists() ? snapshot.data() : null;

      if (current?.status === "waiting" || current?.status === "playing") {
        throw new Error("MATCH_ALREADY_EXISTS");
      }

      transaction.set(matchRef, {
        roundId,
        channelId: state.channel.id,
        status: "waiting",
        difficulty,
        hostUid: state.uid,
        hostNickname: state.nickname,
        acceptedPlayers: {
          [state.uid]: state.nickname
        },
        createdAt: serverTimestamp(),
        createdAtMs: now,
        proposalUpdatedAtMs: now
      });
    });

    closeModal();
  } catch (error) {
    console.error(error);
    const message =
      error.message === "MATCH_ALREADY_EXISTS"
        ? "이미 이 방에 대결 제안 또는 진행 중인 대결이 있습니다."
        : "대결을 제안하지 못했습니다.";

    openModal(`
      <h2>대결을 제안할 수 없습니다.</h2>
      <p class="subtext">${message}</p>
      <button id="proposal-error-confirm" class="primary-button" type="button">확인</button>
    `);
    $("#proposal-error-confirm").addEventListener("click", closeModal);
  }
}

async function toggleBattleAcceptance() {
  const match = state.match;
  if (
    !state.firebaseReady ||
    !state.channel ||
    state.mode !== "idle" ||
    match?.status !== "waiting" ||
    match.hostUid === state.uid
  ) {
    return;
  }

  const isCurrentlyAccepted = Boolean(match.acceptedPlayers?.[state.uid]);
  if (!isCurrentlyAccepted) {
    const blockingSession = await findBlockingSession({
      allowedRoundId: match.roundId
    });

    if (blockingSession) {
      showExistingSessionPrompt(blockingSession, {
        afterAbandon: toggleBattleAcceptance
      });
      return;
    }
  }

  const matchRef = doc(
    state.db,
    FIREBASE_COLLECTIONS.matches,
    state.channel.id
  );

  try {
    await runTransaction(state.db, async (transaction) => {
      const snapshot = await transaction.get(matchRef);
      if (!snapshot.exists()) return;

      const fresh = snapshot.data();
      if (
        fresh.status !== "waiting" ||
        fresh.roundId !== match.roundId
      ) {
        return;
      }

      const acceptedPlayers = { ...(fresh.acceptedPlayers || {}) };
      if (acceptedPlayers[state.uid]) {
        delete acceptedPlayers[state.uid];
      } else {
        acceptedPlayers[state.uid] = state.nickname;
      }

      transaction.update(matchRef, { acceptedPlayers });
    });
  } catch (error) {
    console.error(error);
    elements.roomStatusBanner.textContent =
      "참여 상태를 변경하지 못했습니다.";
    elements.roomStatusBanner.className = "status-banner alert";
  }
}

async function cancelBattleProposal() {
  const match = state.match;
  if (
    !state.firebaseReady ||
    !state.channel ||
    match?.status !== "waiting" ||
    match.hostUid !== state.uid
  ) {
    return;
  }

  if (!window.confirm("현재 대결 제안을 취소할까요?")) return;

  const matchRef = doc(
    state.db,
    FIREBASE_COLLECTIONS.matches,
    state.channel.id
  );

  try {
    await runTransaction(state.db, async (transaction) => {
      const snapshot = await transaction.get(matchRef);
      if (!snapshot.exists()) return;

      const fresh = snapshot.data();
      if (
        fresh.status === "waiting" &&
        fresh.roundId === match.roundId &&
        fresh.hostUid === state.uid
      ) {
        transaction.delete(matchRef);
      }
    });
  } catch (error) {
    console.error(error);
    elements.roomStatusBanner.textContent =
      "대결 제안을 취소하지 못했습니다.";
    elements.roomStatusBanner.className = "status-banner alert";
  }
}

async function startAcceptedBattle() {
  const proposal = state.match;
  if (
    !state.firebaseReady ||
    !state.channel ||
    proposal?.status !== "waiting" ||
    proposal.hostUid !== state.uid
  ) {
    return;
  }

  const activeAcceptedUsers = getActiveAcceptedUsers(proposal);
  if (activeAcceptedUsers.length < MIN_BATTLE_PLAYERS) {
    elements.roomStatusBanner.textContent =
      `현재 접속 중이며 참여한 학생이 ${MIN_BATTLE_PLAYERS}명 이상이어야 합니다.`;
    elements.roomStatusBanner.className = "status-banner alert";
    return;
  }

  const questions = Array.from(
    { length: 20 },
    () => createQuestion(state.channel)
  );
  const matchRef = doc(
    state.db,
    FIREBASE_COLLECTIONS.matches,
    state.channel.id
  );
  const battleStartTime = Date.now();

  try {
    await runTransaction(state.db, async (transaction) => {
      const snapshot = await transaction.get(matchRef);
      if (!snapshot.exists()) throw new Error("PROPOSAL_NOT_FOUND");

      const fresh = snapshot.data();
      if (
        fresh.status !== "waiting" ||
        fresh.roundId !== proposal.roundId ||
        fresh.hostUid !== state.uid
      ) {
        throw new Error("PROPOSAL_CHANGED");
      }

      const freshAcceptedPlayers = fresh.acceptedPlayers || {};
      const participants = activeAcceptedUsers
        .filter((user) => Boolean(freshAcceptedPlayers[user.uid]))
        .map((user) => ({
          uid: user.uid,
          nickname: freshAcceptedPlayers[user.uid] || user.nickname
        }));

      const participantIds = [...new Set(participants.map((user) => user.uid))];
      if (participantIds.length < MIN_BATTLE_PLAYERS) {
        throw new Error("NOT_ENOUGH_PARTICIPANTS");
      }

      const uniqueParticipants = participantIds.map((uid) =>
        participants.find((participant) => participant.uid === uid)
      );
      const scores = Object.fromEntries(
        participantIds.map((uid) => [uid, 0])
      );
      const eliminated = Object.fromEntries(
        participantIds.map((uid) => [uid, false])
      );
      const lastActivityAtMs = Object.fromEntries(
        participantIds.map((uid) => [uid, battleStartTime])
      );
      const hasSubmitted = Object.fromEntries(
        participantIds.map((uid) => [uid, false])
      );

      transaction.update(matchRef, {
        status: "playing",
        participants: uniqueParticipants,
        participantIds,
        scores,
        eliminated,
        eliminatedAtMs: {},
        lastActivityAtMs,
        hasSubmitted,
        exitReasons: {},
        startedAt: serverTimestamp(),
        startedAtMs: battleStartTime,
        questions,
        questionIndex: 0,
        questionWinnerUid: null,
        questionWinnerNickname: null,
        startsAtMs: battleStartTime + 4000,
        questionStartedAtMs: battleStartTime + 4000
      });
    });
  } catch (error) {
    console.error(error);
    const message =
      error.message === "NOT_ENOUGH_PARTICIPANTS"
        ? "대결을 시작하는 순간 참여자가 4명 미만이 되었습니다."
        : "대결 제안이 변경되었거나 시작할 수 없습니다.";

    openModal(`
      <h2>대결을 시작할 수 없습니다.</h2>
      <p class="subtext">${message}</p>
      <button id="start-error-confirm" class="primary-button" type="button">확인</button>
    `);
    $("#start-error-confirm").addEventListener("click", closeModal);
  }
}

function renderBattle() {
  const match = state.match;
  if (!match?.questions?.length) return;

  const question = match.questions[match.questionIndex];
  if (!question) return;

  elements.battleModeLabel.textContent =
    match.difficulty === "hard"
      ? "HARD · 오답 감점"
      : "EASY · 감점 없음";
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

    if (secondsLeft <= 0) {
      setTimeout(() => elements.battleAnswerInput.focus(), 40);
    }
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

  const matchRef = doc(
    state.db,
    FIREBASE_COLLECTIONS.matches,
    state.channel.id
  );

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
      const now = Date.now();
      const updates = {
        status: "finished",
        finishedAt: serverTimestamp(),
        finishedAtMs: now,
        finishedReason: "completed"
      };
      const participantIds = match.participantIds || [];
      const eliminated = match.eliminated || {};
      const hasSubmitted = match.hasSubmitted || {};

      participantIds.forEach((uid) => {
        if (!eliminated[uid] && !hasSubmitted[uid]) {
          updates[`eliminated.${uid}`] = true;
          updates[`eliminatedAtMs.${uid}`] = now;
          updates[`exitReasons.${uid}`] = "no-submission-by-finish";
        }
      });

      transaction.update(matchRef, updates);
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

async function recordInvalidSubmissionActivity(match) {
  const matchRef = doc(
    state.db,
    FIREBASE_COLLECTIONS.matches,
    state.channel.id
  );

  await runTransaction(state.db, async (transaction) => {
    const snapshot = await transaction.get(matchRef);
    if (!snapshot.exists()) return;

    const fresh = snapshot.data();
    if (
      fresh.roundId !== match.roundId ||
      fresh.status !== "playing" ||
      fresh.questionIndex !== match.questionIndex ||
      !fresh.participantIds?.includes(state.uid) ||
      fresh.eliminated?.[state.uid]
    ) {
      return;
    }

    transaction.update(matchRef, {
      [`lastActivityAtMs.${state.uid}`]: Date.now(),
      [`hasSubmitted.${state.uid}`]: true
    });
  });
}

async function submitBattleAnswer(event) {
  event.preventDefault();

  const match = state.match;
  if (
    !match ||
    match.status !== "playing" ||
    state.mode !== "battle" ||
    !state.channel
  ) {
    return;
  }

  if (Date.now() < match.startsAtMs || match.questionWinnerUid) return;

  const rawAnswer = elements.battleAnswerInput.value;
  if (!isHangulOnlyAnswer(rawAnswer)) {
    try {
      await recordInvalidSubmissionActivity(match);
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
  const matchRef = doc(
    state.db,
    FIREBASE_COLLECTIONS.matches,
    state.channel.id
  );

  try {
    const result = await runTransaction(state.db, async (transaction) => {
      const snapshot = await transaction.get(matchRef);
      if (!snapshot.exists()) return { type: "stale" };

      const fresh = snapshot.data();
      if (
        fresh.roundId !== match.roundId ||
        fresh.status !== "playing" ||
        fresh.questionIndex !== match.questionIndex ||
        !fresh.participantIds?.includes(state.uid) ||
        fresh.eliminated?.[state.uid]
      ) {
        return { type: "stale" };
      }

      const now = Date.now();
      const activityUpdates = {
        [`lastActivityAtMs.${state.uid}`]: now,
        [`hasSubmitted.${state.uid}`]: true
      };

      if (correct) {
        if (fresh.questionWinnerUid) {
          transaction.update(matchRef, activityUpdates);
          return { type: "late" };
        }

        const nextScore = (fresh.scores?.[state.uid] || 0) + 1;
        const playerNickname =
          fresh.participants?.find((participant) => participant.uid === state.uid)?.nickname ||
          state.nickname;

        transaction.update(matchRef, {
          ...activityUpdates,
          [`scores.${state.uid}`]: nextScore,
          questionWinnerUid: state.uid,
          questionWinnerNickname: playerNickname,
          answerReceivedAt: serverTimestamp(),
          answerReceivedAtMs: now
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

      const nextEliminated = {
        ...(fresh.eliminated || {}),
        [state.uid]: true
      };
      const activeCount = fresh.participantIds.filter(
        (uid) => !nextEliminated[uid]
      ).length;
      const updates = {
        ...activityUpdates,
        [`eliminated.${state.uid}`]: true,
        [`eliminatedAtMs.${state.uid}`]: now,
        [`exitReasons.${state.uid}`]: "hard-mistake"
      };

      if (activeCount === 0) {
        updates.status = "finished";
        updates.finishedAt = serverTimestamp();
        updates.finishedAtMs = now;
        updates.finishedReason = "all-players-eliminated";
      }

      transaction.update(matchRef, updates);
      return { type: "eliminated" };
    });

    elements.battleAnswerInput.value = "";

    if (result.type === "correct") {
      setFeedback(
        elements.battleFeedback,
        "정답! 가장 먼저 제출했습니다.",
        "success"
      );
    } else if (result.type === "late") {
      setFeedback(
        elements.battleFeedback,
        "정답이지만 다른 친구가 조금 더 빨랐습니다.",
        "error"
      );
    } else if (result.type === "wrong-easy") {
      setFeedback(
        elements.battleFeedback,
        "오답입니다. 다시 입력하세요.",
        "error"
      );
    } else if (result.type === "wrong-hard") {
      setFeedback(
        elements.battleFeedback,
        `오답으로 1점 감점되었습니다. 현재 ${result.score}점입니다.`,
        "error"
      );
    } else if (result.type === "eliminated") {
      setFeedback(
        elements.battleFeedback,
        "0점에서 다시 틀려 퇴장됩니다.",
        "error"
      );
    } else if (result.type === "stale") {
      setFeedback(
        elements.battleFeedback,
        "이미 다음 문제로 넘어갔거나 대결 상태가 바뀌었습니다.",
        "error"
      );
    }
  } catch (error) {
    console.error(error);
    setFeedback(
      elements.battleFeedback,
      "답을 처리하지 못했습니다. 다시 제출하세요.",
      "error"
    );
  }
}

function renderScores() {
  const match = state.match;
  if (!match?.participants) return;

  const sorted = [...match.participants].sort((first, second) => {
    const scoreDifference =
      (match.scores?.[second.uid] || 0) -
      (match.scores?.[first.uid] || 0);
    if (scoreDifference !== 0) return scoreDifference;
    return first.nickname.localeCompare(second.nickname, "ko");
  });

  elements.scoreList.innerHTML = sorted
    .map((participant) => {
      const eliminated = match.eliminated?.[participant.uid];
      const reason = match.exitReasons?.[participant.uid];
      const label = reason ? getExitReasonLabel(reason) : "";

      return `
        <li class="${eliminated ? "eliminated" : ""}">
          <span class="score-name">
            ${escapeHtml(participant.nickname)}
            ${label ? `<small>${escapeHtml(label)}</small>` : ""}
          </span>
          <span class="score-value">${match.scores?.[participant.uid] || 0}점</span>
        </li>
      `;
    })
    .join("");
}

function getExitReasonLabel(reason) {
  const labels = {
    "inactive-3-minutes": "3분 무입력 퇴장",
    "no-submission-by-finish": "미참여 종료",
    "hard-mistake": "Hard 탈락",
    "left-intentionally": "중도 퇴장",
    "abandoned-previous-match": "이전 대결 포기",
    "duplicate-session-cleanup": "중복 참여 정리"
  };

  return labels[reason] || "퇴장";
}

async function handleElimination(match) {
  state.handledEliminations.add(match.roundId);
  saveHandledSet(
    STORAGE_KEYS.handledEliminations,
    state.handledEliminations
  );

  const score = match.scores?.[state.uid] || 0;
  const reason = match.exitReasons?.[state.uid];
  const description =
    reason === "inactive-3-minutes"
      ? "3분 동안 답을 제출하지 않아 대결에서 자동 퇴장되었습니다."
      : reason === "hard-mistake"
        ? "0점인 상태에서 오답을 입력해 대결에서 퇴장되었습니다."
        : "대결에서 퇴장 처리되었습니다.";
  const eyebrow =
    reason === "inactive-3-minutes" ? "INACTIVITY" : "BATTLE EXIT";

  await clearRoomState({ closeCurrentModal: false });
  returnHistoryToChannels();

  openModal(
    `
      <p class="eyebrow">${eyebrow}</p>
      <h2>대결에서 퇴장되었습니다.</h2>
      <p class="subtext">${description}</p>
      <div class="notice-box">
        현재 점수: ${score}점<br>
        다시 참가하려면 단계별 방에 다시 입장하세요.
      </div>
      <button id="elimination-confirm" class="primary-button" type="button">
        방 선택으로 돌아가기
      </button>
    `,
    { closable: false }
  );

  $("#elimination-confirm").addEventListener("click", closeModal);
}

function buildResultItems(match) {
  const sorted = [...(match.participants || [])].sort((first, second) => {
    const scoreDifference =
      (match.scores?.[second.uid] || 0) -
      (match.scores?.[first.uid] || 0);
    if (scoreDifference !== 0) return scoreDifference;
    return first.nickname.localeCompare(second.nickname, "ko");
  });

  return sorted
    .map((participant, index) => {
      const reason = match.exitReasons?.[participant.uid];
      const statusText = reason ? ` · ${getExitReasonLabel(reason)}` : "";

      return `
        <li>
          <span>
            ${index + 1}위 · ${escapeHtml(participant.nickname)}${escapeHtml(statusText)}
          </span>
          <strong>${match.scores?.[participant.uid] || 0}점</strong>
        </li>
      `;
    })
    .join("");
}

function getFinishedRoundCopy(match) {
  switch (match.finishedReason) {
    case "all-players-inactive":
      return {
        title: "대결이 자동 종료되었습니다.",
        description: "모든 참가자가 3분 동안 답을 제출하지 않아 대결이 종료되었습니다."
      };
    case "all-players-eliminated":
      return {
        title: "모든 참가자가 탈락했습니다.",
        description: "Hard 모드에서 활동 중인 참가자가 모두 탈락하여 대결이 종료되었습니다."
      };
    case "all-players-left":
      return {
        title: "대결이 종료되었습니다.",
        description: "활동 중인 참가자가 모두 방을 나가 대결이 종료되었습니다."
      };
    default:
      return {
        title: "20문제 대결이 끝났습니다.",
        description: "대결 결과를 확인하세요."
      };
  }
}

async function handleFinishedRound(match) {
  state.handledRoundIds.add(match.roundId);
  saveHandledSet(STORAGE_KEYS.handledRounds, state.handledRoundIds);

  const resultItems = buildResultItems(match);
  const copy = getFinishedRoundCopy(match);

  await clearRoomState({ closeCurrentModal: false });
  returnHistoryToChannels();

  openModal(
    `
      <p class="eyebrow">ROUND FINISHED</p>
      <h2>${copy.title}</h2>
      <p class="subtext">${copy.description}</p>
      <ol class="result-list">${resultItems}</ol>
      <button id="result-confirm" class="primary-button" type="button">
        방 선택으로 돌아가기
      </button>
    `,
    { closable: false }
  );

  $("#result-confirm").addEventListener("click", closeModal);
}

async function handleNicknameSubmit(event) {
  event.preventDefault();
  const nickname = sanitizeNickname(elements.nicknameInput.value);

  if (!nickname) {
    elements.nicknameInput.setCustomValidity("닉네임을 입력하세요.");
    elements.nicknameInput.reportValidity();
    return;
  }

  elements.nicknameInput.setCustomValidity("");
  saveNickname(nickname);

  if (state.firebaseReady) {
    const sessions = await getNormalizedActiveSessions();
    if (sessions.length) {
      const session = sessions[0];
      const oldNickname = getSessionNickname(session);

      if (oldNickname === nickname) {
        await enterRoom(session.channelId, {
          skipSessionCheck: true,
          replaceExistingRoom: false
        });
      } else {
        showScreen("channels");
        showExistingSessionPrompt(session);
      }
      return;
    }
  }

  showScreen("channels");
}

elements.nicknameForm.addEventListener("submit", (event) => {
  handleNicknameSubmit(event).catch(console.error);
});

elements.nicknameInput.addEventListener("input", () => {
  elements.nicknameInput.setCustomValidity("");
});

elements.changeNicknameButton.addEventListener("click", () => {
  sessionStorage.removeItem(STORAGE_KEYS.nickname);
  state.nickname = "";
  elements.nicknameInput.value = "";
  showScreen("nickname");
  elements.nicknameInput.focus();
});

elements.leaveRoomButton.addEventListener("click", () => {
  requestIntentionalRoomExit().catch(console.error);
});

elements.battleExitButton.addEventListener("click", () => {
  requestIntentionalRoomExit().catch(console.error);
});

elements.soloButton.addEventListener("click", startSolo);
elements.battleButton.addEventListener("click", showDifficultyModal);
elements.acceptBattleButton.addEventListener("click", () => {
  toggleBattleAcceptance().catch(console.error);
});
elements.startBattleButton.addEventListener("click", () => {
  startAcceptedBattle().catch(console.error);
});
elements.cancelBattleButton.addEventListener("click", () => {
  cancelBattleProposal().catch(console.error);
});
elements.openBattleInviteButton.addEventListener("click", () => {
  openBattleInviteFromSolo().catch(console.error);
});
elements.soloAnswerForm.addEventListener("submit", submitSoloAnswer);
elements.stopSoloButton.addEventListener("click", () => {
  stopSolo().catch(console.error);
});
elements.battleAnswerForm.addEventListener("submit", (event) => {
  submitBattleAnswer(event).catch(console.error);
});
elements.modalCloseButton.addEventListener("click", closeModal);
elements.modalBackdrop.addEventListener("click", (event) => {
  if (
    event.target === elements.modalBackdrop &&
    !elements.modalCloseButton.classList.contains("hidden")
  ) {
    closeModal();
  }
});

window.addEventListener("popstate", async () => {
  if (state.suppressNextPopstate) {
    state.suppressNextPopstate = false;
    return;
  }

  if (!state.channel || state.exitInProgress) return;

  const channelId = state.channel.id;
  history.pushState({ screen: "room", channelId }, "", location.href);

  const leftRoom = await requestIntentionalRoomExit({
    navigateHistory: false
  });

  if (leftRoom) {
    returnHistoryToChannels();
  }
});

window.addEventListener("pageshow", () => {
  if (state.channel && state.firebaseReady) {
    heartbeatOnce().catch(console.warn);
  }
});

document.addEventListener("visibilitychange", () => {
  if (
    document.visibilityState === "visible" &&
    state.channel &&
    state.firebaseReady
  ) {
    heartbeatOnce().catch(console.warn);
    cleanupStaleMatch().catch(console.warn);
  }
});

history.replaceState({ screen: "channels" }, "", location.href);
renderChannels();
loadNickname();
initializeFirebase().catch(console.error);
