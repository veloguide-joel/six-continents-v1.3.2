"use strict";

(() => {
  const root = document.getElementById("playoff-app");

  if (!root) {
    console.error("Playoff app root element missing.");
    return;
  }

  if (!window.PlayoffAPI || typeof window.PlayoffAPI !== "object") {
    console.error("Playoff application boundary unavailable.");
    root.innerHTML = `
      <main class="playoff-shell" aria-label="Live Playoff shell error">
        <div class="playoff-brand">The Accidental Retiree</div>
        <h1>Live Playoff</h1>
        <p class="playoff-status">Playoff application boundary unavailable.</p>
      </main>
    `;
    return;
  }

  const api = window.PlayoffAPI;
  if (
    typeof api.getSession !== "function" ||
    typeof api.joinPlayoff !== "function" ||
    typeof api.getPlayerState !== "function" ||
    typeof api.touchPlayoffPresence !== "function" ||
    typeof api.markPlayoffPresenceOffline !== "function" ||
    typeof api.submitAnswer !== "function"
  ) {
    root.innerHTML = `
      <main class="playoff-shell" aria-label="Live Playoff shell error">
        <div class="playoff-brand">The Accidental Retiree</div>
        <h1>Live Playoff</h1>
        <p class="playoff-status playoff-status--error">Playoff API methods are unavailable.</p>
      </main>
    `;
    return;
  }

  const state = {
    inviteToken: "",
    session: null,
    user: null,
    joinData: null,
    playerState: null,
    currentEventId: null,
    eligibleToSubmit: false,
    isSubmitting: false,
    feedback: "",
    pollTimerId: null,
    pollInFlight: false,
    pollSuspended: false,
    presenceTimerId: null,
    presenceInFlight: false,
    presenceActive: false,
    fatalError: false,
    lastPlayerStateKey: "",
    lastCelebratedSignature: "",
    celebrationTimerId: null,
    lastStateScore: 0,
    incorrectFeedback: null,
    authUi: {
      mode: "loading",
      title: "Welcome to the Live Playoff",
      message: "Checking your invitation…",
      detail: "Your invitation has already been detected. After signing in, you will enter the playoff automatically.",
      isError: false,
      showSignOut: false,
      error: "",
      email: ""
    }
  };

  const POLL_INTERVAL_MS = 2500;
  const PRESENCE_HEARTBEAT_INTERVAL_MS = 10000;
  const prefersReducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const parseJoinData = (raw) => {
    const payload = Array.isArray(raw) ? raw[0] : raw;
    const event = payload?.event || {};
    const participant = payload?.participant || {};
    const playerStatus = String(
      payload?.player_status ||
      payload?.participant_status ||
      participant?.status ||
      "unknown"
    );
    const eventStatus = String(payload?.event_status || event?.status || "");
    const eventName = payload?.event_name || event?.name || "Live Playoff";
    const eventId = payload?.event_id || event?.id || null;
    const activeQuestionNumber = Number(
      payload?.active_question_number ||
      event?.active_question_number ||
      payload?.active_round ||
      event?.active_round ||
      0
    ) || 0;

    return {
      eventName,
      eventStatus,
      eventId,
      playerStatus,
      activeQuestionNumber,
      alreadyJoined: Boolean(payload?.already_joined),
      acceptedPosition: payload?.accepted_position ?? participant?.accepted_position ?? null,
      raw: payload
    };
  };

  const normalize = (value) => String(value || "").trim().toLowerCase();

  const containsAny = (value, terms) => {
    const source = normalize(value);
    return terms.some((term) => source.includes(term));
  };

  const isParticipantEligible = (playerStatus) => {
    const status = normalize(playerStatus);
    return !containsAny(status, ["eliminated", "winner", "completed", "locked"]);
  };

  const getWinnerParticipantId = (playerState) => {
    const candidates = [
      playerState?.winner_participant_id,
      playerState?.winnerParticipantId,
      playerState?.event?.winner_participant_id,
      playerState?.event?.winnerParticipantId,
      playerState?.event_winner_participant_id,
      playerState?.event_winner_participant
    ];

    for (const candidate of candidates) {
      const value = String(candidate || "").trim();
      if (value) {
        return value;
      }
    }

    return "";
  };

  const getParticipantId = (playerState) => String(playerState?.participant_id || playerState?.id || "").trim();

  const isProvisionalWinnerCandidate = (playerState, { isWinner = false, eliminated = false, eventStatus = "", participantStatus = "" } = {}) => {
    const normalizedEventStatus = normalize(eventStatus || playerState?.event_status || "");
    const normalizedPlayerStatus = normalize(participantStatus || playerState?.participant_status || "");
    const winnerParticipantId = getWinnerParticipantId(playerState);
    const participantId = getParticipantId(playerState);
    const officialWinner = Boolean(isWinner) || containsAny(normalizedPlayerStatus, ["winner"]);
    return normalizedEventStatus === "winner_locked"
      && winnerParticipantId
      && participantId
      && participantId === winnerParticipantId
      && !officialWinner
      && !eliminated;
  };

  const isProvisionalWinnerWaitingState = (playerState, { isWinner = false, isFinalist = false, eliminated = false, eventStatus = "", participantStatus = "" } = {}) => {
    const normalizedEventStatus = normalize(eventStatus || playerState?.event_status || "");
    const normalizedPlayerStatus = normalize(participantStatus || playerState?.participant_status || "");
    const winnerParticipantId = getWinnerParticipantId(playerState);
    const participantId = getParticipantId(playerState);
    const officialWinner = Boolean(isWinner) || containsAny(normalizedPlayerStatus, ["winner"]);
    const finalistState = Boolean(isFinalist) || containsAny(normalizedPlayerStatus, ["finalist"]);
    return normalizedEventStatus === "winner_locked"
      && winnerParticipantId
      && participantId
      && participantId !== winnerParticipantId
      && !officialWinner
      && !eliminated
      && finalistState;
  };

  const isOfficialWinner = (playerState) => Boolean(playerState?.is_winner) || containsAny(playerState?.participant_status || "", ["winner"]);

  const getIncorrectFeedbackSignature = (playerState, questionId) => {
    return [
      playerState?.participant_status || "",
      playerState?.event_status || "",
      Number(playerState?.active_question_number || 0),
      questionId || ""
    ].join("|");
  };

  const hasProgressedBeyondIncorrectFeedback = (playerState, incorrectFeedback) => {
    if (!incorrectFeedback) {
      return true;
    }

    const presentation = getPlayerPresentation(playerState, state.joinData || {});
    if (presentation.mode !== "answering") {
      return true;
    }

    const questionId = playerState?.question?.id || "";
    const questionNumber = Number(playerState?.active_question_number || 0);
    return (
      questionId !== incorrectFeedback.questionId
      || questionNumber !== Number(incorrectFeedback.questionNumber || 0)
    );
  };

  const getPlayerDisplayName = (player) => {
    return String(player?.display_name || player?.displayName || player?.name || "").trim();
  };

  const normalizeCountValue = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
  };

  const getPlayerAvatarMarkup = (player) => {
    const displayName = getPlayerDisplayName(player);
    const avatarUrl = String(player?.avatar_url || player?.avatarUrl || "").trim();
    const avatarKey = String(player?.avatar_key || player?.avatarKey || "").trim();

    if (avatarUrl) {
      return `<img class="playoff-avatar" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName || "Player avatar")}">`;
    }

    if (avatarKey) {
      return `<span class="playoff-avatar playoff-avatar--fallback" aria-hidden="true">${escapeHtml(avatarKey.slice(0, 1).toUpperCase())}</span>`;
    }

    const initial = (displayName || "P").trim().charAt(0).toUpperCase();
    return `<span class="playoff-avatar playoff-avatar--fallback" aria-hidden="true">${escapeHtml(initial)}</span>`;
  };

  const escapeHtml = (value) => {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  const clearCelebration = () => {
    if (state.celebrationTimerId) {
      window.clearTimeout(state.celebrationTimerId);
      state.celebrationTimerId = null;
    }

    const existingLayer = document.querySelector(".playoff-celebration-layer");
    if (existingLayer) {
      existingLayer.remove();
    }
  };

  const createConfettiPiece = (variant) => {
    const piece = document.createElement("span");
    piece.className = `playoff-confetti-piece playoff-confetti-piece--${variant.shape}`;
    const offsetX = (Math.random() * 100) - 50;
    const offsetY = (Math.random() * 100) - 35;
    piece.style.setProperty("--confetti-x", `${offsetX}vw`);
    piece.style.setProperty("--confetti-y", `${offsetY}vh`);
    piece.style.setProperty("--confetti-rotate", `${Math.round(Math.random() * 900 + 360)}deg`);
    piece.style.setProperty("--confetti-delay", `${Math.random() * variant.stagger}s`);
    piece.style.setProperty("--confetti-duration", `${variant.duration}s`);
    piece.style.setProperty("--confetti-hue", `${Math.round(Math.random() * 80 + variant.hueBase)}`);
    piece.style.setProperty("--confetti-scale", `${variant.scale}`);
    return piece;
  };

  const launchCelebration = (kind) => {
    clearCelebration();

    if (prefersReducedMotion) {
      return;
    }

    const layer = document.createElement("div");
    layer.className = `playoff-celebration-layer playoff-celebration-layer--${kind}`;

    const variants = kind === "winner"
      ? [
        { count: 60, duration: 6.5, stagger: 1.4, hueBase: 38, scale: 1.2, shape: "round" },
        { count: 84, duration: 7.6, stagger: 1.8, hueBase: 170, scale: 1.0, shape: "diamond" }
      ]
      : [
        { count: 30, duration: 2.4, stagger: 0.7, hueBase: 38, scale: 1.0, shape: "round" },
        { count: 18, duration: 2.7, stagger: 0.8, hueBase: 170, scale: 0.85, shape: "diamond" }
      ];

    variants.forEach((variant, index) => {
      const burst = document.createElement("div");
      burst.className = `playoff-celebration-burst playoff-celebration-burst--${index + 1}`;
      for (let pieceIndex = 0; pieceIndex < variant.count; pieceIndex += 1) {
        burst.appendChild(createConfettiPiece(variant));
      }
      layer.appendChild(burst);
    });

    document.body.appendChild(layer);
    state.celebrationTimerId = window.setTimeout(() => {
      clearCelebration();
    }, kind === "winner" ? 7600 : 2800);
  };

  const classifyState = (playerState) => {
    const eventStatus = normalize(playerState?.event_status);
    const playerStatus = normalize(playerState?.participant_status);
    const questionNumber = Number(playerState?.active_question_number || 0);
    const isWinner = Boolean(playerState?.is_winner);
    const isFinalist = Boolean(playerState?.is_finalist);
    const hasQuestion = Boolean(playerState?.question);
    const eliminated = Boolean(playerState?.eliminated_at) || containsAny(playerStatus, ["eliminated", "out"]);
    const provisionalWinnerCandidate = isProvisionalWinnerCandidate(playerState, { isWinner, eliminated, eventStatus, participantStatus: playerStatus });
    const provisionalWinnerWaiting = isProvisionalWinnerWaitingState(playerState, { isWinner, isFinalist, eliminated, eventStatus, participantStatus: playerStatus });

    if (containsAny(eventStatus, ["completed", "finished", "closed"])) {
      return "event_completed";
    }
    if (containsAny(eventStatus, ["paused"])) {
      return "paused";
    }
    if (isWinner || containsAny(playerStatus, ["winner"])) {
      return "winner";
    }
    if (provisionalWinnerCandidate) {
      return "provisional_winner_candidate";
    }
    if (provisionalWinnerWaiting) {
      return "provisional_winner_waiting";
    }
    if (eliminated) {
      return "eliminated";
    }
    if (isFinalist && (questionNumber < 3 || !hasQuestion)) {
      return "finalist_waiting_final";
    }
    if (questionNumber === 3 && hasQuestion && isParticipantEligible(playerStatus)) {
      return "question_3_open";
    }
    if (questionNumber === 2 && hasQuestion && isParticipantEligible(playerStatus)) {
      if (isFinalist || containsAny(playerStatus, ["completed_q2", "round_2_complete", "finalist"])) {
        return "finalist_waiting_final";
      }
      return "question_2_open";
    }
    if (eventStatus === "waiting_for_players") {
      return "waiting_for_players";
    }
    if (eventStatus === "draft") {
      return "draft";
    }
    if (!hasQuestion && containsAny(playerStatus, ["waiting_for_next", "completed_q1", "round_1_complete", "advanced"])) {
      return "waiting_for_next";
    }
    if (questionNumber === 1) {
      if (containsAny(playerStatus, ["completed_q1", "round_1_complete", "advanced", "round_2"])) {
        return "question_1_completed";
      }
      if (hasQuestion && isParticipantEligible(playerStatus)) {
        return "question_1_open";
      }
      return "waiting_for_host";
    }
    if (containsAny(eventStatus, ["draft", "waiting"])) {
      return "waiting_for_host";
    }
    return "waiting_for_host";
  };

  const uiConfigByState = {
    draft: {
      statusClass: "playoff-status--authenticated",
      statusText: "Waiting room not open yet",
      detailText: "",
      canSubmit: false
    },
    waiting_for_players: {
      statusClass: "playoff-status--authenticated playoff-status--live",
      statusText: "Waiting for the host to begin",
      detailText: "",
      canSubmit: false
    },
    waiting_for_host: {
      statusClass: "playoff-status--loading",
      statusText: "Waiting for host",
      detailText: "The event is not accepting answers yet.",
      canSubmit: false
    },
    waiting_for_next: {
      statusClass: "playoff-status--authenticated",
      statusText: "Waiting for the next round",
      detailText: "Round 1 is complete. You have advanced. Please wait for the host to open Round 2.",
      canSubmit: false
    },
    question_1_open: {
      statusClass: "playoff-status--authenticated",
      statusText: "Question 1 open",
      detailText: "Submit your answer when ready.",
      canSubmit: true
    },
    question_1_completed: {
      statusClass: "playoff-status--authenticated",
      statusText: "Question 1 completed by this player",
      detailText: "You have advanced. Waiting for Round 2.",
      canSubmit: false
    },
    question_2_open: {
      statusClass: "playoff-status--authenticated",
      statusText: "Question 2 open",
      detailText: "Submit your answer to secure finalist status.",
      canSubmit: true
    },
    finalist_waiting_final: {
      statusClass: "playoff-status--authenticated",
      statusText: "Finalist waiting for final",
      detailText: "You are through and waiting for Question 3.",
      canSubmit: false
    },
    eliminated: {
      statusClass: "playoff-status--error",
      statusText: "Eliminated",
      detailText: "Answer entry is disabled.",
      canSubmit: false
    },
    question_3_open: {
      statusClass: "playoff-status--authenticated",
      statusText: "Question 3 open",
      detailText: "Final round is live.",
      canSubmit: true
    },
    provisional_winner_candidate: {
      statusClass: "playoff-status--authenticated",
      statusText: "Answer locked in",
      detailText: "You submitted the first correct Final answer. The host is confirming the result.",
      canSubmit: false
    },
    provisional_winner_waiting: {
      statusClass: "playoff-status--authenticated",
      statusText: "Final answer submitted",
      detailText: "A correct Final answer has been submitted. The host is confirming the result.",
      canSubmit: false
    },
    winner: {
      statusClass: "playoff-status--host-verified",
      statusText: "Winner",
      detailText: "Congratulations. Answer entry is now closed.",
      canSubmit: false
    },
    paused: {
      statusClass: "playoff-status--authz-error",
      statusText: "Paused",
      detailText: "The host has paused this event.",
      canSubmit: false
    },
    event_completed: {
      statusClass: "playoff-status--unauthenticated",
      statusText: "Event completed",
      detailText: "This playoff event is closed.",
      canSubmit: false
    }
  };

  const getPlayerPresentation = (playerState, joinInfo) => {
    const eventStatus = normalize(playerState?.event_status || joinInfo?.eventStatus);
    const playerStatus = normalize(playerState?.participant_status || joinInfo?.playerStatus);
    const questionNumber = Number(playerState?.active_question_number || joinInfo?.activeQuestionNumber || 0);
    const question = playerState?.question || {};
    const hasQuestion = Boolean(question?.id);
    const isWinner = Boolean(playerState?.is_winner) || containsAny(playerStatus, ["winner"]);
    const eliminated = Boolean(playerState?.eliminated_at) || containsAny(playerStatus, ["eliminated", "out"]);
    const isFinalist = Boolean(playerState?.is_finalist) || containsAny(playerStatus, ["finalist"]);
    const provisionalWinnerCandidate = isProvisionalWinnerCandidate(playerState, { isWinner, eliminated, eventStatus, participantStatus: playerStatus });
    const provisionalWinnerWaiting = isProvisionalWinnerWaitingState(playerState, { isWinner, isFinalist, eliminated, eventStatus, participantStatus: playerStatus });
    const waitingForNext = !hasQuestion && containsAny(playerStatus, ["waiting_for_next", "completed_q1", "round_1_complete", "advanced"]);
    const paused = containsAny(eventStatus, ["paused"]);
    const waitingRoomPlayers = Array.isArray(playerState?.waiting_room_players)
      ? playerState.waiting_room_players
      : Array.isArray(playerState?.waitingRoomPlayers)
        ? playerState.waitingRoomPlayers
        : Array.isArray(playerState?.participants)
          ? playerState.participants
          : [];

    if (eventStatus === "draft") {
      return {
        mode: "draft",
        cardClass: "playoff-player-state-card--draft",
        title: "Your Place Is Confirmed",
        label: "Waiting room not open yet",
        body: [
          "You’re officially entered in the live playoff.",
          "The live waiting room has not opened yet. Please return at the scheduled time, or keep this page open — it will update automatically when the host opens the room."
        ],
        checklist: [
          "Signed in successfully",
          "Invitation verified",
          "Playoff entry confirmed"
        ],
        waitingRoomPlayers,
        canSubmit: false,
        showQuestion: false,
        showForm: false
      };
    }

    if (eventStatus === "waiting_for_players") {
      return {
        mode: "waiting_for_players",
        cardClass: "playoff-player-state-card--waiting-room",
        title: "You’re in the Live Waiting Room",
        label: "Waiting for the host to begin",
        body: [
          "Your place is confirmed and the host is getting everything ready.",
          "Keep this page open. Round 1 will appear here automatically when the playoff begins."
        ],
        checklist: [],
        waitingRoomPlayers,
        canSubmit: false,
        showQuestion: false,
        showForm: false
      };
    }

    if (provisionalWinnerCandidate) {
      return {
        mode: "provisional_winner_candidate",
        cardClass: "playoff-player-state-card--winner",
        title: "Answer Locked In",
        body: [
          "You submitted the first correct Final answer.",
          "The host is confirming the result.",
          "Please stay on this screen."
        ],
        canSubmit: false,
        showQuestion: false,
        showForm: false
      };
    }

    if (provisionalWinnerWaiting) {
      return {
        mode: "provisional_winner_waiting",
        cardClass: "playoff-player-state-card--finalist",
        title: "Another Final Answer Was Submitted",
        body: [
          "Another finalist submitted the first correct Final answer.",
          "The host is confirming the result. This screen will update automatically."
        ],
        canSubmit: false,
        showQuestion: false,
        showForm: false
      };
    }

    if (isWinner) {
      return {
        mode: "winner",
        cardClass: "playoff-player-state-card--winner",
        title: "🏆 Congratulations! You Won!",
        body: [
          "You are the official playoff winner.",
          "Joel will contact you with the prize details.",
          "Thank you for playing Six Continents Challenge!"
        ],
        canSubmit: false,
        showQuestion: false,
        showForm: false
      };
    }

    if (eliminated) {
      const round3Elimination = Boolean(playerState?.is_finalist)
        || Boolean(playerState?.question_2_slot != null)
        || questionNumber >= 3
        || containsAny(playerStatus, ["round_3", "final"]);

      return round3Elimination
        ? {
          mode: "eliminated",
          cardClass: "playoff-player-state-card--eliminated",
          title: "😔 So Close!",
          body: [
            "The host has confirmed another finalist’s winning answer.",
            "Making it all the way to the final was an outstanding achievement, and we sincerely appreciate you being part of this special playoff.",
            "Thank you for playing the Six Continents Challenge!"
          ],
          canSubmit: false,
          showQuestion: false,
          showForm: false
        }
        : {
          mode: "eliminated",
          cardClass: "playoff-player-state-card--eliminated",
          title: "😔 So Close!",
          body: [
            "Other contestants answered correctly before you and advanced to the next round.",
            "You had an incredible run, and we truly appreciate you taking part in the playoff.",
            "Thanks for playing the Six Continents Challenge!"
          ],
          canSubmit: false,
          showQuestion: false,
          showForm: false
        };
    }

    if (isFinalist && (questionNumber < 3 || !hasQuestion)) {
      return {
        mode: "finalist",
        cardClass: "playoff-player-state-card--finalist",
        title: "You’re in the Final!",
        label: "Waiting for the Final Round",
        body: [
          "Congratulations — you secured one of the finalist positions.",
          "Your answer was accepted and your finalist place is confirmed.",
          "Please keep this page open. The final round will appear here automatically when the host begins Round 3."
        ],
        canSubmit: false,
        showQuestion: false,
        showForm: false
      };
    }

    if (waitingForNext) {
      return {
        mode: "waiting_for_next",
        cardClass: "playoff-player-state-card--success",
        title: "Correct! You’re Through to Round 2",
        label: "Waiting for Round 2",
        body: [
          "Your answer was accepted.",
          "Please keep this page open. Round 2 will appear here automatically when the host is ready."
        ],
        canSubmit: false,
        showQuestion: false,
        showForm: false
      };
    }

    if (paused) {
      return {
        mode: "paused",
        cardClass: "playoff-player-state-card--paused",
        title: "The event is paused",
        body: [
          "Please wait here while the host resumes the playoff."
        ],
        canSubmit: false,
        showQuestion: false,
        showForm: false
      };
    }

    if (hasQuestion && isParticipantEligible(playerStatus)) {
      const roundLabel = questionNumber > 0 ? `Round ${questionNumber}` : "This round";
      return {
        mode: "answering",
        cardClass: `playoff-player-state-card--answering playoff-player-state-card--round-${questionNumber || 0}`,
        title: `${roundLabel} is live`,
        body: [
          "Submit your answer when you’re ready."
        ],
        canSubmit: true,
        showQuestion: true,
        showForm: true
      };
    }

    return {
      mode: "waiting_for_host",
      cardClass: "playoff-player-state-card--waiting",
      title: "Waiting for the host",
      body: [
        "The event is not accepting answers yet."
      ],
      canSubmit: false,
      showQuestion: false,
      showForm: false
    };
  };

  const getPlayerStateScore = (playerState) => {
    const presentation = getPlayerPresentation(playerState, state.joinData || {});
    const questionNumber = Number(playerState?.active_question_number || 0);

    switch (presentation.mode) {
      case "winner":
        return 9000;
      case "provisional_winner_candidate":
      case "provisional_winner_waiting":
        return 8800;
      case "eliminated":
        return 8900;
      case "finalist":
        return 3500 + questionNumber;
      case "waiting_for_next":
        return 2500 + questionNumber;
      case "answering":
        return 1000 + questionNumber;
      case "paused":
        return 600;
      case "event_completed":
        return 100;
      case "waiting_for_host":
      default:
        return 500;
    }
  };

  const mergePlayerState = (baseState, updatePayload) => {
    const base = baseState && typeof baseState === "object" ? baseState : {};
    const update = updatePayload && typeof updatePayload === "object" ? updatePayload : {};
    const questionNumber = Number(
      update.question_number ??
      update.active_question_number ??
      update.active_round ??
      base.active_question_number ??
      0
    ) || 0;

    return {
      ...base,
      ...update,
      participant_status: update.participant_status ?? base.participant_status ?? base.player_status ?? "",
      event_status: update.event_status ?? base.event_status ?? "",
      is_finalist: update.is_finalist ?? base.is_finalist ?? false,
      is_winner: update.is_winner ?? base.is_winner ?? false,
      accepted_position: update.accepted_position ?? base.accepted_position ?? null,
      active_question_number: questionNumber,
      question_number: questionNumber,
      question: null
    };
  };

  const shouldIgnorePollUpdate = (currentState, incomingState) => {
    if (!incomingState) {
      return true;
    }

    const currentKey = buildPlayerStateKey(currentState);
    const incomingKey = buildPlayerStateKey(incomingState);
    if (currentKey === incomingKey) {
      return true;
    }

    const currentPresentation = getPlayerPresentation(currentState, state.joinData || {});
    const incomingPresentation = getPlayerPresentation(incomingState, state.joinData || {});
    const currentQuestionNumber = Number(currentState?.active_question_number || 0);
    const incomingQuestionNumber = Number(incomingState?.active_question_number || 0);
    const currentHasQuestion = Boolean(currentState?.question?.id);
    const incomingHasQuestion = Boolean(incomingState?.question?.id);
    const incomingParticipantStatus = String(incomingState?.participant_status || "").trim().toLowerCase();
    const sameRoundReopened =
      incomingQuestionNumber > 0 &&
      currentQuestionNumber === incomingQuestionNumber &&
      !currentHasQuestion &&
      incomingHasQuestion &&
      incomingParticipantStatus === "answering";

    if (sameRoundReopened) {
      return false;
    }

    if (currentPresentation.mode === "winner") {
      return incomingPresentation.mode !== "winner";
    }

    if (currentPresentation.mode === "eliminated") {
      return incomingPresentation.mode !== "eliminated";
    }

    if ((currentPresentation.mode === "waiting_for_next" || currentPresentation.mode === "finalist") && incomingHasQuestion && incomingQuestionNumber <= currentQuestionNumber) {
      return true;
    }

    return false;
  };

  const renderShell = (statusClass, statusText, emailText = "", detailText = "") => {
    root.innerHTML = `
      <main class="playoff-shell" aria-label="Live Playoff shell">
        <div class="playoff-brand">The Accidental Retiree</div>
        <h1>Live Playoff</h1>
        ${emailText ? `<p class="playoff-email">${emailText}</p>` : ""}
        <p class="playoff-status ${statusClass}">${statusText}</p>
        ${detailText ? `<p class="playoff-status-detail">${detailText}</p>` : ""}
      </main>
    `;
  };

  const setAuthUi = (mode, title, message = "", detail = "", { isError = false, showSignOut = false, error = "", email = "" } = {}) => {
    state.authUi = {
      mode,
      title,
      message,
      detail,
      isError,
      showSignOut,
      error,
      email
    };
  };

  const getFriendlyAuthErrorMessage = (error) => {
    const rawMessage = String(error?.message || error?.details || error?.hint || "").toLowerCase();
    const isWrongAccount = /different|belongs|expected email|expected.*email|email.*invitation|invitation.*email/i.test(rawMessage);

    if (isWrongAccount) {
      return {
        kind: "wrong_account",
        title: "This invitation belongs to a different email address",
        message: "Please sign out and sign in with the email address that received this playoff invitation.",
        detail: "",
        showSignOut: true
      };
    }

    if (/invalid invitation|invite token|invitation.*invalid|expired invitation|not found/i.test(rawMessage)) {
      return {
        kind: "invalid_invitation",
        title: "This invitation is no longer valid",
        message: "Please contact the organizer for a fresh invitation link.",
        detail: "",
        showSignOut: false
      };
    }

    if (/invalid login|invalid_grant|email or password|incorrect|password/i.test(rawMessage)) {
      return {
        kind: "invalid_credentials",
        title: "We couldn’t sign you in",
        message: "Please check the email address and password and try again.",
        detail: "",
        showSignOut: false
      };
    }

    if (/network|fetch|timed out|offline/i.test(rawMessage)) {
      return {
        kind: "network",
        title: "We couldn’t reach authentication right now",
        message: "Please check your connection and try again.",
        detail: "",
        showSignOut: false
      };
    }

    return {
      kind: "generic",
      title: "We couldn’t sign you in",
      message: "Please try again in a moment.",
      detail: "",
      showSignOut: false
    };
  };

  const handleJoinFailure = (error) => {
    const rawMessage = String(error?.message || error?.details || error?.hint || "").toLowerCase();
    const rawSignal = String(error?.detail || error?.details || error?.message || error?.hint || "").trim();
    const isLateJoinCutoff = /PLAYOFF_JOIN_CUTOFF/i.test(rawSignal)
      || /the qualifying round has already ended\. new playoff entries are closed\./i.test(rawSignal);
    const isWrongAccount = /different|belongs|expected email|expected.*email|email.*invitation|invitation.*email/i.test(rawMessage);
    const isInvalidInvitation = /invalid invitation|invite token|expired|not found|does not exist|not valid/i.test(rawMessage);

    if (isLateJoinCutoff) {
      setAuthUi("late_join_cutoff", "You missed the qualifying round.", "Round 1 has already ended, so entries for this playoff are now closed.", "You needed to join before Round 1 was completed to remain eligible for the playoff.", {
        isError: false,
        showSignOut: false,
        error: ""
      });
      return true;
    }

    if (isWrongAccount) {
      setAuthUi("wrong_account", "This invitation belongs to a different email address", "Please sign out and sign in with the email address that received this playoff invitation.", "", {
        isError: true,
        showSignOut: true,
        error: "This invitation belongs to a different email address"
      });
      return true;
    }

    if (isInvalidInvitation) {
      setAuthUi("error", "This invitation is no longer valid", "Please contact the organizer for a fresh invitation link.", "", {
        isError: true,
        showSignOut: false,
        error: "This invitation is no longer valid"
      });
      return true;
    }

    setAuthUi("error", "We couldn’t join this playoff", "Please try again in a moment.", "", {
      isError: true,
      showSignOut: false,
      error: "We couldn’t join this playoff"
    });
    return true;
  };

  const handleSignOut = async () => {
    const eventId = state.currentEventId;

    stopPresenceHeartbeat();
    stopPolling();

    try {
      if (eventId) {
        await api.markPlayoffPresenceOffline(eventId);
      }
    } catch (presenceError) {
      console.warn("Playoff presence offline update failed:", presenceError?.message || presenceError);
    }

    try {
      await api.signOut();
    } catch (signOutError) {
      console.error("Playoff sign-out failed:", signOutError);
    } finally {
      state.session = null;
      state.user = null;
      state.currentEventId = null;
      state.joinData = null;
      state.playerState = null;
      state.lastPlayerStateKey = "";
      state.lastStateScore = 0;
      state.feedback = "";
      state.incorrectFeedback = null;
      const invite = state.inviteToken ? `?invite=${encodeURIComponent(state.inviteToken)}` : "";
      window.location.replace(`/playoff.html${invite}`);
    }
  };

  const handleSignInSubmit = async (event) => {
    event.preventDefault();
    const emailInput = document.getElementById("playoff-auth-email");
    const passwordInput = document.getElementById("playoff-auth-password");
    const email = String(emailInput?.value || "").trim();
    const password = String(passwordInput?.value || "");

    if (!email || !password) {
      setAuthUi("error", "Please complete both fields", "Enter your email address and password to continue.", "", { isError: true, error: "Please complete both fields", email });
      renderApp();
      return;
    }

    setAuthUi("submitting", "Signing you in…", "Checking your account and invitation…", "Please wait while we verify your access.", { isError: false, email });
    renderApp();

    try {
      const signInData = await api.signInWithPassword(email, password);
      const signedInSession = signInData?.session || null;
      const signedInUser = signedInSession?.user || signInData?.user || null;

      if (!signedInSession || !signedInUser) {
        throw new Error("Authentication did not produce a user session.");
      }

      state.session = signedInSession;
      state.user = signedInUser;
      state.fatalError = false;
      setAuthUi("loading", "Joining the playoff", "Your invitation is being verified…", "Please wait while we connect you to the event.", { isError: false, email });
      renderApp();
      await joinAndRefreshState();
    } catch (error) {
      const friendly = getFriendlyAuthErrorMessage(error);
      state.session = null;
      state.user = null;
      setAuthUi(friendly.kind === "wrong_account" ? "wrong_account" : "error", friendly.title, friendly.message, friendly.detail, {
        isError: true,
        showSignOut: friendly.showSignOut,
        error: friendly.title,
        email
      });
      renderApp();
    }
  };

  const renderAuthView = () => {
    const auth = state.authUi || {};
    const isSubmitting = auth.mode === "submitting";
    const isErrorState = auth.mode === "error" || auth.mode === "wrong_account";
    const showError = Boolean(auth.error || isErrorState);
    const isLateJoinCutoff = auth.mode === "late_join_cutoff";

    root.innerHTML = `
      <main class="playoff-shell playoff-shell--auth" aria-label="Playoff sign-in shell">
        <div class="playoff-brand">The Accidental Retiree</div>
        <div class="playoff-auth-card">
          <div class="playoff-auth-badge">Private Invitation</div>
          <h1>Live Playoff</h1>
          <p class="playoff-auth-intro">${escapeHtml(auth.message || "Sign in with the email address that received this invitation.")}</p>
          <p class="playoff-auth-detail">${escapeHtml(auth.detail || "Your invitation has already been detected. After signing in, you will enter the playoff automatically.")}</p>
          ${showError && !isLateJoinCutoff ? `<div class="playoff-auth-error" role="alert">${escapeHtml(auth.error || auth.title || "We couldn’t sign you in.")}</div>` : ""}
          ${isLateJoinCutoff ? "" : `
            <form id="playoff-auth-form" class="playoff-auth-form" novalidate>
              <label class="playoff-auth-label" for="playoff-auth-email">Email address</label>
              <input
                id="playoff-auth-email"
                name="email"
                type="email"
                autocomplete="email"
                inputmode="email"
                value="${escapeHtml(auth.email || "")}"
                required
              >
              <label class="playoff-auth-label" for="playoff-auth-password">Password</label>
              <div class="playoff-auth-password-row">
                <input
                  id="playoff-auth-password"
                  name="password"
                  type="password"
                  autocomplete="current-password"
                  required
                >
                <button type="button" id="playoff-auth-toggle" class="playoff-auth-toggle">Show</button>
              </div>
              <div class="playoff-auth-actions">
                <button type="submit" class="playoff-auth-button" ${isSubmitting ? "disabled" : ""}>
                  ${isSubmitting ? "Signing In…" : "Sign In"}
                </button>
              </div>
            </form>
          `}
          ${auth.showSignOut && !isLateJoinCutoff ? `<button type="button" id="playoff-auth-signout" class="playoff-auth-link-button">Sign Out and Try Again</button>` : ""}
          ${isLateJoinCutoff ? "" : `<p class="playoff-auth-help">Need help signing in? Contact <a href="mailto:hola@theaccidentalretiree.mx">hola@theaccidentalretiree.mx</a></p>`}
        </div>
      </main>
    `;

    if (!isLateJoinCutoff) {
      const form = document.getElementById("playoff-auth-form");
      if (form) {
        form.addEventListener("submit", handleSignInSubmit);
      }

      const toggle = document.getElementById("playoff-auth-toggle");
      if (toggle) {
        toggle.addEventListener("click", () => {
          const passwordInput = document.getElementById("playoff-auth-password");
          if (!passwordInput) {
            return;
          }
          const isPassword = passwordInput.type === "password";
          passwordInput.type = isPassword ? "text" : "password";
          toggle.textContent = isPassword ? "Hide" : "Show";
        });
      }
    }

    const signOutButton = document.getElementById("playoff-auth-signout");
    if (signOutButton) {
      signOutButton.addEventListener("click", handleSignOut);
    }
  };

  const renderApp = () => {
    if (state.inviteToken && (!state.user || state.authUi.mode !== "player")) {
      renderAuthView();
      return;
    }

    const joinInfo = state.joinData || {};
    const playerState = state.playerState || {};
    const stateKey = classifyState(playerState);
    const presentation = getPlayerPresentation(playerState, joinInfo);
    const emailText = state.user?.email ? `Signed in as: ${state.user.email}` : "Signed in user";
    const eventName = playerState.event_name || joinInfo.eventName || "Live Playoff";
    const canShowAnswerForm = presentation.canSubmit
      && Boolean(playerState.question)
      && Boolean(playerState.question?.id)
      && !state.isSubmitting;

    const joinedPlayers = Array.isArray(playerState?.joinedPlayers)
      ? playerState.joinedPlayers
      : Array.isArray(playerState?.joined_players)
        ? playerState.joined_players
        : Array.isArray(presentation.waitingRoomPlayers)
          ? presentation.waitingRoomPlayers
          : [];

    const totalInvited = normalizeCountValue(
      playerState?.totalInvited
      ?? playerState?.total_invited
      ?? playerState?.totalParticipants
      ?? playerState?.participant_count
      ?? playerState?.invited_count
    );

    const joinedCount = normalizeCountValue(
      playerState?.joinedCount
      ?? playerState?.joined_count
      ?? playerState?.joinedParticipantsCount
      ?? playerState?.joined_participants_count
      ?? joinedPlayers.length
    );

    presentation.totalInvited = totalInvited ?? 1;
    presentation.joinedCount = joinedCount ?? 0;
    presentation.joinedPlayers = joinedPlayers;
    presentation.waitingRoomPlayers = joinedPlayers;

    const waitingRoomPlayers = Array.isArray(presentation.waitingRoomPlayers) ? presentation.waitingRoomPlayers : [];
    const currentPlayerDisplayName = String(
      state.user?.user_metadata?.display_name ||
      state.user?.user_metadata?.full_name ||
      state.user?.email ||
      ""
    ).trim().toLowerCase();

    state.eligibleToSubmit = canShowAnswerForm;

    const showIncorrectFeedback = Boolean(
      state.incorrectFeedback
      && presentation.mode === "answering"
      && playerState.question?.id
      && playerState.question.id === state.incorrectFeedback.questionId
      && Number(playerState.active_question_number || 0) === Number(state.incorrectFeedback.questionNumber || 0)
    );

    const renderQuestionPanel = presentation.showQuestion && playerState.question && !showIncorrectFeedback;
    const renderAnswerForm = canShowAnswerForm && !showIncorrectFeedback;

    root.innerHTML = `
      <main class="playoff-shell playoff-shell--player" aria-label="Live Playoff player shell">
        <div class="playoff-brand">The Accidental Retiree</div>
        <h1>Live Playoff</h1>
        <div class="playoff-header-row playoff-header-row--player">
          <p class="playoff-email">${emailText}</p>
          <button type="button" id="playoff-logout-btn" class="playoff-auth-link-button">Logout</button>
        </div>
        <section class="playoff-player-state-card ${presentation.cardClass}" aria-label="Player status">
          <p class="playoff-player-state-kicker">${eventName}</p>
          ${presentation.label ? `<p class="playoff-player-state-label">${presentation.label}</p>` : ""}
          <h2>${presentation.title}</h2>
          ${presentation.body.map((line) => `<p>${line}</p>`).join("")}
          ${Array.isArray(presentation.checklist) && presentation.checklist.length ? `
          <ul class="playoff-checklist">
            ${presentation.checklist.map((item) => `<li>${item}</li>`).join("")}
          </ul>
          ` : ""}
        </section>

        ${presentation.mode === "waiting_for_players" ? `
        <section class="playoff-panel playoff-waiting-room-panel" aria-label="Waiting room roster">
          <p class="playoff-panel-title">Live Waiting Room</p>
          <p class="playoff-waiting-room-counter">${presentation.joinedCount ?? 0} of ${presentation.totalInvited ?? 1} players ready</p>
          <div class="playoff-waiting-room-list">
            ${waitingRoomPlayers.map((player) => {
              const displayName = getPlayerDisplayName(player) || "A player";
              const hasJoined = Boolean(player?.has_joined || player?.joined || player?.joined_at || player?.joinedAt);
              const rosterName = displayName.trim().toLowerCase();
              const isCurrentUser = Boolean(player?.is_current_user) || (currentPlayerDisplayName && rosterName === currentPlayerDisplayName);
              const joinedAt = player?.joined_at || player?.joinedAt || null;
              const joinedLabel = hasJoined ? `${displayName} has entered the room` : `${displayName} is waiting to join`;
              const messageText = displayName ? joinedLabel : "A player has entered the room";
              return `
                <div class="playoff-waiting-room-item">
                  <div class="playoff-waiting-room-avatar">${getPlayerAvatarMarkup(player)}</div>
                  <div class="playoff-waiting-room-main">
                    <div class="playoff-waiting-room-name-row">
                      <span class="playoff-waiting-room-name">${displayName}</span>
                      ${isCurrentUser ? `<span class="playoff-pill playoff-pill--gold">You</span>` : ""}
                    </div>
                    <div class="playoff-waiting-room-meta">
                      <span class="playoff-waiting-room-message">${messageText}</span>
                    </div>
                  </div>
                </div>
              `;
            }).join("")}
          </div>
          <p class="playoff-waiting-room-footer">Waiting for Host to Begin Game</p>
        </section>
        ` : ""}

        ${renderQuestionPanel ? `
        <section class="playoff-panel playoff-question-panel" aria-label="Active question">
          <p class="playoff-prompt">${playerState.question.prompt || ""}</p>
        </section>
        ` : ""}

        ${renderAnswerForm ? `
        <form id="playoff-answer-form" class="playoff-answer-form" novalidate>
          <label for="playoff-answer-input">Your answer</label>
          <input
            id="playoff-answer-input"
            name="answer"
            type="text"
            autocomplete="off"
          >
          <button type="submit">
            ${state.isSubmitting ? "Submitting..." : "Submit"}
          </button>
        </form>
        ` : ""}

        ${showIncorrectFeedback ? `
        <section class="playoff-feedback-card playoff-feedback-card--error" aria-label="Incorrect answer feedback">
          <p class="playoff-feedback-card__title">That answer wasn't correct.</p>
          <p>Your answer has been received, but it isn’t the correct solution.</p>
          <p>Take another look at the clue and try again.</p>
          <button type="button" id="playoff-try-again-btn" class="playoff-feedback-card__button">Try Again</button>
        </section>
        ` : ""}

        ${state.feedback && presentation.mode === "answering" ? `<p class="playoff-feedback">${state.feedback}</p>` : ""}
      </main>
    `;

    const form = document.getElementById("playoff-answer-form");
    if (form) {
      form.addEventListener("submit", handleSubmit);
    }

    const tryAgainButton = document.getElementById("playoff-try-again-btn");
    if (tryAgainButton) {
      tryAgainButton.addEventListener("click", () => {
        state.incorrectFeedback = null;
        state.feedback = "";
        renderApp();
        const input = document.getElementById("playoff-answer-input");
        if (input instanceof HTMLInputElement) {
          input.value = "";
          window.requestAnimationFrame(() => input.focus());
        }
      });
    }

    const logoutButton = document.getElementById("playoff-logout-btn");
    if (logoutButton) {
      logoutButton.addEventListener("click", handleSignOut);
    }
  };

  const refreshPlayerState = async () => {
    if (!state.currentEventId) return;
    const playerStateRaw = await api.getPlayerState(state.currentEventId);
    state.playerState = Array.isArray(playerStateRaw) ? playerStateRaw[0] : playerStateRaw;
  };

  const buildPlayerStateKey = (playerState) => {
    const question = playerState?.question || {};
    const roster = Array.isArray(playerState?.waiting_room_players)
      ? playerState.waiting_room_players
      : Array.isArray(playerState?.waitingRoomPlayers)
        ? playerState.waitingRoomPlayers
        : Array.isArray(playerState?.participants)
          ? playerState.participants
          : [];
    const rosterSignature = roster.map((player) => [
      String(player?.display_name || player?.displayName || "").trim().toLowerCase(),
      Boolean(player?.has_joined),
      Boolean(player?.is_current_user)
    ].join("|")).join(";");
    return JSON.stringify({
      eventStatus: playerState?.event_status || "",
      participantStatus: playerState?.participant_status || "",
      participantCurrentStatus: playerState?.current_status || "",
      activeQuestionNumber: Number(playerState?.active_question_number || 0),
      questionId: question?.id || "",
      questionPrompt: question?.prompt || "",
      questionOpen: Boolean(playerState?.question?.id),
      questionOpenedAt: question?.opened_at || playerState?.opened_at || "",
      acceptedPosition: playerState?.accepted_position ?? null,
      submissionStatus: playerState?.submission_status || "",
      isWinner: Boolean(playerState?.is_winner),
      isFinalist: Boolean(playerState?.is_finalist),
      eliminatedAt: playerState?.eliminated_at || "",
      waitingRoomRoster: rosterSignature
    });
  };

  const clearPollTimer = () => {
    if (state.pollTimerId) {
      window.clearTimeout(state.pollTimerId);
      state.pollTimerId = null;
    }
  };

  const scheduleNextPoll = () => {
    clearPollTimer();
    if (state.fatalError || state.pollSuspended || !state.user || !state.currentEventId) {
      return;
    }
    state.pollTimerId = window.setTimeout(() => {
      void pollPlayerState();
    }, POLL_INTERVAL_MS);
  };

  const stopPolling = ({ suspend = false } = {}) => {
    clearPollTimer();
    state.pollInFlight = false;
    state.pollSuspended = suspend;
  };

  const clearPresenceTimer = () => {
    if (state.presenceTimerId) {
      window.clearTimeout(state.presenceTimerId);
      state.presenceTimerId = null;
    }
  };

  const stopPresenceHeartbeat = () => {
    clearPresenceTimer();
    state.presenceInFlight = false;
    state.presenceActive = false;
  };

  const scheduleNextPresenceHeartbeat = () => {
    clearPresenceTimer();
    if (!state.presenceActive || state.fatalError || !state.user || !state.currentEventId) {
      return;
    }

    state.presenceTimerId = window.setTimeout(() => {
      void sendPresenceHeartbeat();
    }, PRESENCE_HEARTBEAT_INTERVAL_MS);
  };

  const sendPresenceHeartbeat = async () => {
    if (state.presenceInFlight || !state.presenceActive || state.fatalError || !state.user || !state.currentEventId) {
      return;
    }

    state.presenceInFlight = true;
    try {
      await api.touchPlayoffPresence(state.currentEventId);
    } catch (presenceError) {
      console.warn("Playoff presence heartbeat failed:", presenceError?.message || presenceError);
    } finally {
      state.presenceInFlight = false;
      if (state.presenceActive && !state.fatalError && state.user && state.currentEventId) {
        scheduleNextPresenceHeartbeat();
      }
    }
  };

  const startPresenceHeartbeat = () => {
    if (state.fatalError || !state.user || !state.currentEventId) {
      return;
    }

    state.presenceActive = true;
    scheduleNextPresenceHeartbeat();
    void sendPresenceHeartbeat();
  };

  const pollPlayerState = async () => {
    if (state.pollInFlight || state.fatalError || state.pollSuspended || !state.user || !state.currentEventId || state.isSubmitting) {
      return;
    }

    state.pollInFlight = true;
    try {
      const session = await api.getSession();
      if (!session?.user) {
        state.session = null;
        state.user = null;
        state.feedback = "";
        stopPolling();
        setAuthUi("signin", "Welcome to the Live Playoff", "Sign in with the email address that received this invitation.", "Your invitation has already been detected. After signing in, you will enter the playoff automatically.", { isError: false, showSignOut: false });
        renderApp();
        return;
      }

      state.session = session;
      state.user = session.user;

      const playerStateRaw = await api.getPlayerState(state.currentEventId);
      const nextPlayerState = Array.isArray(playerStateRaw) ? playerStateRaw[0] : playerStateRaw;
      const nextKey = buildPlayerStateKey(nextPlayerState);
      const nextScore = getPlayerStateScore(nextPlayerState);
      const changed = nextKey !== state.lastPlayerStateKey;

      if (shouldIgnorePollUpdate(state.playerState, nextPlayerState)) {
        return;
      }

      const previousPlayerState = state.playerState;
      state.playerState = nextPlayerState;
      state.lastPlayerStateKey = nextKey;
      state.lastStateScore = nextScore;

      if (changed) {
        if (!isOfficialWinner(previousPlayerState) && isOfficialWinner(state.playerState)) {
          const celebrationSignature = `winner:${Number(state.playerState?.active_question_number || 0)}:${getWinnerParticipantId(state.playerState) || getParticipantId(state.playerState) || "winner"}`;
          if (celebrationSignature !== state.lastCelebratedSignature) {
            state.lastCelebratedSignature = celebrationSignature;
            launchCelebration("winner");
          }
        }
        state.feedback = "";
        if (hasProgressedBeyondIncorrectFeedback(nextPlayerState, state.incorrectFeedback)) {
          state.incorrectFeedback = null;
        }
        renderApp();
      }
    } catch (error) {
      console.error("Playoff player polling failed:", {
        message: error?.message,
        code: error?.code,
        details: error?.details,
        hint: error?.hint
      });

      if (!state.user || !state.currentEventId) {
        state.fatalError = true;
        stopPolling();
        renderShell("playoff-status--error", "Playoff state could not be refreshed.");
        return;
      }
    } finally {
      state.pollInFlight = false;
      if (!state.fatalError && !state.pollSuspended && state.user && state.currentEventId) {
        scheduleNextPoll();
      }
    }
  };

  const startPolling = () => {
    if (state.fatalError || !state.user || !state.currentEventId) {
      return;
    }
    state.pollSuspended = false;
    scheduleNextPoll();
  };

  const joinAndRefreshState = async () => {
    try {
      const joinRaw = await api.joinPlayoff(state.inviteToken);
      state.joinData = parseJoinData(joinRaw);
      state.currentEventId = state.joinData.eventId;
      await refreshPlayerState();
      state.lastPlayerStateKey = buildPlayerStateKey(state.playerState);
      state.lastStateScore = getPlayerStateScore(state.playerState);
      setAuthUi("player", "", "", "", { isError: false, showSignOut: false });
      renderApp();
      startPolling();
      startPresenceHeartbeat();
      return true;
    } catch (error) {
      handleJoinFailure(error);
      renderApp();
      return false;
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const activeQuestionId = state.playerState?.question?.id;
    if (state.isSubmitting || !state.eligibleToSubmit || !activeQuestionId) {
      return;
    }

    const input = document.getElementById("playoff-answer-input");
    const submittedAnswer = String(input?.value || "").trim();
    if (!submittedAnswer) {
      state.feedback = "Enter an answer before submitting.";
      renderApp();
      return;
    }

    state.isSubmitting = true;
    state.feedback = "Submitting answer...";
    renderApp();

    try {
      const submissionId = crypto.randomUUID();
      const result = await api.submitAnswer(activeQuestionId, submittedAnswer, submissionId);
      const payload = Array.isArray(result) ? result[0] : result;
      const duplicateRetry = Boolean(payload?.duplicate_retry);
      const correct = payload?.correct === true || payload?.is_correct === true;
      const eliminated = payload?.eliminated === true || containsAny(payload?.participant_status, ["eliminated", "out"]);
      const winner = payload?.winner === true || containsAny(payload?.participant_status, ["winner"]);
      const roundNumber = Number(payload?.question_number || state.playerState?.active_question_number || 0);

      if (!correct) {
        state.feedback = "";
        state.incorrectFeedback = {
          questionId: activeQuestionId,
          questionNumber: Number(state.playerState?.active_question_number || state.playerState?.question?.question_number || 0),
          signature: getIncorrectFeedbackSignature(state.playerState, activeQuestionId)
        };

        if (input) {
          input.value = "";
        }

        renderApp();
        return;
      }

      state.feedback = "";
      state.incorrectFeedback = null;

      if (duplicateRetry) {
        state.feedback = "";
      }

      const mergedPlayerState = mergePlayerState(state.playerState, payload);
      const mergedPresentation = getPlayerPresentation(mergedPlayerState, state.joinData || {});
      const shouldApplyMergedState = correct || mergedPresentation.mode !== "answering";

      if (shouldApplyMergedState) {
        state.playerState = mergedPlayerState;
        state.lastPlayerStateKey = buildPlayerStateKey(state.playerState);
        state.lastStateScore = getPlayerStateScore(state.playerState);
      }

      if (state.incorrectFeedback && getPlayerPresentation(state.playerState, state.joinData || {}).mode !== "answering") {
        state.incorrectFeedback = null;
      }

      if (input) {
        input.value = "";
      }

      renderApp();

      if (correct && (roundNumber === 1 || roundNumber === 2 || isOfficialWinner(mergedPlayerState))) {
        const celebrationSignature = isOfficialWinner(mergedPlayerState)
          ? `winner:${roundNumber}:${getWinnerParticipantId(mergedPlayerState) || getParticipantId(mergedPlayerState) || "winner"}`
          : `round:${roundNumber}`;
        if (celebrationSignature !== state.lastCelebratedSignature) {
          state.lastCelebratedSignature = celebrationSignature;
          launchCelebration(isOfficialWinner(mergedPlayerState) ? "winner" : "round");
        }
      }
    } catch (submitError) {
      state.feedback = "Answer submission failed. Please try again.";
      console.error("Playoff answer submission failed:", {
        message: submitError?.message,
        code: submitError?.code,
        details: submitError?.details,
        hint: submitError?.hint
      });
      renderApp();
    } finally {
      state.isSubmitting = false;
      renderApp();
    }
  };

  renderShell("playoff-status--loading", "Checking your session…");

  (async () => {
    try {
      const url = new URL(window.location.href);
      const inviteFromUrl = String(url.searchParams.get("invite") || "").trim();

      if (!inviteFromUrl) {
        renderShell(
          "playoff-status--error",
          "Invalid invitation link.",
          "",
          "An invite token is required to join this playoff event."
        );
        return;
      }

      state.inviteToken = inviteFromUrl;

      const session = await api.getSession();
      state.session = session;
      state.user = session?.user || null;

      if (!state.user) {
        setAuthUi("signin", "Welcome to the Live Playoff", "Sign in with the email address that received this invitation.", "Your invitation has already been detected. After signing in, you will enter the playoff automatically.", { isError: false, showSignOut: false });
        renderApp();
        return;
      }

      await joinAndRefreshState();
    } catch (error) {
      state.fatalError = true;
      stopPolling();
      stopPresenceHeartbeat();
      if (!state.user) {
        renderShell("playoff-status--error", "Playoff authentication could not be initialized.");
      } else {
        renderShell("playoff-status--error", "Playoff join failed.", `Signed in as: ${state.user.email || "player"}`);
      }
      console.error("Playoff player initialization failed:", {
        message: error?.message,
        code: error?.code,
        details: error?.details,
        hint: error?.hint
      });
    }
  })();

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopPolling({ suspend: true });
      return;
    }

    if (!state.fatalError && state.user && state.currentEventId) {
      startPolling();
    }
  });

  window.addEventListener("beforeunload", clearCelebration);

  console.log("Playoff app initialized");
})();
