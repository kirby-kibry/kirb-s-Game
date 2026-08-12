/**
 * JSON Web Token helpers — how the server remembers who is signed in.
 *
 * There are no server-side sessions. On a successful login the server signs a
 * token containing the player's id and username, and the browser sends that
 * token back on every later request. Because the token is signed with a secret
 * only the server knows, the browser cannot edit the id inside it to pretend to
 * be somebody else — any tampering breaks the signature and verification fails.
 *
 * These functions deliberately know nothing about HTTP. Turning a bad token
 * into a 401 response is the middleware's job, which keeps this file usable
 * from anywhere and matches how the models stay free of request handling.
 */

import jwt from 'jsonwebtoken';

/**
 * Fallback secret so a fresh clone runs without any setup. `.env` is not
 * committed, so a real secret cannot ship with the project — anything
 * deployed for real must set JWT_SECRET instead of relying on this.
 */
const DEV_SECRET = 'kibry-dev-secret-set-JWT_SECRET-in-env';

/** How long a token stays valid. Long enough for a play session, not forever. */
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '2h';

if (!process.env.JWT_SECRET) {
  console.warn('JWT_SECRET is not set — falling back to the development secret. Set JWT_SECRET in .env before deploying.');
}

/** The signing secret, read at call time so tests can change it if they need to. */
const getSecret = () => process.env.JWT_SECRET || DEV_SECRET;

/**
 * Sign a token for a player who has just proved who they are.
 *
 * Only the id and username go in. A token is readable by anyone holding it, so
 * nothing private belongs inside — and scores are left out so they can never go
 * stale, since every response reads them fresh from the database.
 *
 * @param {{user_id: string, username: string}} user - The player logging in.
 * @returns {string} A signed JWT.
 */
export const signToken = (user) => {
  return jwt.sign(
    { user_id: user.user_id, username: user.username },
    getSecret(),
    { expiresIn: EXPIRES_IN }
  );
};

/**
 * Check a token's signature and expiry.
 * @param {string} token - The token from the Authorization header.
 * @returns {{user_id: string, username: string}|null} The payload, or null when
 *   the token is missing, tampered with, or past its expiry.
 */
export const verifyToken = (token) => {
  try {
    return jwt.verify(token, getSecret());
  } catch {
    return null;
  }
};
