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

/**
 * Shared session access for player and host experiences.
 * @returns {Promise<any>} Session data promise.
 * @who Shared
 */
async function getSession() {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data?.session || null;
}

async function signInWithPassword(email, password) {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password
  });
  if (error) throw error;
  return data;
}

async function signOut() {
  const client = getSupabaseClient();
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

/**
 * Shared contest access for player and host experiences.
 * @returns {Promise<any>} Contest data promise.
 * @throws {Error} Always throws "Not implemented".
 * @who Shared
 */
function getContest() {
  throw new Error("Not implemented");
}

function rpcError(error) {
  return {
    message: error?.message || "RPC request failed",
    code: error?.code,
    details: error?.details,
    hint: error?.hint
  };
}

function normalizeCount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function normalizePlayerStatePayload(payload) {
  const state = Array.isArray(payload) ? payload[0] : payload;
  if (!state || typeof state !== "object") {
    return payload;
  }

  const joinedPlayers = Array.isArray(state.joinedPlayers)
    ? state.joinedPlayers
    : Array.isArray(state.joined_players)
      ? state.joined_players
      : Array.isArray(state.waiting_room_players)
        ? state.waiting_room_players.filter((player) => {
          const joinedAt = player?.joined_at || player?.joinedAt || "";
          return Boolean(player?.has_joined || player?.joined || joinedAt);
        })
        : [];

  return {
    ...state,
    totalInvited: normalizeCount(state.totalInvited ?? state.total_invited ?? state.totalParticipants ?? state.participant_count ?? state.invited_count),
    joinedCount: normalizeCount(state.joinedCount ?? state.joined_count ?? state.joinedParticipantsCount ?? state.joined_participants_count ?? joinedPlayers.length),
    joinedPlayers,
    waitingRoomPlayers: joinedPlayers,
    waiting_room_players: joinedPlayers
  };
}

/**
 * Join or reconnect a player to a playoff event using an invitation token.
 * @param {string} invitationToken Private invitation token from URL.
 * @returns {Promise<any>} Join payload from join_playoff.
 */
async function joinPlayoff(invitationToken) {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc("join_playoff", {
    input_invitation_token: invitationToken
  });
  if (error) throw error;
  return data;
}

/**
 * Shared player state access for the current authenticated player and event.
 * @param {string} eventId Event identifier.
 * @returns {Promise<any>} Player-safe state payload.
 */
async function getPlayerState(eventId) {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc("get_playoff_player_state", {
    input_event_id: eventId
  });

  if (error) throw rpcError(error);
  return normalizePlayerStatePayload(data);
}

async function touchPlayoffPresence(eventId) {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc("touch_playoff_presence", {
    input_event_id: eventId
  });

  if (error) throw rpcError(error);
  return data;
}

async function markPlayoffPresenceOffline(eventId) {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc("mark_playoff_presence_offline", {
    input_event_id: eventId
  });

  if (error) throw rpcError(error);
  return data;
}

/**
 * Submit a player answer for a specific question.
 * @param {string} questionId Question identifier.
 * @param {string} answer Player submission text.
 * @param {string} clientSubmissionId Idempotency key for duplicate retries.
 * @returns {Promise<any>} Submission result promise.
 * @who Player
 */
async function submitAnswer(questionId, answer, clientSubmissionId) {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc("submit_playoff_answer", {
    input_question_id: questionId,
    input_answer: answer,
    input_client_submission_id: clientSubmissionId
  });
  if (error) throw error;
  return data;
}

/**
 * Shared host state access for the current contest.
 * @param {string} eventId Event identifier.
 * @returns {Promise<any>} Host state promise.
 * @who Host
 */
async function getHostState(eventId) {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc("get_playoff_host_state", {
    input_event_id: eventId
  });

  if (error) throw rpcError(error);
  return data;
}

/**
 * Configure the playoff question advancement rules for the current event.
 * @param {string} eventId Event identifier.
 * @param {{q1Mode:string,q1Limit:number|null,q2Mode:string,q2Limit:number|null}} config Setup payload.
 * @returns {Promise<any>} Host state payload from the configuration RPC.
 * @who Host
 */
async function configureQuestions(eventId, config) {
  const client = getSupabaseClient();
  const q1Mode = String(config?.q1Mode || "all_correct").trim().toLowerCase();
  const q2Mode = String(config?.q2Mode || "all_correct").trim().toLowerCase();
  const q1Limit = q1Mode === "first_n" ? config?.q1Limit ?? null : null;
  const q2Limit = q2Mode === "first_n" ? config?.q2Limit ?? null : null;

  const { data, error } = await client.rpc("host_configure_playoff_questions", {
    input_event_id: eventId,
    input_q1_mode: q1Mode === "first_n" ? "first_n" : "all_correct",
    input_q1_limit: q1Limit,
    input_q2_mode: q2Mode === "first_n" ? "first_n" : "all_correct",
    input_q2_limit: q2Limit
  });

  if (error) throw rpcError(error);
  return data;
}

/**
 * Run a host recovery action for the current playoff event.
 * @param {string} eventId Event identifier.
 * @param {string} action Recovery action such as full_reset.
 * @returns {Promise<any>} Host state payload from the recovery RPC.
 * @who Host
 */
async function recoverEvent(eventId, action) {
  const client = getSupabaseClient();
  const normalizedAction = String(action || "").trim().toLowerCase();
  const { data, error } = await client.rpc("host_recover_playoff_event", {
    input_event_id: eventId,
    input_action: normalizedAction
  });

  if (error) throw rpcError(error);
  return data;
}

/**
 * Reset the playoff runtime back to the waiting room while preserving the event and configuration.
 * @param {string} eventId Event identifier.
 * @returns {Promise<any>} Host state payload from the reset RPC.
 * @who Host
 */
async function resetToWaiting(eventId) {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc("host_reset_playoff_to_waiting", {
    input_event_id: eventId
  });

  if (error) throw rpcError(error);
  return data;
}

/**
 * Open a question for contest play.
 * @param {string} questionId Question identifier.
 * @returns {Promise<any>} Host action result promise.
 * @throws {Error} Always throws "Not implemented".
 * @who Host
 */
function openQuestion(questionId) {
  void questionId;
  throw new Error("Not implemented");
}

/**
 * Close a question to prevent further submissions.
 * @param {string} questionId Question identifier.
 * @returns {Promise<any>} Host action result promise.
 * @throws {Error} Always throws "Not implemented".
 * @who Host
 */
function closeQuestion(questionId) {
  void questionId;
  throw new Error("Not implemented");
}

/**
 * Advance the contest to the next question.
 * @returns {Promise<any>} Host action result promise.
 * @throws {Error} Always throws "Not implemented".
 * @who Host
 */
function advanceQuestion() {
  throw new Error("Not implemented");
}

/**
 * Pause the contest.
 * @returns {Promise<any>} Host action result promise.
 * @throws {Error} Always throws "Not implemented".
 * @who Host
 */
function pauseContest() {
  throw new Error("Not implemented");
}

/**
 * Resume the contest after a pause.
 * @returns {Promise<any>} Host action result promise.
 * @throws {Error} Always throws "Not implemented".
 * @who Host
 */
function resumeContest() {
  throw new Error("Not implemented");
}

/**
 * Lock the winner for the contest.
 * @param {string} playerId Winner player identifier.
 * @returns {Promise<any>} Winner lock result promise.
 * @throws {Error} Always throws "Not implemented".
 * @who Host
 */
function lockWinner(playerId) {
  void playerId;
  throw new Error("Not implemented");
}

/**
 * Reset the contest to its initial state.
 * @returns {Promise<any>} Reset result promise.
 * @throws {Error} Always throws "Not implemented".
 * @who Host
 */
function resetContest() {
  throw new Error("Not implemented");
}

export const PlayoffAPI = {
  getSession,
  signInWithPassword,
  signOut,
  getContest,
  getPlayerState,
  touchPlayoffPresence,
  markPlayoffPresenceOffline,
  joinPlayoff,
  submitAnswer,
  getHostState,
  configureQuestions,
  recoverEvent,
  resetToWaiting,
  openQuestion,
  closeQuestion,
  advanceQuestion,
  pauseContest,
  resumeContest,
  lockWinner,
  resetContest
};
