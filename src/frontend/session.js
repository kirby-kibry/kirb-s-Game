/**
 * session.js — remembers who is signed in, and which canvas border they picked.
 *
 * The browser stores the login token and the player's id and username. The
 * token is the part that matters: it is what proves to the server who is
 * asking, and it is attached to every request by api.js.
 *
 * Scores and points are never stored here. They are always re-fetched from the
 * API so they cannot be edited from the console — and editing the stored token
 * does not help either, because a changed token no longer matches its signature
 * and the server rejects it.
 */

const SESSION_KEY = 'kibry-session';
const TOKEN_KEY = 'kibry-token';
const BORDER_KEY = 'kibry-border';

/** Save the signed-in player and the token that proves it. */
export const saveSession = (token, user) => {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(SESSION_KEY, JSON.stringify({ user_id: user.user_id, username: user.username }));
};

/** Get the signed-in player, or null when nobody is signed in. */
export const loadSession = () => {
  const raw = localStorage.getItem(SESSION_KEY);

  if (!raw || !loadToken()) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/** Get the stored login token, or null when there isn't one. */
export const loadToken = () => localStorage.getItem(TOKEN_KEY);

/** Sign the current player out. */
export const clearSession = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(BORDER_KEY);
};

/** Send the visitor back to the game page if they are not signed in. */
export const requireSession = () => {
  const session = loadSession();

  if (!session) {
    window.location.href = 'index.html';
    return null;
  }

  return session;
};

/** Remember which owned cosmetic the player equipped. */
export const saveEquippedBorder = (cosmetic) => {
  if (!cosmetic) {
    localStorage.removeItem(BORDER_KEY);
    return;
  }

  localStorage.setItem(BORDER_KEY, JSON.stringify(cosmetic));
};

/** Get the equipped cosmetic, or null when the plain border is in use. */
export const loadEquippedBorder = () => {
  const raw = localStorage.getItem(BORDER_KEY);

  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};
