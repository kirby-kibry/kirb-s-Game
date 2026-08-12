import { validationResult } from 'express-validator';
import {
  findAllUsers,
  findTopUsers,
  findUserById,
  findUserByUsernameWithPassword,
  insertUser,
  updateUser,
  removeUser,
} from '../models/userModel.js';
import { AppError } from '../utils/_errors.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { signToken } from '../utils/token.js';

/** Throw a validation error if express-validator found problems. */
const assertValid = (req) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) throw new AppError('VALIDATION_ERROR', errors.array()[0].msg);
};

/** Get all users. Supports ?username= filter. */
export const getAllUsers = async (req, res, next) => {
  try {
    const filters = {};
    if (req.query.username) filters.username = req.query.username;

    const users = await findAllUsers(filters);
    res.status(200).json(users);
  } catch (error) {
    next(error);
  }
};

/** Get the top players for the leaderboard. Supports ?limit=. */
export const getLeaderboard = async (req, res, next) => {
  try {
    assertValid(req);

    const limit = req.query.limit ? Number(req.query.limit) : 10;
    const users = await findTopUsers(limit);
    res.status(200).json(users);
  } catch (error) {
    next(error);
  }
};

/** Get a single user by ID. */
export const getUserById = async (req, res, next) => {
  try {
    const user = await findUserById(req.params.id);

    if (!user) throw new AppError('NOT_FOUND', 'User not found');

    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
};

/**
 * Register a new user. The password is hashed before it is stored.
 *
 * A token comes back with the new account so signing up drops you straight
 * into the game — registering already proves who you are, so making the browser
 * turn round and log in again would be a round trip for nothing.
 */
export const createUser = async (req, res, next) => {
  try {
    assertValid(req);

    const { username, password } = req.body;

    const existing = await findUserByUsernameWithPassword(username);
    if (existing) throw new AppError('CONFLICT', 'Username already exists');

    const user = await insertUser({
      username,
      password: await hashPassword(password),
    });

    res.status(201).json({ token: signToken(user), user });
  } catch (error) {
    next(error);
  }
};

/**
 * Log in with a username and password.
 *
 * Returns the same `{ token, user }` shape as registering, so the browser has
 * one code path for both. The token is what proves who the player is on every
 * request after this one.
 */
export const loginUser = async (req, res, next) => {
  try {
    assertValid(req);

    const { username, password } = req.body;

    const user = await findUserByUsernameWithPassword(username);

    // Same error whether the username or the password was wrong, so the
    // response never reveals which usernames exist.
    if (!user || !(await verifyPassword(password, user.password))) {
      throw new AppError('UNAUTHORIZED');
    }

    // Built by hand rather than spreading `user`, so the password hash cannot
    // slip into the response by accident.
    const profile = {
      user_id: user.user_id,
      username: user.username,
      total_score: user.total_score,
      points: user.points,
    };

    res.status(200).json({ token: signToken(profile), user: profile });
  } catch (error) {
    next(error);
  }
};

/**
 * Update a user's username by ID.
 *
 * `total_score` and `points` are deliberately NOT updatable here — they are
 * earned through gameplay, and letting a client set them directly would make
 * the leaderboard meaningless.
 */
export const updateUserById = async (req, res, next) => {
  try {
    assertValid(req);

    const data = {};
    if (req.body.username !== undefined) data.username = req.body.username;

    if (Object.keys(data).length === 0) {
      throw new AppError('VALIDATION_ERROR', 'Nothing to update');
    }

    const duplicate = await findUserByUsernameWithPassword(data.username);
    if (duplicate && duplicate.user_id !== req.params.id) {
      throw new AppError('CONFLICT', 'Username already exists');
    }

    const user = await updateUser(req.params.id, data);

    if (!user) throw new AppError('NOT_FOUND', 'User not found');

    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
};

/** Delete a user by ID. Their games, guesses and cosmetics are removed with them. */
export const deleteUser = async (req, res, next) => {
  try {
    const user = await removeUser(req.params.id);

    if (!user) throw new AppError('NOT_FOUND', 'User not found');

    res.status(204).end();
  } catch (error) {
    next(error);
  }
};
