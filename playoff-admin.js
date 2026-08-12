"use strict";

(() => {
  const DEFAULT_EVENT_ID = "591ec441-e182-46b5-82d5-345c7d9c82c0";
  const REQUIRED_API_METHODS = ["getSession", "getHostState"];
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
    pause: "Pause the live event?",
    resume: "Resume the live event?"
  };
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
    authSubmitting: false,
    authError: "",
    authEmail: "",
    eventTargetId: DEFAULT_EVENT_ID,
    eventTargetMode: "production",
    eventTargetValid: true,
    eventTargetError: ""
  };

  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.id === "playoff-admin-refresh") {
      if (state.actionLoading) return;
      void refreshHostState();
      return;
    }

    if (target.dataset.hostAction) {
      void executeHostAction(target.dataset.hostAction);
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopPolling();
      return;
    }

    if (state.session?.user && !state.actionLoading && state.status === "ready") {
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
      label: "PRODUCTION EVENT — STAGE 15",
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

  function controlButtonClass(action) {
    if (action === "pause") return "playoff-action-btn playoff-action-btn--pause";
    if (action === "resume") return "playoff-action-btn playoff-action-btn--resume";
    return "playoff-action-btn playoff-action-btn--primary";
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
        const acceptedCount = getUniqueAcceptedCorrectParticipantIds(submissions, 1).size;
        const limit = Number(q1Config.advance_limit || 0);
        if (limit > 0) {
          return {
            className: "playoff-admin-banner--ready",
            title: "ROUND 1 PROGRESS",
            body: `${acceptedCount} of ${limit} qualifying positions filled.`
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
        const acceptedCount = getUniqueAcceptedCorrectParticipantIds(submissions, 2).size;
        const limit = Number(q2Config.advance_limit || 0);
        if (limit > 0) {
          return {
            className: "playoff-admin-banner--ready",
            title: "ROUND 2 PROGRESS",
            body: `${acceptedCount} of ${limit} finalist positions filled.`
          };
        }
      }
    }

    if (eventStatus === "question_3_open") {
      const correctRound3Ids = getUniqueCorrectParticipantIds(submissions, 3);

      if (correctRound3Ids.size >= 1) {
        return {
          className: "playoff-admin-banner--ready",
          title: "FINAL ROUND WILL COMPLETE AUTOMATICALLY",
          body: "First correct finalist wins."
        };
      }
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

  function renderDashboard() {
    const hostData = state.hostData;
    const event = hostData?.event || {};
    const participants = Array.isArray(hostData?.participants) ? hostData.participants : [];
    const questions = Array.isArray(hostData?.questions) ? hostData.questions : [];
    const submissions = Array.isArray(hostData?.submissions) ? hostData.submissions : [];
    const counts = hostData?.counts || {};
    const userEmail = state.session?.user?.email ? String(state.session.user.email) : "";
    const eventStatus = normalizeStatus(event.status);
    const targetSummary = getEventTargetSummary();
    const showPrePause = String(eventStatus).toLowerCase() === "paused" && event.pre_pause_status;
    const activeRoundText = formatRound(event.active_question_number);
    const availableActions = getActionsForStatus(eventStatus, hostData);
    const liveIndicator = state.status === "ready"
      ? `<div class="playoff-live-indicator" aria-label="Live updates on"><span class="playoff-live-dot" aria-hidden="true"></span><span>Live updates on</span><span class="playoff-live-timestamp">Last updated: ${escapeHtml(state.lastUpdatedLabel || formatLiveTimestamp())}</span></div>`
      : "";
    const readyBanner = getReadyBanner(hostData);

    const refreshDisabled = (state.loading || state.actionLoading) ? "disabled" : "";
    const refreshText = state.loading ? "Refreshing..." : "Refresh State";
    const feedbackClass = state.status === "ready"
      ? "playoff-status playoff-status--host-verified"
      : "playoff-status playoff-status--error";

    const participantRows = participants.length
      ? participants.map((participant) => {
        const joined = Boolean(participant.joined);
        return `
          <article class="playoff-item-card" aria-label="Participant row">
            <div class="playoff-item-head">
              <h3>${escapeHtml(participant.display_name || "Unnamed")}</h3>
              <span class="${statusBadgeClass(participant.current_status)}">${escapeHtml(normalizeStatus(participant.current_status))}</span>
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

    const questionRows = questions.length
      ? questions.map((question) => {
        let openState = "Not opened";
        if (question.is_open === true) openState = "Open";
        else if (question.opened_at) openState = "Closed";

        return `
          <article class="playoff-item-card" aria-label="Question row">
            <div class="playoff-item-head">
              <h3>Round ${escapeHtml(question.question_number)}</h3>
              <span class="${statusBadgeClass(openState)}">${escapeHtml(openState)}</span>
            </div>
            <p class="playoff-question-prompt">${escapeHtml(question.prompt || "-")}</p>
            <div class="playoff-item-grid">
              <p><strong>Active:</strong> ${question.is_active ? "Yes" : "No"}</p>
              <p><strong>Opened:</strong> ${escapeHtml(formatDateTime(question.opened_at))}</p>
              <p><strong>Closed:</strong> ${escapeHtml(formatDateTime(question.closed_at))}</p>
            </div>
          </article>
        `;
      }).join("")
      : "<p class=\"playoff-empty\">No questions found for this event.</p>";

    const sortedSubmissions = submissions.slice().sort((left, right) => {
      const leftQuestion = Number(left?.question_number || 0);
      const rightQuestion = Number(right?.question_number || 0);
      if (leftQuestion !== rightQuestion) return leftQuestion - rightQuestion;

      const leftTime = Date.parse(left?.submitted_at || "") || 0;
      const rightTime = Date.parse(right?.submitted_at || "") || 0;
      return leftTime - rightTime;
    });

    const submissionRows = sortedSubmissions.length
      ? sortedSubmissions.map((submission) => {
        const resultText = submission?.is_correct ? "Correct" : "Incorrect";
        const resultClass = submission?.is_correct ? "playoff-pill playoff-pill--ok" : "playoff-pill playoff-pill--danger";
        const questionLabel = Number.isFinite(Number(submission?.question_number)) && Number(submission?.question_number) > 0
          ? `Round ${Number(submission.question_number)}`
          : "Round -";

        return `
          <article class="playoff-item-card" aria-label="Submission row">
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

    root.innerHTML = `
      <main class="playoff-shell playoff-shell--admin" aria-label="Live Playoff host dashboard">
        <div class="playoff-brand">The Accidental Retiree</div>
        ${readyBanner ? `
        <section class="playoff-admin-banner ${readyBanner.className}" aria-label="Round readiness alert">
          <h2>${escapeHtml(readyBanner.title)}</h2>
          <p>${escapeHtml(readyBanner.body)}</p>
        </section>
        ` : ""}
        <div class="playoff-header-row">
          <div class="playoff-title-wrap">
            <h1>Live Playoff Host Console</h1>
            ${liveIndicator}
          </div>
          <button id="playoff-admin-refresh" class="playoff-refresh-btn" ${refreshDisabled}>${refreshText}</button>
        </div>
        ${userEmail ? `<p class="playoff-email">Signed in as: ${escapeHtml(userEmail)}</p>` : ""}
        <p class="${feedbackClass}">${escapeHtml(state.message)}</p>
        ${state.refreshNotice ? `<p class="playoff-status-detail">${escapeHtml(state.refreshNotice)}</p>` : ""}
        <section class="playoff-dashboard-block" aria-label="Event target">
          <h2>Active Event Target</h2>
          <div class="playoff-item-grid playoff-item-grid--summary">
            <p><strong>Target:</strong> ${escapeHtml(targetSummary.label)}</p>
            <p><strong>Event ID:</strong> ${escapeHtml(targetSummary.detail || "-")}</p>
          </div>
        </section>

        <section class="playoff-dashboard-block" aria-label="Event summary">
          <h2>Event Summary</h2>
          <div class="playoff-item-grid playoff-item-grid--summary">
            <p><strong>Event:</strong> ${escapeHtml(event.name || "-")}</p>
            <p><strong>Status:</strong> <span class="${statusBadgeClass(eventStatus)}">${escapeHtml(eventStatus)}</span></p>
            <p><strong>Active round:</strong> ${escapeHtml(activeRoundText)}</p>
            <p><strong>Pre-pause status:</strong> ${showPrePause ? escapeHtml(event.pre_pause_status) : "-"}</p>
            <p><strong>Started:</strong> ${escapeHtml(formatDateTime(event.started_at))}</p>
            <p><strong>Paused:</strong> ${escapeHtml(formatDateTime(event.paused_at))}</p>
            <p><strong>Completed:</strong> ${escapeHtml(formatDateTime(event.completed_at))}</p>
            <p><strong>Server time:</strong> ${escapeHtml(formatDateTime(hostData?.server_time))}</p>
          </div>
        </section>

        <section class="playoff-dashboard-block" aria-label="Counts">
          <h2>Counts</h2>
          <div class="playoff-count-grid">
            <article class="playoff-count-card"><h3>Invited</h3><p>${escapeHtml(counts.participants ?? 0)}</p></article>
            <article class="playoff-count-card"><h3>Joined</h3><p>${escapeHtml(counts.joined ?? 0)}</p></article>
            <article class="playoff-count-card"><h3>Not Joined</h3><p>${escapeHtml(counts.not_joined ?? 0)}</p></article>
            <article class="playoff-count-card"><h3>Finalists</h3><p>${escapeHtml(counts.finalists ?? 0)}</p></article>
            <article class="playoff-count-card"><h3>Eliminated</h3><p>${escapeHtml(counts.eliminated ?? 0)}</p></article>
            <article class="playoff-count-card"><h3>Winners</h3><p>${escapeHtml(counts.winners ?? 0)}</p></article>
            <article class="playoff-count-card"><h3>Total Submissions</h3><p>${escapeHtml(counts.submissions ?? 0)}</p></article>
          </div>
        </section>

        <section class="playoff-dashboard-block" aria-label="Participants list">
          <h2>Participants</h2>
          <div class="playoff-item-list">${participantRows}</div>
        </section>

        <section class="playoff-dashboard-block" aria-label="Questions list">
          <h2>Questions</h2>
          <div class="playoff-item-list">${questionRows}</div>
        </section>

        <section class="playoff-dashboard-block" aria-label="Round submissions list">
          <h2>Round Submissions</h2>
          <div class="playoff-item-list">${submissionRows}</div>
        </section>

        <section class="playoff-dashboard-block" aria-label="Host controls">
          <h2>Host Controls</h2>
          <p class="playoff-status-detail">Controls are shown for operator UX only. Backend authorization and transition validation remain authoritative.</p>
          ${state.actionLoading ? '<p class="playoff-host-action-feedback">Updating event...</p>' : ""}
          ${actionFeedbackMarkup}
          ${controlsMarkup}
        </section>
      </main>
    `;
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
    if (state.pollInFlight || state.actionLoading) return;

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
      if (!state.actionNoticeType || state.actionNoticeType === "success") {
        state.actionNotice = "";
        state.actionNoticeType = "";
      }

      const autoCompletePayload = await maybeAutoCompleteRound(payload);
      if (autoCompletePayload) {
        changed = updateHostStateFromPayload(autoCompletePayload, { force: true }) || changed;
      }

      if (changed || state.status !== "ready" || fromPoll) {
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

    const confirmationText = ACTION_CONFIRM_MESSAGES[action] || `Run action: ${action}?`;
    const confirmed = window.confirm(confirmationText);
    if (!confirmed) return;

    state.actionLoading = true;
    state.actionNotice = "Updating event...";
    state.actionNoticeType = "";
    renderView();

    try {
      const data = await runHostTransition(action);
      if (!data) {
        return;
      }

      updateHostStateFromPayload(data, { force: true });
      state.refreshNotice = `Last refresh: ${formatDateTime(new Date().toISOString())}`;
      state.actionNotice = `${ACTION_LABELS[action] || action} succeeded.`;
      state.actionNoticeType = "success";
      renderView();
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
