/**
 * Authentication middleware.
 *
 * `requireAuth` is the gate in front of every route that needs a signed-in
 * player. It reads the token, checks it, and hangs the player it belongs to on
 * `req.user` so the controller behind it can trust who is asking.
 *
 * This is the reason controllers no longer read `user_id` out of the request
 * body. A body is just text the browser typed — anyone could put somebody
 * else's id in it and spend their points. A token is signed by the server, so
 * `req.user.user_id` is the one piece of identity a client cannot forge.
 */

import { verifyToken } from '../utils/token.js';
import { AppError } from '../utils/_errors.js';

/**
 * Pull the token out of an `Authorization: Bearer <token>` header.
 * @param {import('express').Request} req - The incoming request.
 * @returns {string|null} The token, or null when the header is missing or malformed.
 */
const readBearerToken = (req) => {
  const header = req.headers.authorization;

  if (!header) return null;

  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) return null;

  return token;
};

/**
 * Reject anyone without a valid token, and identify everyone who has one.
 *
 * Sets `req.user` to `{ user_id, username }` on success. Both failure cases
 * answer 401 — the client's fix for either one is the same, which is to sign in
 * again — but the messages differ so the page can say something useful.
 */
export const requireAuth = (req, res, next) => {
  const token = readBearerToken(req);

  if (!token) {
    return next(new AppError('UNAUTHORIZED', 'You must be signed in to do that'));
  }

  const payload = verifyToken(token);

  if (!payload) {
    return next(new AppError('UNAUTHORIZED', 'Your session has expired — please sign in again'));
  }

  req.user = { user_id: payload.user_id, username: payload.username };

  next();
};

/**
 * Only let a player act on their own account.
 *
 * Guards the routes where the target is named in the path — renaming and
 * deleting a user — so that being signed in as somebody is not the same as
 * being allowed to edit everybody. Must be registered after `requireAuth`,
 * which is what puts `req.user` there in the first place.
 */
export const requireSelf = (req, res, next) => {
  if (req.user.user_id !== req.params.id) {
    return next(new AppError('UNAUTHORIZED', 'You can only change your own account'));
  }

  next();
};
