/**
 * api.js — one place for every call to the backend.
 *
 * Two things happen here that every page relies on:
 *
 * 1. The login token is attached to every request, so protected endpoints know
 *    who is asking. Nothing else in the frontend has to think about it.
 * 2. Failures are unwrapped. The server always reports them as
 *    { error: { code, message, status } }, which becomes a normal thrown Error
 *    carrying the message the page can show.
 *
 * Because the server works out who you are from the token, none of these
 * functions take a user id any more.
 */

import { loadToken, clearSession } from './session.js';

/** The event pages listen for when a login stops being valid. */
export const SESSION_EXPIRED_EVENT = 'kibry:session-expired';

/** The Authorization header, or nothing at all when signed out. */
const authHeaders = () => {
  const token = loadToken();

  return token ? { Authorization: `Bearer ${token}` } : {};
};

/**
 * Make a request and return the parsed JSON body.
 *
 * A 401 while holding a token means the token has expired or been rejected, so
 * the stale login is thrown away and the page is told to react. A 401 without a
 * token is just a failed sign-in attempt, which is the caller's to report.
 *
 * @param {string} url - The endpoint to call.
 * @param {Object} [options] - Extra fetch options.
 * @returns {Promise<Object|null>} Parsed body, or null for a 204 response.
 */
const request = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });

  if (response.status === 401 && loadToken()) {
    clearSession();
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    throw new Error('Your session has expired — please sign in again.');
  }

  if (response.status === 204) return null;

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = data && data.error ? data.error.message : 'Something went wrong';
    throw new Error(message);
  }

  return data;
};

/** Send a JSON body with the right Content-Type header. */
const sendJson = async (url, method, body) => {
  return await request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
};

// --- Users ---

/** Register a new player. Returns { token, user } — signing up signs you in. */
export const registerUser = async (username, password) => {
  return await sendJson('/api/users', 'POST', { username, password });
};

/** Log in. Returns { token, user }. */
export const loginUser = async (username, password) => {
  return await sendJson('/api/users/login', 'POST', { username, password });
};

/** Fetch a single player's current profile (score and points). */
export const fetchUser = async (userId) => {
  return await request(`/api/users/${userId}`);
};

/** Fetch the top players. */
export const fetchLeaderboard = async (limit = 10) => {
  return await request(`/api/users/leaderboard?limit=${limit}`);
};

// --- Games ---

/** Open a room as the drawer, and wait for a human guesser. */
export const createGame = async (difficulty) => {
  return await sendJson('/api/games', 'POST', { difficulty, opponent: 'player' });
};

/** Start a practice round where Kibry Bot draws and you guess. */
export const createPracticeGame = async (difficulty) => {
  return await sendJson('/api/games', 'POST', { difficulty, opponent: 'bot' });
};

/** Join somebody else's room as the guesser. */
export const joinGame = async (roomCode) => {
  return await sendJson('/api/games/join', 'POST', { room_code: roomCode });
};

/** Fetch the two-player rooms that are still waiting for a guesser. */
export const fetchOpenGames = async () => {
  return await request('/api/games?status=waiting&mode=pvp');
};

/**
 * Fetch the current state of a round. Both browsers poll this about once a
 * second. The prompt word only comes back for the drawer, which the server
 * works out from the token rather than trusting the browser to say.
 */
export const fetchGameState = async (gameId) => {
  return await request(`/api/games/${gameId}/state`);
};

/** Fetch the drawer's latest picture. */
export const fetchGameCanvas = async (gameId) => {
  return await request(`/api/games/${gameId}/canvas`);
};

/** Send the drawer's picture up so the guesser can see it. */
export const sendGameCanvas = async (gameId, canvasData) => {
  return await sendJson(`/api/games/${gameId}/canvas`, 'PUT', { canvas_data: canvasData });
};

/** Send a guess. A correct one ends the round and pays both players. */
export const sendGuess = async (gameId, guess) => {
  return await sendJson(`/api/games/${gameId}/guesses`, 'POST', { guess });
};

/** Quit a round early. Nobody scores. */
export const endGame = async (gameId) => {
  return await sendJson(`/api/games/${gameId}/end`, 'POST', {});
};

// --- Cosmetics ---

/** Fetch the whole shop catalog. */
export const fetchShop = async () => {
  return await request('/api/cosmetics');
};

/** Fetch the cosmetics a player owns. */
export const fetchOwnedCosmetics = async (userId) => {
  return await request(`/api/users/${userId}/cosmetics`);
};

/** Buy a cosmetic. The buyer comes from the token. */
export const buyCosmetic = async (cosmeticId) => {
  return await sendJson(`/api/cosmetics/${cosmeticId}/buy`, 'POST', {});
};
