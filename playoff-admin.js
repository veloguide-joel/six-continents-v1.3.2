"use strict";

(() => {
  const DEFAULT_EVENT_ID = "591ec441-e182-46b5-82d5-345c7d9c82c0";
  const REQUIRED_API_METHODS = ["getSession", "getHostState", "sendHostMessage", "getHostMessages", "clearHostMessages", "configureQuestions", "recoverEvent", "resetToWaiting"];
  const ACTIONS_BY_STATUS = {
    draft: ["start_waiting"],
    waiting_for_players: ["open_round_1", "pause"],
    question_1_open: ["pause"],
    question_1_complete: ["open_round_2", "pause"],
    question_2_open: ["pause"],
    question_2_complete: ["open_round_3", "pause"],
    question_3_open: ["pause"],
    paused: ["resume"]
  };
  const ACTION_LABELS = {
    start_waiting: "Start Waiting Room",
    open_round_1: "Begin Round 1",
    open_round_2: "Begin Round 2",
    open_round_3: "Begin Final Round",
    complete_round_1: "Complete Round 1",
    complete_round_2: "Complete Round 2",
    confirm_winner: "Confirm Winner",
    rollback_one_round: "Roll Back One Round",
    pause: "Pause Event",
    resume: "Resume Event"
  };
  const ACTION_CONFIRM_MESSAGES = {
    start_waiting: "Start the waiting room?",
    open_round_1: "Begin Round 1?",
    open_round_2: "Begin Round 2?",
    open_round_3: "Begin Final Round?",
    complete_round_1: "Complete Round 1 early?",
    complete_round_2: "Complete Round 2 early?",
    confirm_winner: "Confirm this provisional winner?",
    pause: "Pause the live event?",
    resume: "Resume the live event?"
  };
  // Destructive recovery confirmation phrases must always be shown verbatim to the operator in the prompt. Never require a hidden or memorized safety word.
  const FULL_RESET_CONFIRMATION = "RESET PLAYOFF";
  const GAME_RESET_CONFIRMATION = "RESET GAME";
  const root = document.getElementById("playoff-admin-app");

  if (!root) {
    console.error("Playoff admin root element missing.");
    return;
  }

  const api = window.PlayoffAPI;
  if (!api || typeof api !== "object") {
    renderShell("playoff-status--error", "Playoff host boundary unavailable.");
    console.error("Playoff host boundary unavailable.");
    return;
  }

  for (const methodName of REQUIRED_API_METHODS) {
    if (typeof api[methodName] !== "function") {
      renderShell(
        "playoff-status--error",
        "Playoff host boundary unavailable.",
        "",
        "Required host methods are missing."
      );
      console.error("Playoff host boundary missing method:", methodName);
      return;
    }
  }

  const state = {
    loading: true,
    actionLoading: false,
    pollInFlight: false,
    pollTimerId: null,
    pollSuspended: false,
    hostFeedPollCount: 0,
    hostFeed: {
      pinned: null,
      messages: [],
      loading: false,
      loaded: false,
      error: null,
      sending: false,
      clearing: false,
      draft: "",
      feedback: "",
      feedbackType: ""
    },
    status: "loading",
    message: "Checking your session...",
    session: null,
    hostData: null,
    refreshNotice: "",
    actionNotice: "",
    actionNoticeType: "",
    lastHostStateKey: "",
    lastRenderedHostStateKey: "",
    lastUpdatedLabel: "",
    lastAutoCompletedAction: "",
    lastAutoCompletedStatus: "",
    lastVisibleRoundComplete: null,
    authSubmitting: false,
    authError: "",
    authEmail: "",
    eventTargetId: DEFAULT_EVENT_ID,
    eventTargetMode: "production",
    eventTargetValid: true,
    eventTargetError: "",
    setupSaveLoading: false,
    setupFeedback: "",
    setupFeedbackType: "",
    setupDirty: false,
    setupForm: {
      q1Limit: "",
      q2Limit: ""
    },
    recoveryLoading: false,
    recoveryAction: "",
    recoveryFeedback: "",
    recoveryFeedbackType: ""
  };

  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.id === "playoff-admin-refresh") {
      if (state.actionLoading) return;
      void refreshHostState();
      return;
    }

    if (target.id === "playoff-host-message-send" || target.id === "playoff-host-message-send-important") {
      event.preventDefault();
      void handleHostMessageSend(target.id === "playoff-host-message-send-important");
      return;
    }

    if (target.id === "playoff-host-message-clear") {
      event.preventDefault();
      void handleHostMessagesClear();
      return;
    }

    if (target.id === "playoff-recovery-full-reset") {
      event.preventDefault();
      void handleRecoveryAction("full_reset");
      return;
    }

    if (target.id === "playoff-recovery-restart-current-round") {
      event.preventDefault();
      void handleRecoveryAction("restart_current_round");
      return;
    }

    if (target.id === "playoff-recovery-rollback-one-round") {
      event.preventDefault();
      void handleRecoveryAction("rollback_one_round");
      return;
    }

    if (target.id === "playoff-recovery-reset-to-waiting") {
      event.preventDefault();
      void handleRecoveryAction("reset_to_waiting");
      return;
    }

    if (target.closest("[data-setup-form]")) return;

    if (target.dataset.hostAction) {
      void executeHostAction(target.dataset.hostAction);
    }
  });

  root.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement) || target.id !== "playoff-host-message-draft") return;
    state.hostFeed.draft = target.value;
    const counter = document.getElementById("playoff-host-message-counter");
    if (counter) counter.textContent = `${target.value.length} / 500`;
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopPolling();
      return;
    }

    if (state.session?.user && !state.actionLoading && state.status === "ready") {
      state.pollSuspended = false;
      void refreshHostState({ fromPoll: true, force: true });
    }
  });

  window.addEventListener("beforeunload", () => {
    stopPolling();
  });

  function getSupabaseClient() {
    if (window.supabaseClient && typeof window.supabaseClient === "object") {
      return window.supabaseClient;
    }

    if (window.__supabaseClient && typeof window.__supabaseClient === "object") {
      window.supabaseClient = window.__supabaseClient;
      return window.__supabaseClient;
    }

    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("Supabase browser client unavailable");
    }

    if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
      throw new Error("Supabase configuration unavailable");
    }

    const client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    window.__supabaseClient = client;
    window.supabaseClient = client;
    return client;
  }

  function renderShell(statusClass, statusText, emailText = "", detailText = "") {
    root.innerHTML = `
      <main class="playoff-shell" aria-label="Live Playoff host console shell">
        <div class="playoff-brand">The Accidental Retiree</div>
        <h1>Live Playoff Host Console</h1>
        ${emailText ? `<p class="playoff-email">${emailText}</p>` : ""}
        <p class="playoff-status ${statusClass}">${statusText}</p>
        ${detailText ? `<p class="playoff-status-detail">${detailText}</p>` : ""}
        <div class="playoff-badge">DEVELOPMENT SHELL</div>
      </main>
    `;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDateTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString();
  }

  function formatRound(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
      return "No active round";
    }
    return `Round ${number}`;
  }

  function normalizeStatus(value, fallback = "unknown") {
    const text = String(value || "").trim();
    return text || fallback;
  }

  function isValidUuid(value) {
    return typeof value === "string"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
  }

  function resolveEventTarget() {
    const url = new URL(window.location.href);
    const hasEventParam = url.searchParams.has("event");

    if (!hasEventParam) {
      return {
        eventId: DEFAULT_EVENT_ID,
        mode: "production",
        valid: true,
        error: ""
      };
    }

    const rawValue = String(url.searchParams.get("event") || "").trim();
    if (!rawValue) {
      return {
        eventId: null,
        mode: "invalid",
        valid: false,
        error: "The supplied event ID is invalid. Provide a valid UUID or omit the event parameter to use the production event."
      };
    }

    if (!isValidUuid(rawValue)) {
      return {
        eventId: null,
        mode: "invalid",
        valid: false,
        error: "The supplied event ID is invalid. Provide a valid UUID or omit the event parameter to use the production event."
      };
    }

    if (rawValue.toLowerCase() === DEFAULT_EVENT_ID.toLowerCase()) {
      return {
        eventId: DEFAULT_EVENT_ID,
        mode: "production",
        valid: true,
        error: ""
      };
    }

    return {
      eventId: rawValue,
      mode: "override",
      valid: true,
      error: ""
    };
  }

  function getEventTargetSummary() {
    if (state.eventTargetMode === "override") {
      return {
        label: "TEST / OVERRIDE EVENT",
        detail: state.eventTargetId || ""
      };
    }

    if (state.eventTargetMode === "invalid") {
      return {
        label: "INVALID EVENT TARGET",
        detail: state.eventTargetError || "The supplied event ID is invalid."
      };
    }

    return {
      label: "PRODUCTION EVENT",
      detail: DEFAULT_EVENT_ID
    };
  }

  function getActiveEventId() {
    if (!state.eventTargetValid || !state.eventTargetId) {
      throw new Error(state.eventTargetError || "No valid event target is available.");
    }
    return state.eventTargetId;
  }

  function getQuestionConfig(hostData, questionNumber) {
    const questions = Array.isArray(hostData?.questions) ? hostData.questions : [];
    const normalizedNumber = Number(questionNumber || 0);
    const fallback = normalizedNumber === 1
      ? { advancement_mode: "all_correct", advance_limit: null }
      : normalizedNumber === 2
        ? { advancement_mode: "first_n", advance_limit: 2 }
        : normalizedNumber === 3
          ? { advancement_mode: "first_n", advance_limit: 1 }
          : { advancement_mode: "all_correct", advance_limit: null };

    const question = questions.find((entry) => Number(entry?.question_number || 0) === normalizedNumber);
    const rawMode = String(question?.advancement_mode || "").trim().toLowerCase();
    const effectiveMode = rawMode === "first_n" ? "first_n" : rawMode === "all_correct" ? "all_correct" : fallback.advancement_mode;
    const parsedLimit = Number(question?.advance_limit ?? question?.advanceLimit);
    const fallbackLimit = effectiveMode === "first_n" ? fallback.advance_limit : null;
    const effectiveLimit = effectiveMode === "first_n"
      ? (Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : fallbackLimit)
      : null;

    return {
      advancement_mode: effectiveMode,
      advance_limit: effectiveMode === "first_n" ? effectiveLimit : null
    };
  }

  function normalizeSetupMode(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return normalized === "first_n" ? "first_n" : "all_correct";
  }

  function isSetupFormActive() {
    const active = document.activeElement;
    return Boolean(active && active.closest?.("[data-setup-form]"));
  }

  function formatSetupModeLabel(mode) {
    return normalizeSetupMode(mode) === "first_n" ? "First N" : "All Correct";
  }

  function getJoinedParticipantCount(hostData) {
    const participants = Array.isArray(hostData?.participants) ? hostData.participants : [];
    return participants.filter((participant) => Boolean(participant?.joined)).length;
  }

  function isEventSetupEditable() {
    const statusKey = normalizeStatus(state.hostData?.event?.status, "").toLowerCase();
    return statusKey === "draft" || statusKey === "waiting_for_players";
  }

  function updateSetupLimitControl(roundNumber, limitValue) {
    const inputId = roundNumber === 2 ? "playoff-setup-q2-limit" : "playoff-setup-q1-limit";
    const input = document.getElementById(inputId);
    if (!input) return;

    const isEditable = isEventSetupEditable();
    input.disabled = !isEditable;

    if (!isEditable) {
      return;
    }

    const nextValue = String(limitValue ?? "").trim();
    input.value = nextValue;
  }

  function syncSetupFormFromHostData(hostData, { force = false } = {}) {
    if (!force && (state.setupSaveLoading || state.setupDirty)) return;

    const q1Config = getQuestionConfig(hostData, 1);
    const q2Config = getQuestionConfig(hostData, 2);
    state.setupForm = {
      q1Limit: q1Config?.advancement_mode === "first_n" && Number.isFinite(Number(q1Config?.advance_limit)) && Number(q1Config.advance_limit) > 0
        ? String(q1Config.advance_limit)
        : "",
      q2Limit: q2Config?.advancement_mode === "first_n" && Number.isFinite(Number(q2Config?.advance_limit)) && Number(q2Config.advance_limit) > 0
        ? String(q2Config.advance_limit)
        : ""
    };

    if (!state.setupSaveLoading) {
      updateSetupLimitControl(1, state.setupForm.q1Limit);
      updateSetupLimitControl(2, state.setupForm.q2Limit);
    }
  }

  function getSetupConfigFromForm() {
    const q1LimitRaw = String(state.setupForm.q1Limit || "").trim();
    const q2LimitRaw = String(state.setupForm.q2Limit || "").trim();
    const q1Limit = Number(q1LimitRaw);
    const q2Limit = Number(q2LimitRaw);

    return {
      q1Mode: "first_n",
      q1Limit: Number.isInteger(q1Limit) && q1Limit > 0 ? q1Limit : null,
      q2Mode: "first_n",
      q2Limit: Number.isInteger(q2Limit) && q2Limit > 0 ? q2Limit : null
    };
  }

  function validateSetupForm() {
    const config = getSetupConfigFromForm();
    if (config.q1Limit === null) {
      return "Round 1 requires a positive player limit.";
    }

    if (config.q2Limit === null) {
      return "Round 2 requires a positive player limit.";
    }

    return "";
  }

  function getSetupWarningMessage(hostData) {
    const config = getSetupConfigFromForm();
    const joinedCount = getJoinedParticipantCount(hostData);
    const warnings = [];

    if (config.q1Limit !== null && config.q1Limit > joinedCount) {
      warnings.push("Round 1 limit is greater than the number of players currently joined.");
    }

    if (config.q2Limit !== null && config.q2Limit > joinedCount) {
      warnings.push("Round 2 limit is greater than the number of players currently joined.");
    }

    return warnings[0] || "";
  }

  function getSetupConfirmationMessage(config) {
    return [
      "Save playoff event setup?",
      "",
      `Round 1: First ${config.q1Limit} advance`,
      `Round 2: First ${config.q2Limit} advance`,
      "Round 3: First correct finalist wins",
      "",
      "These settings will lock once the event begins."
    ].join("\n");
  }

  function getUniqueCorrectParticipantIds(submissions, questionNumber) {
    const targetQuestionNumber = Number(questionNumber || 0);
    return new Set(
      (Array.isArray(submissions) ? submissions : [])
        .filter((submission) => Number(submission?.question_number || 0) === targetQuestionNumber && submission?.is_correct === true)
        .map((submission) => String(submission?.participant_id || "").trim())
        .filter(Boolean)
    );
  }

  function getUniqueAcceptedCorrectParticipantIds(submissions, questionNumber) {
    const targetQuestionNumber = Number(questionNumber || 0);
    return new Set(
      (Array.isArray(submissions) ? submissions : [])
        .filter((submission) => Number(submission?.question_number || 0) === targetQuestionNumber)
        .filter((submission) => submission?.is_correct === true)
        .filter((submission) => {
          const position = Number(submission?.accepted_position);
          return Number.isFinite(position) && position > 0;
        })
        .map((submission) => String(submission?.participant_id || "").trim())
        .filter(Boolean)
    );
  }

  function getFinalistParticipantCount(participants) {
    return (Array.isArray(participants) ? participants : [])
      .filter((participant) => {
        const status = normalizeStatus(participant?.current_status, "").toLowerCase();
        const isEliminated = Boolean(participant?.eliminated_at) || status.includes("eliminated") || status.includes("out");
        return participant?.is_finalist === true && !isEliminated;
      })
      .length;
  }

  function getParticipantPresence(participant, serverTime) {
    const lastSeenAt = participant?.last_seen_at;
    const serverTimeValue = serverTime ?? null;
    const lastSeenMs = lastSeenAt ? new Date(lastSeenAt).getTime() : null;
    const serverMs = serverTimeValue ? new Date(serverTimeValue).getTime() : null;

    if (!lastSeenAt || !Number.isFinite(lastSeenMs) || !Number.isFinite(serverMs)) {
      return "OFFLINE";
    }

    const ageMs = serverMs - lastSeenMs;
    return ageMs <= 90000 ? "ONLINE" : "OFFLINE";
  }

  function statusBadgeClass(rawStatus) {
    const value = normalizeStatus(rawStatus).toLowerCase();
    if (value.includes("paused")) return "playoff-pill playoff-pill--warning";
    if (value.includes("complete") || value.includes("closed") || value.includes("archived")) return "playoff-pill playoff-pill--muted";
    if (value.includes("active") || value.includes("open") || value.includes("ready") || value.includes("joined")) return "playoff-pill playoff-pill--ok";
    if (value.includes("eliminated") || value.includes("not")) return "playoff-pill playoff-pill--danger";
    return "playoff-pill";
  }

  function buildHostStateKey(hostData) {
    const event = hostData?.event || {};
    const participants = Array.isArray(hostData?.participants) ? hostData.participants : [];
    const questions = Array.isArray(hostData?.questions) ? hostData.questions : [];
    const submissions = Array.isArray(hostData?.submissions) ? hostData.submissions : [];
    const counts = hostData?.counts || {};

    return JSON.stringify({
      eventStatus: event.status || "",
      activeQuestionNumber: Number(event.active_question_number || 0),
      winnerParticipantId: event.winner_participant_id || "",
      winnerSelectionType: event.winner_selection_type || "",
      updatedAt: event.updated_at || "",
      counts,
      participants: participants.map((participant) => [participant.display_name || "", participant.current_status || "", Boolean(participant.joined), Boolean(participant.is_finalist), Boolean(participant.is_winner)].join("|")),
      questions: questions.map((question) => [question.question_number || "", question.is_open ? 1 : 0, question.is_active ? 1 : 0, question.opened_at || "", question.closed_at || ""].join("|")),
      submissions: submissions.map((submission) => [submission.id || "", submission.question_number || "", submission.submitted_at || "", submission.is_correct ? 1 : 0].join("|"))
    });
  }

  function formatLiveTimestamp(value = new Date()) {
    try {
      return new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(value);
    } catch {
      return new Date(value).toLocaleTimeString();
    }
  }

  function formatHostMessageTime(value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "";
    return new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).format(parsed);
  }

  function renderHostFeedMessage(message, { pinned = false } = {}) {
    const time = formatHostMessageTime(message?.created_at);
    const importantClass = message?.is_important ? " playoff-host-feed-message--important" : "";
    return `
      <article class="playoff-host-feed-message${importantClass}${pinned ? " playoff-host-feed-message--pinned" : ""}" data-host-message-id="${escapeHtml(message?.id || "")}">
        ${pinned ? '<p class="playoff-host-feed-pin-label">📌 IMPORTANT</p>' : `<p class="playoff-host-feed-meta">${time ? `${escapeHtml(time)} — ` : ""}HOST${message?.is_important ? " · IMPORTANT" : ""}</p>`}
        <p class="playoff-host-feed-text">${escapeHtml(message?.message || "")}</p>
      </article>
    `;
  }

  function renderHostFeedHistoryMarkup() {
    const pinned = state.hostFeed.pinned;
    const messages = state.hostFeed.messages
      .filter((message) => !pinned || message?.id !== pinned.id)
      .reverse();
    const statusMarkup = state.hostFeed.error
      ? '<p class="playoff-host-feed-status">Feed temporarily unavailable. Retrying...</p>'
      : state.hostFeed.loading && !pinned && messages.length === 0
        ? '<p class="playoff-host-feed-status">Loading host messages...</p>'
        : !pinned && messages.length === 0
          ? '<p class="playoff-host-feed-status">No host messages yet.</p>'
          : "";

    return `
      ${pinned ? renderHostFeedMessage(pinned, { pinned: true }) : ""}
      <div class="playoff-host-feed-history">
        ${messages.map((message) => renderHostFeedMessage(message)).join("")}
      </div>
      ${statusMarkup}
    `;
  }

  function updateHostFeedHistoryDom() {
    const history = document.getElementById("playoff-admin-host-feed-history");
    if (!history) return;
    const scrollState = captureHostFeedScrollState();
    history.innerHTML = renderHostFeedHistoryMarkup();
    restoreHostFeedScrollState(scrollState);
  }

  function captureHostFeedScrollState() {
    const history = document.querySelector("#playoff-admin-host-feed-history .playoff-host-feed-history");
    if (!history) return { nearTop: true, anchorId: "", anchorOffset: 0, previousScrollTop: 0 };

    const rows = Array.from(history.querySelectorAll("[data-host-message-id]"));
    const anchor = rows.find((row) => row.offsetTop + row.offsetHeight > history.scrollTop) || null;
    return {
      nearTop: history.scrollTop <= 8,
      anchorId: anchor?.getAttribute("data-host-message-id") || "",
      anchorOffset: anchor ? anchor.offsetTop - history.scrollTop : 0,
      previousScrollTop: history.scrollTop
    };
  }

  function restoreHostFeedScrollState(scrollState) {
    const history = document.querySelector("#playoff-admin-host-feed-history .playoff-host-feed-history");
    if (!history) return;
    if (!scrollState || scrollState.nearTop) {
      history.scrollTop = 0;
      return;
    }

    const anchor = Array.from(history.querySelectorAll("[data-host-message-id]"))
      .find((row) => row.getAttribute("data-host-message-id") === scrollState.anchorId);
    const targetScrollTop = anchor
      ? anchor.offsetTop - scrollState.anchorOffset
      : scrollState.previousScrollTop;
    const maxScrollTop = Math.max(0, history.scrollHeight - history.clientHeight);
    history.scrollTop = Math.min(Math.max(0, targetScrollTop), maxScrollTop);
  }

  function updateHostMessageComposerDom() {
    const textarea = document.getElementById("playoff-host-message-draft");
    const counter = document.getElementById("playoff-host-message-counter");
    const feedback = document.getElementById("playoff-host-message-feedback");
    const clearButton = document.getElementById("playoff-host-message-clear");
    const sendButton = document.getElementById("playoff-host-message-send");
    const importantButton = document.getElementById("playoff-host-message-send-important");

    if (textarea instanceof HTMLTextAreaElement && textarea.value !== state.hostFeed.draft) textarea.value = state.hostFeed.draft;
    if (counter) counter.textContent = `${state.hostFeed.draft.length} / 500`;
    if (feedback) {
      feedback.textContent = state.hostFeed.feedback;
      feedback.className = `playoff-host-message-feedback${state.hostFeed.feedbackType ? ` playoff-host-message-feedback--${state.hostFeed.feedbackType}` : ""}`;
    }
    const feedActionBusy = state.hostFeed.sending || state.hostFeed.clearing;
    if (clearButton instanceof HTMLButtonElement) clearButton.disabled = feedActionBusy;
    if (sendButton instanceof HTMLButtonElement) sendButton.disabled = feedActionBusy;
    if (importantButton instanceof HTMLButtonElement) importantButton.disabled = feedActionBusy;
  }

  async function refreshHostFeed() {
    if (state.hostFeed.loading || !state.session?.user || !state.eventTargetValid) return;

    state.hostFeed.loading = true;
    updateHostFeedHistoryDom();
    try {
      const payload = await api.getHostMessages(getActiveEventId(), 20);
      state.hostFeed.pinned = payload?.pinned || null;
      state.hostFeed.messages = Array.isArray(payload?.messages) ? payload.messages : [];
      state.hostFeed.error = null;
      state.hostFeed.loaded = true;
    } catch (error) {
      state.hostFeed.error = sanitizeErrorMessage(error);
      console.warn("Host feed refresh failed:", error?.message || error);
    } finally {
      state.hostFeed.loading = false;
      updateHostFeedHistoryDom();
    }
  }

  async function handleHostMessageSend(isImportant) {
    if (state.hostFeed.sending || state.hostFeed.clearing || !state.hostData) return;

    const message = state.hostFeed.draft.trim();
    if (!message || message.length > 500) {
      state.hostFeed.feedback = !message ? "Enter a message before sending." : "Message must be 500 characters or fewer.";
      state.hostFeed.feedbackType = "error";
      updateHostMessageComposerDom();
      return;
    }

    state.hostFeed.sending = true;
    state.hostFeed.feedback = isImportant ? "Sending Important message..." : "Sending message...";
    state.hostFeed.feedbackType = "";
    updateHostMessageComposerDom();

    try {
      await api.sendHostMessage(getActiveEventId(), message, isImportant);
      state.hostFeed.draft = "";
      state.hostFeed.feedback = isImportant ? "Important message sent and pinned." : "Message sent.";
      state.hostFeed.feedbackType = "success";
      await refreshHostFeed();
    } catch (error) {
      state.hostFeed.feedback = sanitizeErrorMessage(error);
      state.hostFeed.feedbackType = "error";
      console.warn("Host message send failed:", error?.message || error);
    } finally {
      state.hostFeed.sending = false;
      updateHostMessageComposerDom();
    }
  }

  async function handleHostMessagesClear() {
    if (state.hostFeed.clearing || state.hostFeed.sending || !state.hostData) return;

    const confirmed = window.confirm([
      "Clear the entire host message feed for this event?",
      "",
      "This will permanently remove all normal and Important messages, including the pinned Important message.",
      "",
      "This cannot be undone."
    ].join("\n"));
    if (!confirmed) return;

    state.hostFeed.clearing = true;
    state.hostFeed.feedback = "Clearing host message feed...";
    state.hostFeed.feedbackType = "";
    updateHostMessageComposerDom();

    try {
      await api.clearHostMessages(getActiveEventId());
      state.hostFeed.feedback = "Host message feed cleared.";
      state.hostFeed.feedbackType = "success";
      await refreshHostFeed();
    } catch (error) {
      state.hostFeed.feedback = sanitizeErrorMessage(error);
      state.hostFeed.feedbackType = "error";
      console.warn("Host message feed clear failed:", error?.message || error);
    } finally {
      state.hostFeed.clearing = false;
      updateHostMessageComposerDom();
    }
  }

  function scheduleNextPoll() {
    clearPollTimer();
    if (state.pollSuspended || state.actionLoading || state.loading || !state.session?.user || state.status !== "ready") {
      return;
    }

    state.pollTimerId = window.setTimeout(() => {
      void refreshHostState({ fromPoll: true });
    }, 2500);
  }

  function clearPollTimer() {
    if (state.pollTimerId) {
      window.clearTimeout(state.pollTimerId);
      state.pollTimerId = null;
    }
  }

  function stopPolling() {
    state.pollSuspended = true;
    clearPollTimer();
  }

  function startPolling() {
    state.pollSuspended = false;
    scheduleNextPoll();
  }

  function updateHostStateFromPayload(payload, { force = false } = {}) {
    if (!payload || payload.ok !== true) {
      throw new Error("Host state response was not successful.");
    }

    const nextKey = buildHostStateKey(payload);
    const changed = force || nextKey !== state.lastHostStateKey;
    state.hostData = payload;
    state.lastHostStateKey = nextKey;
    state.status = "ready";
    state.message = "Host state loaded.";
    state.lastUpdatedLabel = formatLiveTimestamp();

    return changed;
  }

  function renderView() {
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    renderCurrentView();
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => window.scrollTo(scrollX, scrollY));
    } else {
      window.scrollTo(scrollX, scrollY);
    }
  }

  function captureAdminListScrollState(listSelector, cardSelector, keyAttribute) {
    const list = document.querySelector(listSelector);
    if (!list) return { anchorId: "", anchorOffset: 0, nearTop: true, previousScrollTop: 0 };

    const cards = Array.from(list.querySelectorAll(cardSelector));
    const anchor = cards.find((card) => card.offsetTop + card.offsetHeight > list.scrollTop) || null;
    return {
      anchorId: anchor?.getAttribute(keyAttribute) || "",
      anchorOffset: anchor ? anchor.offsetTop - list.scrollTop : 0,
      nearTop: list.scrollTop <= 8,
      previousScrollTop: list.scrollTop
    };
  }

  function restoreAdminListScrollState(scrollState, listSelector, cardSelector, keyAttribute) {
    const list = document.querySelector(listSelector);
    if (!list) return;

    const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
    if (!scrollState || scrollState.nearTop) {
      list.scrollTop = 0;
      return;
    }

    if (scrollState.anchorId) {
      const anchorCard = Array.from(list.querySelectorAll(cardSelector))
        .find((card) => card.getAttribute(keyAttribute) === scrollState.anchorId);
      if (anchorCard) {
        list.scrollTop = Math.min(Math.max(0, anchorCard.offsetTop - scrollState.anchorOffset), maxScrollTop);
        return;
      }
    }

    list.scrollTop = Math.min(Math.max(0, scrollState.previousScrollTop), maxScrollTop);
  }

  function captureSubmissionScrollState() {
    return captureAdminListScrollState(
      ".playoff-submissions-list",
      "[data-submission-id]",
      "data-submission-id"
    );
  }

  function restoreSubmissionScrollState(scrollState) {
    restoreAdminListScrollState(
      scrollState,
      ".playoff-submissions-list",
      "[data-submission-id]",
      "data-submission-id"
    );
  }

  function captureParticipantScrollState() {
    return captureAdminListScrollState(
      ".playoff-participants-list",
      "[data-participant-id]",
      "data-participant-id"
    );
  }

  function restoreParticipantScrollState(scrollState) {
    restoreAdminListScrollState(
      scrollState,
      ".playoff-participants-list",
      "[data-participant-id]",
      "data-participant-id"
    );
  }

  function controlButtonClass(action) {
    if (action === "pause") return "playoff-action-btn playoff-action-btn--pause";
    if (action === "resume") return "playoff-action-btn playoff-action-btn--resume";
    return "playoff-action-btn playoff-action-btn--primary";
  }

  function getRestartRoundForStatus(eventStatus) {
    const statusKey = normalizeStatus(eventStatus, "").toLowerCase();
    if (statusKey === "question_1_open") return 1;
    if (statusKey === "question_2_open") return 2;
    if (statusKey === "question_3_open" || statusKey === "winner_locked") return 3;
    return null;
  }

  function getProvisionalWinnerDetails(hostData) {
    const event = hostData?.event || {};
    const participants = Array.isArray(hostData?.participants) ? hostData.participants : [];
    const eventStatus = normalizeStatus(event.status, "").toLowerCase();
    if (eventStatus !== "winner_locked") {
      return null;
    }

    const winnerParticipantId = String(event?.winner_participant_id || "").trim();
    if (!winnerParticipantId) {
      return null;
    }

    const hasOfficialWinner = participants.some((participant) => Boolean(participant?.is_winner));
    if (hasOfficialWinner) {
      return null;
    }

    const winnerParticipant = participants.find((participant) => String(participant.id || "").trim() === winnerParticipantId) || null;
    return { winnerParticipantId, winnerParticipant };
  }

  function getConfirmedWinnerDetails(hostData) {
    const event = hostData?.event || {};
    const participants = Array.isArray(hostData?.participants) ? hostData.participants : [];
    const winnerParticipantId = String(event.winner_participant_id || "").trim();
    const confirmedWinners = participants.filter((participant) => participant?.is_winner === true);
    const winnerParticipant = confirmedWinners.find((participant) => String(participant.id || "").trim() === winnerParticipantId)
      || confirmedWinners[0]
      || null;

    if (!winnerParticipant) return null;

    return {
      participant: winnerParticipant,
      confirmedAt: event.completed_at || winnerParticipant.confirmed_at || winnerParticipant.won_at || null
    };
  }

  function getRoundCompleteAlert(hostData, availableActions) {
    let roundNumber = null;
    let nextRoundLabel = "";

    if (availableActions.includes("open_round_2")) {
      roundNumber = 1;
      nextRoundLabel = "Round 2";
    } else if (availableActions.includes("open_round_3")) {
      roundNumber = 2;
      nextRoundLabel = "the Final Round";
    }

    if (roundNumber === null) return null;

    const config = getQuestionConfig(hostData, roundNumber);
    const advancementCount = Number(config.advance_limit);
    return {
      roundNumber,
      nextRoundLabel,
      advancementCount: Number.isFinite(advancementCount) && advancementCount > 0 ? advancementCount : null
    };
  }

  function isResetToWaitingAvailable(eventStatus) {
    const statusKey = normalizeStatus(eventStatus, "").toLowerCase();
    return [
      "question_1_open",
      "question_1_complete",
      "question_2_open",
      "question_2_complete",
      "question_3_open",
      "paused",
      "winner_locked"
    ].includes(statusKey);
  }

  function isRollbackOneRoundAvailable(eventStatus) {
    const statusKey = normalizeStatus(eventStatus, "").toLowerCase();
    return [
      "question_2_open",
      "question_2_complete",
      "question_3_open",
      "winner_locked"
    ].includes(statusKey);
  }

  function getActionsForStatus(eventStatus, hostData) {
    const statusKey = normalizeStatus(eventStatus, "").toLowerCase();
    const actions = [...(ACTIONS_BY_STATUS[statusKey] || [])];
    const participants = Array.isArray(hostData?.participants) ? hostData.participants : [];
    const submissions = Array.isArray(hostData?.submissions) ? hostData.submissions : [];

    if (statusKey === "question_1_open") {
      const q1Config = getQuestionConfig(hostData, 1);
      if (q1Config.advancement_mode === "first_n") {
        actions.push("complete_round_1");
      }
    }

    if (statusKey === "question_2_open") {
      const q2Config = getQuestionConfig(hostData, 2);
      if (q2Config.advancement_mode === "first_n") {
        actions.push("complete_round_2");
      }
    }

    if (statusKey === "question_2_complete" && getFinalistParticipantCount(participants) >= 1) {
      if (!actions.includes("open_round_3")) {
        actions.push("open_round_3");
      }
    }

    if (statusKey === "winner_locked") {
      const provisionalWinner = getProvisionalWinnerDetails(hostData);
      if (provisionalWinner) {
        if (!actions.includes("confirm_winner")) {
          actions.push("confirm_winner");
        }
      }
    }

    return actions;
  }

  function isActiveRoundParticipant(participant) {
    const status = normalizeStatus(participant?.current_status, "").toLowerCase();
    return Boolean(participant?.joined)
      && !status.includes("eliminated")
      && !status.includes("winner")
      && !status.includes("locked");
  }

  function getAutoCompleteAction(hostData) {
    const event = hostData?.event || {};
    const eventStatus = normalizeStatus(event.status, "").toLowerCase();
    const participants = Array.isArray(hostData?.participants) ? hostData.participants : [];
    const submissions = Array.isArray(hostData?.submissions) ? hostData.submissions : [];

    if (eventStatus === "question_1_open") {
      const q1Config = getQuestionConfig(hostData, 1);
      const activeParticipantIds = new Set(
        participants
          .filter(isActiveRoundParticipant)
          .map((participant) => String(participant.id || "").trim())
          .filter(Boolean)
      );
      const correctRound1Ids = getUniqueCorrectParticipantIds(submissions, 1);

      if (q1Config.advancement_mode === "all_correct") {
        if (activeParticipantIds.size > 0 && activeParticipantIds.size === correctRound1Ids.size) {
          return "complete_round_1";
        }
      }
    }

    if (eventStatus === "question_2_open") {
      const q2Config = getQuestionConfig(hostData, 2);
      const activeParticipantIds = new Set(
        participants
          .filter(isActiveRoundParticipant)
          .map((participant) => String(participant.id || "").trim())
          .filter(Boolean)
      );
      const correctRound2Ids = getUniqueCorrectParticipantIds(submissions, 2);

      if (q2Config.advancement_mode === "all_correct") {
        if (activeParticipantIds.size > 0 && activeParticipantIds.size === correctRound2Ids.size) {
          return "complete_round_2";
        }
      }
    }

    if (eventStatus === "question_3_open") {
      const correctRound3Ids = getUniqueCorrectParticipantIds(submissions, 3);

      if (correctRound3Ids.size >= 1) {
        return "complete_round_3";
      }
    }

    return null;
  }

  async function runHostTransition(action, { skipConfirm = false } = {}) {
    if (!action) return null;

    if (!skipConfirm) {
      const confirmationText = ACTION_CONFIRM_MESSAGES[action] || `Run action: ${action}?`;
      const confirmed = window.confirm(confirmationText);
      if (!confirmed) return null;
    }

    const eventId = getActiveEventId();
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc("host_set_playoff_state", {
      input_event_id: eventId,
      input_action: action
    });

    if (error) {
      throw error;
    }

    if (!data || data.ok !== true) {
      throw new Error("Host action did not return a successful state payload.");
    }

    return data;
  }

  async function maybeAutoCompleteRound(hostData) {
    const action = getAutoCompleteAction(hostData);
    if (!action) return null;

    const eventStatus = normalizeStatus(hostData?.event?.status || "").toLowerCase();
    const signature = `${eventStatus}:${action}`;
    if (state.lastAutoCompletedAction === action && state.lastAutoCompletedStatus === eventStatus) {
      return null;
    }

    try {
      const payload = await runHostTransition(action, { skipConfirm: true });
      if (payload) {
        state.lastAutoCompletedAction = action;
        state.lastAutoCompletedStatus = eventStatus;
        return payload;
      }
    } catch (error) {
      console.warn("Automatic round completion failed:", error);
    }

    return null;
  }

  function getReadyBanner(hostData) {
    const event = hostData?.event || {};
    const eventStatus = normalizeStatus(event.status, "").toLowerCase();
    const participants = Array.isArray(hostData?.participants) ? hostData.participants : [];
    const submissions = Array.isArray(hostData?.submissions) ? hostData.submissions : [];

    if (eventStatus === "question_1_open") {
      const q1Config = getQuestionConfig(hostData, 1);
      const activeParticipantIds = new Set(
        participants
          .filter(isActiveRoundParticipant)
          .map((participant) => String(participant.id || "").trim())
          .filter(Boolean)
      );
      const correctRound1Ids = getUniqueCorrectParticipantIds(submissions, 1);

      if (q1Config.advancement_mode === "all_correct") {
        if (activeParticipantIds.size > 0 && activeParticipantIds.size === correctRound1Ids.size) {
          return {
            className: "playoff-admin-banner--ready",
            title: "ROUND 1 WILL COMPLETE AUTOMATICALLY",
            body: "All active players have answered correctly. The round will complete automatically."
          };
        }
      } else if (q1Config.advancement_mode === "first_n") {
        const limit = Number(q1Config.advance_limit || 0);
        if (limit > 0) {
          const acceptedCount = Math.min(
            limit,
            getUniqueAcceptedCorrectParticipantIds(submissions, 1).size
          );
          const targetReached = acceptedCount >= limit;
          return {
            className: "playoff-admin-banner--ready",
            title: "ROUND 1 PROGRESS",
            body: `${acceptedCount} of ${limit} correct-answer positions filled.`,
            progress: {
              current: acceptedCount,
              target: limit,
              remainingText: targetReached
                ? "Round target reached — ready to complete Round 1."
                : `Need ${limit - acceptedCount} more correct answer(s) to advance.`
            }
          };
        }
      }
    }

    if (eventStatus === "question_2_open") {
      const q2Config = getQuestionConfig(hostData, 2);
      const activeParticipantIds = new Set(
        participants
          .filter(isActiveRoundParticipant)
          .map((participant) => String(participant.id || "").trim())
          .filter(Boolean)
      );
      const correctRound2Ids = getUniqueCorrectParticipantIds(submissions, 2);

      if (q2Config.advancement_mode === "all_correct") {
        if (activeParticipantIds.size > 0 && activeParticipantIds.size === correctRound2Ids.size) {
          return {
            className: "playoff-admin-banner--ready",
            title: "ROUND 2 WILL COMPLETE AUTOMATICALLY",
            body: "All active players have answered correctly. The round will complete automatically."
          };
        }
      } else if (q2Config.advancement_mode === "first_n") {
        const limit = Number(q2Config.advance_limit || 0);
        if (limit > 0) {
          const acceptedCount = Math.min(
            limit,
            getUniqueAcceptedCorrectParticipantIds(submissions, 2).size
          );
          const targetReached = acceptedCount >= limit;
          return {
            className: "playoff-admin-banner--ready",
            title: "ROUND 2 PROGRESS",
            body: `${acceptedCount} of ${limit} correct-answer positions filled.`,
            progress: {
              current: acceptedCount,
              target: limit,
              remainingText: targetReached
                ? "Round target reached — ready to complete Round 2."
                : `Need ${limit - acceptedCount} more correct answer(s) to advance.`
            }
          };
        }
      }
    }

    if (eventStatus === "question_3_open") {
      const correctRound3Ids = getUniqueCorrectParticipantIds(submissions, 3);
      return {
        className: "playoff-admin-banner--ready",
        title: "FINAL ROUND PROGRESS",
        body: correctRound3Ids.size >= 1
          ? "Winner found."
          : "Waiting for first correct finalist."
      };
    }

    if (eventStatus === "question_2_complete") {
      const finalistCount = getFinalistParticipantCount(participants);
      if (finalistCount >= 1) {
        return {
          className: "playoff-admin-banner--ready",
          title: "ROUND 3 IS READY",
          body: `${finalistCount} finalist${finalistCount === 1 ? "" : "s"} confirmed. When you are ready, click Open Round 3.`
        };
      }
    }

    if (eventStatus === "winner_locked") {
      const provisionalWinner = getProvisionalWinnerDetails(hostData);
      if (provisionalWinner) {
        const winnerName = provisionalWinner.winnerParticipant?.display_name || "A participant";
        const winnerEmail = provisionalWinner.winnerParticipant?.expected_email || provisionalWinner.winnerParticipant?.email || "";
        const winnerLabel = winnerEmail ? `${winnerName} (${winnerEmail})` : winnerName;
        return {
          className: "playoff-admin-banner--ready",
          title: "PROVISIONAL WINNER",
          body: `${winnerLabel} submitted the first correct Final answer. Confirm this winner to make the result official.`
        };
      }

      const winnerParticipantId = String(event?.winner_participant_id || "").trim();
      const winnerParticipant = winnerParticipantId
        ? participants.find((participant) => String(participant.id || "").trim() === winnerParticipantId)
        : null;
      return {
        className: "playoff-admin-banner--complete",
        title: "PLAYOFF COMPLETE",
        body: winnerParticipant?.display_name
          ? `A winner has been confirmed and the event is locked. Winner: ${winnerParticipant.display_name}.`
          : "A winner has been confirmed and the event is locked."
      };
    }

    return null;
  }

  function sanitizeErrorMessage(error) {
    if (!error) return "Request failed.";
    if (typeof error.message === "string" && error.message.trim()) return error.message.trim();
    if (typeof error.details === "string" && error.details.trim()) return error.details.trim();
    return "Request failed.";
  }

  function isPermissionError(error) {
    const code = String(error?.code || "").toLowerCase();
    const message = String(error?.message || "").toLowerCase();
    const details = String(error?.details || "").toLowerCase();
    const hint = String(error?.hint || "").toLowerCase();

    return code === "42501"
      || message.includes("permission")
      || message.includes("not authorized")
      || message.includes("access denied")
      || details.includes("permission")
      || hint.includes("permission");
  }

  function renderAuthView() {
    root.innerHTML = `
      <main class="playoff-shell" aria-label="Playoff admin authentication shell">
        <div class="playoff-brand">The Accidental Retiree</div>
        <h1>Live Playoff Host Console</h1>
        <p class="playoff-status playoff-status--unauthenticated">Sign in to continue.</p>
        <form id="playoff-admin-auth-form" class="playoff-answer-form" novalidate>
          <label for="playoff-admin-email">Email</label>
          <input id="playoff-admin-email" name="email" type="email" autocomplete="email" value="${escapeHtml(state.authEmail)}" required>
          <label for="playoff-admin-password">Password</label>
          <input id="playoff-admin-password" name="password" type="password" autocomplete="current-password" required>
          <button type="submit">${state.authSubmitting ? "Signing in..." : "Sign In"}</button>
        </form>
        ${state.authError ? `<p class="playoff-status playoff-status--error">${escapeHtml(state.authError)}</p>` : ""}
        <div class="playoff-badge">DEVELOPMENT SHELL</div>
      </main>
    `;

    const form = document.getElementById("playoff-admin-auth-form");
    if (form) {
      form.addEventListener("submit", handleAuthSubmit);
    }
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const emailInput = form?.querySelector('input[name="email"]');
    const passwordInput = form?.querySelector('input[name="password"]');
    const email = String(emailInput?.value || "").trim();
    const password = String(passwordInput?.value || "").trim();

    if (!email || !password) {
      state.authError = "Enter your email address and password to continue.";
      renderAuthView();
      return;
    }

    state.authSubmitting = true;
    state.authError = "";
    state.authEmail = email;
    renderAuthView();

    try {
      const signInData = await api.signInWithPassword(email, password);
      state.session = signInData?.session || null;
      if (!state.session?.user) {
        throw new Error("Sign in did not return an authenticated session.");
      }

      state.status = "loading";
      state.message = "Checking your session...";
      state.loading = true;
      await initialize();
    } catch (error) {
      state.authError = sanitizeErrorMessage(error);
      state.status = "unauthenticated";
      state.loading = false;
      renderAuthView();
    } finally {
      state.authSubmitting = false;
    }
  }

  function handleSetupFieldInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    if (target.id === "playoff-setup-q1-limit") {
      state.setupForm.q1Limit = target.value;
      state.setupDirty = true;
    } else if (target.id === "playoff-setup-q2-limit") {
      state.setupForm.q2Limit = target.value;
      state.setupDirty = true;
    }
  }

  function attachSetupHandlers() {
    const form = document.getElementById("playoff-event-setup-form");
    if (form) {
      form.removeEventListener("input", handleSetupFieldInput);
      form.removeEventListener("change", handleSetupFieldInput);
      form.addEventListener("input", handleSetupFieldInput);
      form.addEventListener("change", handleSetupFieldInput);
    }
  }

  async function handleSetupSubmit(event) {
    event.preventDefault();
    if (state.setupSaveLoading || !state.hostData) return;

    const validationError = validateSetupForm();
    if (validationError) {
      state.setupFeedback = validationError;
      state.setupFeedbackType = "error";
      renderView();
      return;
    }

    const config = getSetupConfigFromForm();
    const confirmed = window.confirm(getSetupConfirmationMessage(config));
    if (!confirmed) return;

    state.setupSaveLoading = true;
    state.setupFeedback = "Saving event setup...";
    state.setupFeedbackType = "info";
    renderView();

    try {
      const payload = await api.configureQuestions(getActiveEventId(), config);
      if (!payload || payload.ok !== true) {
        throw new Error("Event setup RPC did not return a successful state payload.");
      }

      updateHostStateFromPayload(payload, { force: true });
      syncSetupFormFromHostData(state.hostData, { force: true });
      state.setupDirty = false;
      state.setupFeedback = "Event setup saved.";
      state.setupFeedbackType = "success";
      state.refreshNotice = `Last refresh: ${formatDateTime(new Date().toISOString())}`;
      renderView();
    } catch (error) {
      state.setupFeedback = sanitizeErrorMessage(error);
      state.setupFeedbackType = "error";
      console.error("Event setup save failed:", error);
    } finally {
      state.setupSaveLoading = false;
      state.pollSuspended = false;
      scheduleNextPoll();
      renderCurrentView();
    }
  }

  function renderDashboard() {
    const hostData = state.hostData;
    const event = hostData?.event || {};
    const participants = Array.isArray(hostData?.participants) ? hostData.participants : [];
    const submissions = Array.isArray(hostData?.submissions) ? hostData.submissions : [];
    const counts = hostData?.counts || {};
    const userEmail = state.session?.user?.email ? String(state.session.user.email) : "";
    const eventStatus = normalizeStatus(event.status);
    const showPrePause = String(eventStatus).toLowerCase() === "paused" && event.pre_pause_status;
    const activeRoundText = formatRound(event.active_question_number);
    const availableActions = getActionsForStatus(eventStatus, hostData);
    const liveIndicator = state.status === "ready"
      ? `<span class="playoff-live-indicator" aria-label="Live updates on"><span class="playoff-live-dot" aria-hidden="true"></span><span>Live updates on</span></span>`
      : "";
    const readyBanner = getReadyBanner(hostData);
    const provisionalWinner = getProvisionalWinnerDetails(hostData);
    const confirmedWinner = getConfirmedWinnerDetails(hostData);
    const roundCompleteAlert = getRoundCompleteAlert(hostData, availableActions);
    const roundCompleteNumber = roundCompleteAlert?.roundNumber ?? null;
    const shouldScrollToRoundComplete = roundCompleteNumber !== null
      && state.lastVisibleRoundComplete !== roundCompleteNumber;
    state.lastVisibleRoundComplete = roundCompleteNumber;
    const eventStatusLower = normalizeStatus(eventStatus).toLowerCase();
    const isSetupEditable = isEventSetupEditable();
    const canRunFullReset = eventStatusLower === "waiting_for_players";
    const canRestartCurrentRound = getRestartRoundForStatus(eventStatusLower) !== null;
    const canRollbackOneRound = isRollbackOneRoundAvailable(eventStatusLower);
    const canResetEntireGame = isResetToWaitingAvailable(eventStatusLower);
    const recoveryFeedbackMarkup = state.recoveryFeedback
      ? `<p class="playoff-recovery-feedback ${state.recoveryFeedbackType === "error" ? "playoff-recovery-feedback--error" : state.recoveryFeedbackType === "success" ? "playoff-recovery-feedback--success" : ""}">${escapeHtml(state.recoveryFeedback)}</p>`
      : "";
    const setupFeedbackMarkup = state.setupFeedback
      ? `<p class="playoff-setup-feedback ${state.setupFeedbackType === "error" ? "playoff-setup-feedback--error" : state.setupFeedbackType === "success" ? "playoff-setup-feedback--success" : ""}">${escapeHtml(state.setupFeedback)}</p>`
      : "";
    const setupWarningMarkup = getSetupWarningMessage(hostData)
      ? `<p class="playoff-setup-warning">${escapeHtml(getSetupWarningMessage(hostData))}</p>`
      : "";
    const setupLockedMessage = `<p class="playoff-setup-locked">Locked once Round 1 begins.</p>`;
    const hostMessageFeedbackClass = state.hostFeed.feedbackType
      ? ` playoff-host-message-feedback--${state.hostFeed.feedbackType}`
      : "";
    const instrumentProgress = readyBanner?.progress || null;
    const instrumentProgressPercent = instrumentProgress
      ? Math.min(100, Math.max(0, (instrumentProgress.current / instrumentProgress.target) * 100))
      : 0;

    const refreshDisabled = (state.loading || state.actionLoading) ? "disabled" : "";
    const refreshText = state.loading ? "Refreshing..." : "Refresh State";
    const submissionScrollState = captureSubmissionScrollState();
    const participantScrollState = captureParticipantScrollState();
    const hostFeedScrollState = captureHostFeedScrollState();
    const onlineParticipantCount = participants.filter(
      (participant) => getParticipantPresence(participant, hostData?.server_time) === "ONLINE"
    ).length;
    const offlineParticipantCount = Math.max(0, participants.length - onlineParticipantCount);

    const participantRows = participants.length
      ? participants.map((participant, index) => {
        const joined = Boolean(participant.joined);
        const presence = getParticipantPresence(participant, hostData?.server_time);
        const presenceBadgeClass = presence === "ONLINE"
          ? "playoff-pill playoff-pill--presence-online"
          : "playoff-pill playoff-pill--presence-offline";
        const participantKey = participant?.id || participant?.expected_email || `${participant?.display_name || "participant"}:${index}`;
        return `
          <article class="playoff-item-card" aria-label="Participant row" data-participant-id="${escapeHtml(participantKey)}">
            <div class="playoff-item-head">
              <h3>${escapeHtml(participant.display_name || "Unnamed")}</h3>
              <div class="playoff-item-badges">
                <span class="${statusBadgeClass(participant.current_status)}">${escapeHtml(normalizeStatus(participant.current_status))}</span>
                <span class="${presenceBadgeClass}">${escapeHtml(presence)}</span>
              </div>
            </div>
            <div class="playoff-item-grid">
              <p><strong>Expected email:</strong> ${escapeHtml(participant.expected_email || "-")}</p>
              <p><strong>Joined:</strong> ${joined ? "Yes" : "No"}</p>
              <p><strong>Round 2 slot:</strong> ${escapeHtml(participant.question_2_slot || "-")}</p>
              <p><strong>Finalist:</strong> ${participant.is_finalist ? "Yes" : "No"}</p>
              <p><strong>Winner:</strong> ${participant.is_winner ? "Yes" : "No"}</p>
              <p><strong>Joined at:</strong> ${escapeHtml(formatDateTime(participant.joined_at))}</p>
              <p><strong>Last seen:</strong> ${escapeHtml(formatDateTime(participant.last_seen_at))}</p>
            </div>
          </article>
        `;
      }).join("")
      : "<p class=\"playoff-empty\">No participants found for this event.</p>";

    const sortedSubmissions = submissions.slice().sort((left, right) => {
      const leftTime = Date.parse(left?.submitted_at || "") || 0;
      const rightTime = Date.parse(right?.submitted_at || "") || 0;
      if (leftTime !== rightTime) return rightTime - leftTime;
      return String(left?.id || "").localeCompare(String(right?.id || ""));
    });

    const submissionRows = sortedSubmissions.length
      ? sortedSubmissions.map((submission, index) => {
        const resultText = submission?.is_correct ? "Correct" : "Incorrect";
        const resultClass = submission?.is_correct ? "playoff-pill playoff-pill--ok" : "playoff-pill playoff-pill--danger";
        const questionLabel = Number.isFinite(Number(submission?.question_number)) && Number(submission?.question_number) > 0
          ? `Round ${Number(submission.question_number)}`
          : "Round -";
        const submissionKey = submission?.id || `${submission?.question_number || "q"}:${submission?.submitted_at || ""}:${submission?.display_name || ""}:${index}`;

        return `
          <article class="playoff-item-card" aria-label="Submission row" data-submission-id="${escapeHtml(submissionKey)}">
            <div class="playoff-item-head">
              <h3>${escapeHtml(submission?.display_name || "Unnamed")}</h3>
              <span class="${resultClass}">${resultText}</span>
            </div>
            <div class="playoff-item-grid">
              <p><strong>Expected email:</strong> ${escapeHtml(submission?.expected_email || "-")}</p>
              <p><strong>Round:</strong> ${escapeHtml(questionLabel)}</p>
              <p><strong>Submitted answer:</strong> ${escapeHtml(submission?.submitted_answer || "-")}</p>
              <p><strong>Submitted at:</strong> ${escapeHtml(formatDateTime(submission?.submitted_at))}</p>
            </div>
          </article>
        `;
      }).join("")
      : "<p class=\"playoff-empty\">No submissions yet.</p>";

    const controlsMarkup = availableActions.length
      ? `<div class="playoff-host-actions">${availableActions.map((action) => {
        const isDisabled = state.loading || state.actionLoading || (
          action === "complete_round_1"
            ? getUniqueAcceptedCorrectParticipantIds(submissions, 1).size === 0
            : action === "complete_round_2"
              ? getUniqueAcceptedCorrectParticipantIds(submissions, 2).size === 0
              : action === "open_round_3"
                ? getFinalistParticipantCount(participants) < 1
                : false
        );
        return `<button type="button" class="${controlButtonClass(action)}" data-host-action="${escapeHtml(action)}" ${isDisabled ? "disabled" : ""}>${escapeHtml(ACTION_LABELS[action] || action)}</button>`;
      }).join("")}</div>`
      : "<p class=\"playoff-empty\">No currently supported host action is available for this event state.</p>";

    const actionFeedbackMarkup = state.actionNotice
      ? `<p class="playoff-host-action-feedback ${state.actionNoticeType === "error" ? "playoff-host-action-feedback--error" : state.actionNoticeType === "success" ? "playoff-host-action-feedback--success" : ""}">${escapeHtml(state.actionNotice)}</p>`
      : "";
    const winnerParticipant = confirmedWinner?.participant || null;
    const winnerEmail = winnerParticipant?.expected_email || winnerParticipant?.email || "";
    const winnerDisplayName = winnerParticipant?.display_name || winnerEmail || "Confirmed winner";
    const confirmedWinnerMarkup = confirmedWinner
      ? `<section class="playoff-winner-confirmed" aria-label="Confirmed playoff winner">
          <p class="playoff-winner-confirmed__kicker">🏆 WINNER CONFIRMED</p>
          <h2>${escapeHtml(winnerDisplayName)}</h2>
          ${winnerEmail ? `<p class="playoff-winner-confirmed__email">${escapeHtml(winnerEmail)}</p>` : ""}
          <p class="playoff-winner-confirmed__message">Grand Finale winner has been officially confirmed.</p>
          ${confirmedWinner.confirmedAt ? `<p class="playoff-winner-confirmed__time">Confirmed: ${escapeHtml(formatDateTime(confirmedWinner.confirmedAt))}</p>` : ""}
        </section>`
      : "";
    const pendingWinnerParticipant = provisionalWinner?.winnerParticipant || null;
    const pendingWinnerEmail = pendingWinnerParticipant?.expected_email || pendingWinnerParticipant?.email || "";
    const pendingWinnerDisplayName = pendingWinnerParticipant?.display_name || pendingWinnerEmail || "Selected finalist";
    const pendingWinnerMarkup = provisionalWinner
      ? `<section class="playoff-winner-pending" aria-label="Pending playoff winner">
          <p class="playoff-winner-pending__kicker">🏆 PENDING WINNER</p>
          <h3>${escapeHtml(pendingWinnerDisplayName)}</h3>
          ${pendingWinnerEmail ? `<p class="playoff-winner-pending__email">${escapeHtml(pendingWinnerEmail)}</p>` : ""}
          <p class="playoff-winner-pending__message">First correct finalist.<br>Awaiting host confirmation.</p>
        </section>`
      : "";
    const roundCompleteAlertMarkup = roundCompleteAlert
      ? `<section class="playoff-round-complete-alert" aria-label="Round ${roundCompleteAlert.roundNumber} complete">
          <p class="playoff-round-complete-alert__kicker">✅ ROUND ${roundCompleteAlert.roundNumber} COMPLETE</p>
          ${roundCompleteAlert.advancementCount !== null
            ? `<h3>${roundCompleteAlert.advancementCount} OF ${roundCompleteAlert.advancementCount} ADVANCEMENT SPOTS FILLED</h3>`
            : ""}
          <p>All required ${roundCompleteAlert.roundNumber === 2 ? "finalist" : "qualifying"} positions have been filled.</p>
          <p class="playoff-round-complete-alert__next">Ready to begin ${escapeHtml(roundCompleteAlert.nextRoundLabel)}.</p>
        </section>`
      : "";

    root.innerHTML = `
      <main class="playoff-shell playoff-shell--admin" aria-label="Live Playoff host dashboard">
        <div class="playoff-brand">The Accidental Retiree</div>
        <div class="playoff-header-row">
          <div class="playoff-title-wrap">
            <h1>Live Playoff Host Console</h1>
          </div>
          <button id="playoff-admin-refresh" class="playoff-refresh-btn" ${refreshDisabled}>${refreshText}</button>
        </div>
        <div class="playoff-admin-meta" aria-label="Host console status">
          ${liveIndicator}
          <span><strong>Event:</strong> ${escapeHtml(event.name || "-")}</span>
          ${userEmail ? `<span><strong>Host:</strong> ${escapeHtml(userEmail)}</span>` : ""}
          <span class="playoff-live-timestamp"><strong>Updated:</strong> ${escapeHtml(state.lastUpdatedLabel || formatLiveTimestamp())}</span>
        </div>
        <section class="playoff-instrument-panel" aria-label="Live playoff instrument panel">
          <div class="playoff-instrument-panel__heading">
            <span class="playoff-instrument-panel__signal" aria-hidden="true"></span>
            <h2>Instrument Panel</h2>
          </div>
          <div class="playoff-instrument-metrics">
            <article class="playoff-instrument-metric playoff-instrument-metric--blue">
              <h3>Invited</h3>
              <p>${escapeHtml(counts.participants ?? 0)}</p>
              <span>${escapeHtml(counts.participants ?? 0)} total</span>
            </article>
            <article class="playoff-instrument-metric ${onlineParticipantCount > 0 ? "playoff-instrument-metric--green" : "playoff-instrument-metric--neutral"}">
              <h3>Online</h3>
              <p>${escapeHtml(onlineParticipantCount)}</p>
              <span>${onlineParticipantCount > 0 ? "Active now" : "None online"}</span>
            </article>
            <article class="playoff-instrument-metric ${offlineParticipantCount > 0 ? "playoff-instrument-metric--amber" : "playoff-instrument-metric--green"}">
              <h3>Offline</h3>
              <p>${escapeHtml(offlineParticipantCount)}</p>
              <span>${offlineParticipantCount > 0 ? "Not active" : "All online"}</span>
            </article>
            <article class="playoff-instrument-metric ${Number(counts.finalists || 0) > 0 ? "playoff-instrument-metric--blue" : "playoff-instrument-metric--neutral"}">
              <h3>Finalists</h3>
              <p>${escapeHtml(counts.finalists ?? 0)}</p>
              <span>${Number(counts.finalists || 0) > 0 ? "Qualified" : "None yet"}</span>
            </article>
            <article class="playoff-instrument-metric ${Number(counts.eliminated || 0) > 0 ? "playoff-instrument-metric--red" : "playoff-instrument-metric--neutral"}">
              <h3>Eliminated</h3>
              <p>${escapeHtml(counts.eliminated ?? 0)}</p>
              <span>${escapeHtml(counts.eliminated ?? 0)} players</span>
            </article>
            <article class="playoff-instrument-metric ${Number(counts.winners || 0) > 0 ? "playoff-instrument-metric--amber" : "playoff-instrument-metric--neutral"}">
              <h3>Winners</h3>
              <p>${escapeHtml(counts.winners ?? 0)}</p>
              <span>${Number(counts.winners || 0) > 0 ? "Confirmed" : "None yet"}</span>
            </article>
            <article class="playoff-instrument-metric playoff-instrument-metric--blue">
              <h3>Total Submissions</h3>
              <p>${escapeHtml(counts.submissions ?? 0)}</p>
              <span>All rounds</span>
            </article>
          </div>
          <div class="playoff-instrument-status">
            <div class="playoff-instrument-strip-item playoff-instrument-progress">
              <div>
                <span class="playoff-instrument-label">${escapeHtml(readyBanner?.title || "ROUND PROGRESS")}</span>
                <strong>${instrumentProgress ? `${escapeHtml(instrumentProgress.current)} of ${escapeHtml(instrumentProgress.target)}` : escapeHtml(activeRoundText)}</strong>
                <p>${escapeHtml(instrumentProgress?.remainingText || readyBanner?.body || "No active advancement alert.")}</p>
              </div>
              <div class="playoff-instrument-progress__track" aria-hidden="true">
                <span style="width: ${instrumentProgressPercent}%"></span>
              </div>
            </div>
            <div class="playoff-instrument-strip-item playoff-instrument-readout">
              <span class="playoff-instrument-label">ACTIVE ROUND</span>
              <strong>${escapeHtml(activeRoundText)}</strong>
            </div>
            <div class="playoff-instrument-strip-item playoff-instrument-readout">
              <span class="playoff-instrument-label">STATUS</span>
              <strong><span class="${statusBadgeClass(eventStatus)}">${escapeHtml(eventStatus)}</span></strong>
              ${showPrePause ? `<small>Pre-pause: ${escapeHtml(event.pre_pause_status)}</small>` : ""}
            </div>
            <div class="playoff-instrument-strip-item playoff-instrument-readout playoff-instrument-readout--time">
              <span class="playoff-instrument-label">SERVER TIME</span>
              <strong>${escapeHtml(formatDateTime(hostData?.server_time))}</strong>
            </div>
            <div class="playoff-instrument-strip-item playoff-instrument-controls" aria-label="Host controls">
              <span class="playoff-instrument-label">HOST CONTROLS</span>
              ${state.actionLoading ? '<p class="playoff-host-action-feedback">Updating event...</p>' : ""}
              ${actionFeedbackMarkup}
              ${controlsMarkup}
            </div>
          </div>
          ${pendingWinnerMarkup}
          ${roundCompleteAlertMarkup}
        </section>
        ${confirmedWinnerMarkup}
        <section class="playoff-dashboard-block playoff-host-message-composer" aria-label="Message players">
          <h2>MESSAGE PLAYERS</h2>
          <label for="playoff-host-message-draft">Host message</label>
          <textarea id="playoff-host-message-draft" maxlength="500" rows="4" placeholder="Write a live update for joined players...">${escapeHtml(state.hostFeed.draft)}</textarea>
          <div class="playoff-host-message-composer__footer">
            <span id="playoff-host-message-counter">${state.hostFeed.draft.length} / 500</span>
            <div class="playoff-host-message-actions">
              <button id="playoff-host-message-clear" class="playoff-action-btn playoff-host-message-clear-btn" type="button" ${state.hostFeed.sending || state.hostFeed.clearing ? "disabled" : ""}>CLEAR CHAT</button>
              <button id="playoff-host-message-send" class="playoff-action-btn playoff-action-btn--primary" type="button" ${state.hostFeed.sending || state.hostFeed.clearing ? "disabled" : ""}>SEND</button>
              <button id="playoff-host-message-send-important" class="playoff-action-btn playoff-action-btn--important" type="button" ${state.hostFeed.sending || state.hostFeed.clearing ? "disabled" : ""}>SEND AS IMPORTANT</button>
            </div>
          </div>
          <p id="playoff-host-message-feedback" class="playoff-host-message-feedback${hostMessageFeedbackClass}">${escapeHtml(state.hostFeed.feedback)}</p>
          <div class="playoff-host-message-history-heading">RECENT HOST MESSAGES</div>
          <div id="playoff-admin-host-feed-history" class="playoff-admin-host-feed-history">
            ${renderHostFeedHistoryMarkup()}
          </div>
        </section>

        <section class="playoff-dashboard-block" aria-label="Round submissions list">
          <h2>Round Submissions</h2>
          <div class="playoff-item-list playoff-submissions-list">${submissionRows}</div>
        </section>

        <section class="playoff-dashboard-block" aria-label="Participants list">
          <h2>Participants</h2>
          <div class="playoff-item-list playoff-participants-list">${participantRows}</div>
        </section>

        <section class="playoff-dashboard-block" aria-label="Event setup">
          <div class="playoff-setup-header">
            <h2>Event Setup</h2>
            ${setupLockedMessage}
          </div>
          <form id="playoff-event-setup-form" class="playoff-setup-form" data-setup-form="true" novalidate>
            <div class="playoff-setup-compact-grid">
              <label class="playoff-setup-field playoff-setup-compact-field" for="playoff-setup-q1-limit">
                <span>Round 1</span>
                <input id="playoff-setup-q1-limit" data-setup-control="q1-limit" type="number" min="1" step="1" value="${escapeHtml(state.setupForm.q1Limit || "")}" ${isSetupEditable ? "" : "disabled"}>
              </label>
              <label class="playoff-setup-field playoff-setup-compact-field" for="playoff-setup-q2-limit">
                <span>Round 2</span>
                <input id="playoff-setup-q2-limit" data-setup-control="q2-limit" type="number" min="1" step="1" value="${escapeHtml(state.setupForm.q2Limit || "")}" ${isSetupEditable ? "" : "disabled"}>
              </label>
              <div class="playoff-setup-compact-readonly">
                <span>Round 3</span>
                <strong>1 winner</strong>
              </div>
              <div class="playoff-setup-actions">
                <button id="playoff-setup-save" class="playoff-action-btn playoff-action-btn--primary" type="submit" ${isSetupEditable && !state.setupSaveLoading ? "" : "disabled"}>${state.setupSaveLoading ? "Saving..." : "Save Event Setup"}</button>
              </div>
            </div>
            ${setupWarningMarkup}
            ${setupFeedbackMarkup}
          </form>
        </section>

        <section class="playoff-dashboard-block playoff-dashboard-block--danger" aria-label="Recovery controls">
          <h2>Recovery Controls</h2>
          <p class="playoff-status-detail">Emergency controls for recovering this playoff event. These actions affect playoff data only and do not change Six Continents game solves or stage progress.</p>
          ${recoveryFeedbackMarkup}
          ${canRunFullReset
            ? `<div class="playoff-recovery-actions">
                <button id="playoff-recovery-full-reset" class="playoff-action-btn playoff-recovery-btn" type="button" ${state.recoveryLoading ? "disabled" : ""}>${state.recoveryLoading && state.recoveryAction === "full_reset" ? "Resetting..." : "Full Reset Event"}</button>
              </div>`
            : ""}
          <div class="playoff-recovery-actions">
            <button id="playoff-recovery-restart-current-round" class="playoff-action-btn playoff-action-btn--primary" type="button" ${state.recoveryLoading || !canRestartCurrentRound ? "disabled" : ""}>${state.recoveryLoading && state.recoveryAction === "restart_current_round" ? "Restarting..." : "Restart Current Round"}</button>
          </div>
          <div class="playoff-recovery-actions">
            <button id="playoff-recovery-rollback-one-round" class="playoff-action-btn playoff-action-btn--primary" type="button" ${state.recoveryLoading || !canRollbackOneRound ? "disabled" : ""}>${state.recoveryLoading && state.recoveryAction === "rollback_one_round" ? "Rolling Back..." : "Roll Back One Round"}</button>
          </div>
          <div class="playoff-recovery-actions">
            <button id="playoff-recovery-reset-to-waiting" class="playoff-action-btn playoff-recovery-btn" type="button" ${state.recoveryLoading || !canResetEntireGame ? "disabled" : ""}>${state.recoveryLoading && state.recoveryAction === "reset_to_waiting" ? "Resetting Game..." : "RESET ENTIRE GAME"}</button>
          </div>
          ${!canRunFullReset && !canRestartCurrentRound && !canRollbackOneRound && !canResetEntireGame
            ? '<p class="playoff-status-detail">Full Reset Event is currently available only while the event is waiting for players. Restart Current Round is currently available only while Round 1, Round 2, or the Final Round is open, or when the event is winner locked. Roll Back One Round is available while Round 2 or the Final Round is active, or when the event is winner locked. Reset Entire Game to Waiting Room is available during active playoff runtime states.</p>'
            : ""}
        </section>
      </main>
    `;

    attachSetupHandlers();
    const setupForm = document.getElementById("playoff-event-setup-form");
    if (setupForm) {
      setupForm.addEventListener("submit", handleSetupSubmit);
    }
    restoreSubmissionScrollState(submissionScrollState);
    restoreParticipantScrollState(participantScrollState);
    restoreHostFeedScrollState(hostFeedScrollState);
    if (shouldScrollToRoundComplete) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const alert = document.querySelector(`[aria-label="Round ${roundCompleteNumber} complete"]`);
          alert?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      });
    }
  }

  function renderCurrentView() {
    if (state.status === "invalid_event") {
      renderShell(
        "playoff-status--error",
        "Invalid event target.",
        state.session?.user?.email ? `Signed in as: ${escapeHtml(state.session.user.email)}` : "",
        state.eventTargetError || "The supplied event ID is invalid."
      );
      return;
    }

    if (state.status === "unauthenticated") {
      renderAuthView();
      return;
    }

    if (state.status === "unauthorized") {
      renderShell(
        "playoff-status--host-unauthorized",
        "This account is not authorized to view host playoff state.",
        state.session?.user?.email ? `Signed in as: ${escapeHtml(state.session.user.email)}` : "",
        state.message
      );
      return;
    }

    if (state.status === "error") {
      renderShell(
        "playoff-status--error",
        "Host state could not be loaded.",
        state.session?.user?.email ? `Signed in as: ${escapeHtml(state.session.user.email)}` : "",
        state.message
      );
      return;
    }

    if (state.hostData) {
      renderDashboard();
      return;
    }

    renderShell("playoff-status--loading", state.message || "Loading host state...");
  }

  async function refreshHostState({ fromPoll = false, force = false } = {}) {
    if (state.pollInFlight || state.actionLoading || state.recoveryLoading) return;

    state.pollInFlight = true;

    if (!fromPoll) {
      state.loading = true;
      state.message = "Loading host state...";
      state.refreshNotice = "";
      renderView();
    }

    if (!state.eventTargetValid) {
      state.status = "invalid_event";
      state.message = state.eventTargetError || "The supplied event ID is invalid.";
      renderCurrentView();
      return;
    }

    try {
      const payload = await api.getHostState(getActiveEventId());
      let changed = updateHostStateFromPayload(payload, { force: force || state.status !== "ready" });
      if (!fromPoll && !state.hostFeed.loaded) {
        void refreshHostFeed();
      } else if (fromPoll) {
        state.hostFeedPollCount += 1;
        if (state.hostFeedPollCount >= 2) {
          state.hostFeedPollCount = 0;
          void refreshHostFeed();
        }
      }
      syncSetupFormFromHostData(payload);
      if (!state.actionNoticeType || state.actionNoticeType === "success") {
        state.actionNotice = "";
        state.actionNoticeType = "";
      }

      const autoCompletePayload = await maybeAutoCompleteRound(payload);
      if (autoCompletePayload) {
        changed = updateHostStateFromPayload(autoCompletePayload, { force: true }) || changed;
      }

      const composerActive = document.activeElement?.id === "playoff-host-message-draft";
      const suppressPollRender = fromPoll && (state.setupDirty || isSetupFormActive() || composerActive);
      if (!suppressPollRender && (changed || state.status !== "ready" || fromPoll)) {
        state.refreshNotice = `Last refresh: ${formatDateTime(new Date().toISOString())}`;
        renderView();
      }
    } catch (error) {
      if (!state.lastPollErrorAt || Date.now() - state.lastPollErrorAt > 10000) {
        console.warn("Host state polling failed:", error);
        state.lastPollErrorAt = Date.now();
      }

      if (!state.hostData) {
        if (isPermissionError(error)) {
        state.status = "unauthorized";
        state.message = "Access denied by host-state permission rules.";
        } else {
        state.status = "error";
        state.message = error?.message ? String(error.message) : "Unknown host-state load error.";
        }
      }
    } finally {
      state.loading = false;
      state.pollInFlight = false;
      if (!state.pollSuspended && state.status === "ready" && state.session?.user) {
        scheduleNextPoll();
      }
      if (!fromPoll) {
        renderCurrentView();
      }
    }
  }

  async function executeHostAction(action) {
    if (!action || state.actionLoading || state.loading || !state.hostData) return;

    const completionRound = action === "complete_round_1"
      ? 1
      : action === "complete_round_2"
        ? 2
        : null;
    let confirmationText = ACTION_CONFIRM_MESSAGES[action] || `Run action: ${action}?`;

    if (completionRound !== null) {
      const config = getQuestionConfig(state.hostData, completionRound);
      const target = Number(config.advance_limit || 0);
      if (config.advancement_mode === "first_n" && target > 0) {
        const submissions = Array.isArray(state.hostData?.submissions) ? state.hostData.submissions : [];
        const acceptedCount = Math.min(
          target,
          getUniqueAcceptedCorrectParticipantIds(submissions, completionRound).size
        );
        if (acceptedCount < target) {
          confirmationText = [
            `Round ${completionRound} target has not been reached.`,
            "",
            `Only ${acceptedCount} of ${target} required correct answers have been accepted.`,
            "",
            `Complete Round ${completionRound} anyway?`
          ].join("\n");
        }
      }
    }

    const confirmed = window.confirm(confirmationText);
    if (!confirmed) return;

    state.actionLoading = true;
    state.actionNotice = "Updating event...";
    state.actionNoticeType = "";
    renderView();

    try {
      const data = await runHostTransition(action, { skipConfirm: completionRound !== null });
      if (!data) {
        return;
      }

      updateHostStateFromPayload(data, { force: true });
      syncSetupFormFromHostData(data);
      state.refreshNotice = `Last refresh: ${formatDateTime(new Date().toISOString())}`;
      state.actionNotice = `${ACTION_LABELS[action] || action} succeeded.`;
      state.actionNoticeType = "success";
      renderView();
      if (action === "confirm_winner") {
        window.requestAnimationFrame(() => {
          window.scrollTo({ top: 0, behavior: "smooth" });
        });
      }
    } catch (error) {
      state.actionNotice = sanitizeErrorMessage(error);
      state.actionNoticeType = "error";
      console.error("Host control action failed:", error);
    } finally {
      state.actionLoading = false;
      state.pollSuspended = false;
      scheduleNextPoll();
      renderCurrentView();
    }
  }

  function requestTypedRecoveryConfirmation(confirmationText, requiredPhrase) {
    const entered = window.prompt(confirmationText);
    if (entered === null) return false;
    if (String(entered).trim().toUpperCase() === requiredPhrase) return true;

    state.recoveryFeedback = `Reset cancelled. Type ${requiredPhrase} exactly to confirm.`;
    state.recoveryFeedbackType = "error";
    renderCurrentView();
    return false;
  }

  async function handleRecoveryAction(action) {
    if (!action || state.recoveryLoading || state.actionLoading || state.loading || !state.hostData) return;
    if (action !== "full_reset" && action !== "restart_current_round" && action !== "rollback_one_round" && action !== "reset_to_waiting") return;

    if (action === "full_reset") {
      const confirmationText = [
        "FULL RESET EVENT",
        "",
        "This will erase all playoff submissions, advancement results, eliminations, finalist results and winner results for this event.",
        "",
        "It will preserve:",
        "- the event",
        "- the questions",
        "- advancement settings",
        "- invitations",
        "- joined player account bindings",
        "",
        "The event will return to DRAFT.",
        "",
        "This does NOT affect Six Continents game solves or stage progress.",
        "",
        `Type ${FULL_RESET_CONFIRMATION} to reset this playoff event.`
      ].join("\n");

      if (!requestTypedRecoveryConfirmation(confirmationText, FULL_RESET_CONFIRMATION)) return;
    } else if (action === "reset_to_waiting") {
      const confirmationText = [
        "RESET ENTIRE GAME TO WAITING ROOM",
        "",
        "This will erase ALL playoff submissions, advancement results,",
        "eliminations, finalist results and winner results for this event.",
        "",
        "It will preserve:",
        "- the event",
        "- questions",
        "- advancement settings",
        "- invitations",
        "- joined player account bindings",
        "",
        "All joined players will return to the Waiting Room and the playoff can be started again.",
        "",
        "This does NOT affect Six Continents game solves or stage progress.",
        "",
        `Type ${GAME_RESET_CONFIRMATION} to reset the entire game to the waiting room.`
      ].join("\n");

      if (!requestTypedRecoveryConfirmation(confirmationText, GAME_RESET_CONFIRMATION)) return;
    } else if (action === "rollback_one_round") {
      const currentStatus = normalizeStatus(state.hostData?.event?.status || "").toLowerCase();
      const confirmationText = currentStatus === "question_2_open" || currentStatus === "question_2_complete"
        ? [
          "ROLL BACK ONE ROUND",
          "",
          "This will reopen Round 1 and replay it from the beginning.",
          "",
          "All Round 1, Round 2 and Round 3 submissions will be erased.",
          "",
          "Joined players will return to Round 1 and can answer again.",
          "",
          "Never-joined invitees will remain invited.",
          "",
          "This does NOT affect Six Continents game solves or stage progress."
        ].join("\n")
        : [
          "ROLL BACK ONE ROUND",
          "",
          "This will reopen Round 2 and replay it from the beginning.",
          "",
          "Round 2 and Round 3 submissions will be erased.",
          "",
          "Round 1 results and qualifiers will be preserved.",
          "",
          "Round 1 qualifiers will return to Round 2 and can answer again.",
          "",
          "This does NOT affect Six Continents game solves or stage progress."
        ].join("\n");

      const confirmed = window.confirm(confirmationText);
      if (!confirmed) return;
    } else {
      const currentStatus = normalizeStatus(state.hostData?.event?.status || "").toLowerCase();
      const restartRound = getRestartRoundForStatus(currentStatus);
      if (restartRound === null) return;

      const confirmationText = restartRound === 3
        ? [
          "RESTART FINAL ROUND?",
          "",
          "All Final Round submissions and winner results will be erased.",
          "",
          "Round 1 and Round 2 results will be preserved.",
          "",
          "The Round 2 finalists will return to the Final Round and can answer again.",
          "",
          "Questions, advancement settings and player account bindings will be preserved.",
          "",
          "This does NOT affect Six Continents game solves or stage progress."
        ].join("\n")
        : restartRound === 2
          ? [
            "RESTART ROUND 2?",
            "",
            "All Round 2 submissions and Round 2 advancement results will be erased.",
            "",
            "Round 1 results and qualifiers will be preserved.",
            "",
            "All Round 1 qualifiers will return to Round 2 and can answer again.",
            "",
            "Questions, advancement settings and player account bindings will be preserved.",
            "",
            "This does NOT affect Six Continents game solves or stage progress."
          ].join("\n")
          : [
            "RESTART ROUND 1?",
            "",
            "All Round 1 submissions and Round 1 advancement results will be erased.",
            "",
            "All joined players will return to Round 1 and can answer again.",
            "",
            "Questions, advancement settings and player account bindings will be preserved.",
            "",
            "This does NOT affect Six Continents game solves or stage progress."
          ].join("\n");

      const confirmed = window.confirm(confirmationText);
      if (!confirmed) return;
    }

    state.recoveryLoading = true;
    state.recoveryAction = action;
    state.recoveryFeedback = action === "restart_current_round"
      ? "Restarting Round..."
      : action === "rollback_one_round"
        ? "Rolling back one round..."
        : action === "reset_to_waiting"
          ? "Resetting game..."
          : "Resetting event...";
    state.recoveryFeedbackType = "info";
    renderView();

    try {
      const payload = action === "reset_to_waiting"
        ? await api.resetToWaiting(getActiveEventId())
        : await api.recoverEvent(getActiveEventId(), action);
      if (!payload || payload.ok !== true) {
        throw new Error("Recovery RPC did not return a successful state payload.");
      }

      updateHostStateFromPayload(payload, { force: true });
      syncSetupFormFromHostData(state.hostData, { force: true });
      state.setupDirty = false;
      state.refreshNotice = `Last refresh: ${formatDateTime(new Date().toISOString())}`;
      const nextStatus = normalizeStatus(payload?.event?.status || "").toLowerCase();
      if (action === "restart_current_round") {
        const nextRestartRound = getRestartRoundForStatus(nextStatus);
        state.recoveryFeedback = nextRestartRound === 3
          ? "Final Round restarted. The finalists can answer again."
          : nextRestartRound === 2
            ? "Round 2 restarted. Round 1 qualifiers can answer again."
            : "Round 1 restarted. All joined players can answer again.";
      } else if (action === "rollback_one_round") {
        state.recoveryFeedback = "Rolled back one round.";
      } else if (action === "reset_to_waiting") {
        state.recoveryFeedback = nextStatus === "waiting_for_players"
          ? "Entire playoff reset. All joined players are back in the Waiting Room."
          : "Entire playoff reset completed.";
      } else {
        state.recoveryFeedback = nextStatus === "draft"
          ? "Full reset completed. Event returned to draft."
          : "Full reset completed.";
      }
      state.recoveryFeedbackType = "success";
      renderView();
    } catch (error) {
      state.recoveryFeedback = sanitizeErrorMessage(error);
      state.recoveryFeedbackType = "error";
      console.error("Recovery action failed:", error);
    } finally {
      state.recoveryLoading = false;
      state.recoveryAction = "";
      state.pollSuspended = false;
      scheduleNextPoll();
      renderCurrentView();
    }
  }

  async function initialize() {
    const resolvedTarget = resolveEventTarget();
    state.eventTargetId = resolvedTarget.eventId;
    state.eventTargetMode = resolvedTarget.mode;
    state.eventTargetValid = resolvedTarget.valid;
    state.eventTargetError = resolvedTarget.error;

    if (!state.eventTargetValid) {
      state.loading = false;
      state.status = "invalid_event";
      state.message = resolvedTarget.error;
      renderCurrentView();
      return;
    }

    state.loading = true;
    state.status = "loading";
    state.message = "Checking your session...";
    renderCurrentView();

    try {
      const session = await api.getSession();
      state.session = session;

      if (!session?.user) {
        state.loading = false;
        state.status = "unauthenticated";
        renderCurrentView();
        return;
      }

      await refreshHostState();
      startPolling();
    } catch (error) {
      state.loading = false;
      state.status = "error";
      state.message = error?.message ? String(error.message) : "Authentication failed.";
      renderCurrentView();
    }
  }

  void initialize();
})();
