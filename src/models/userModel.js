import { eq, like, desc } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';

export { users };

/**
 * Columns that are safe to send to the browser.
 * The password hash is deliberately excluded from every public query.
 */
const publicUserColumns = {
  user_id: users.user_id,
  username: users.username,
  total_score: users.total_score,
  points: users.points,
};

/** Get all users, newest-highest score first. Supports optional `?username=` search filter. */
export const findAllUsers = async (filters = {}) => {
  if (filters.username) {
    return await db
      .select(publicUserColumns)
      .from(users)
      .where(like(users.username, `%${filters.username}%`))
      .orderBy(desc(users.total_score));
  }

  return await db.select(publicUserColumns).from(users).orderBy(desc(users.total_score));
};

/** Get the top-scoring users for the leaderboard. */
export const findTopUsers = async (limit = 10) => {
  return await db.select(publicUserColumns).from(users).orderBy(desc(users.total_score)).limit(limit);
};

/** Get a single user by ID, without the password hash. Returns undefined if not found. */
export const findUserById = async (id) => {
  const rows = await db.select(publicUserColumns).from(users).where(eq(users.user_id, id));
  return rows[0];
};

/**
 * Get a full user row by username, including the password hash.
 * Only for internal use — logging in and checking for duplicate usernames.
 */
export const findUserByUsernameWithPassword = async (username) => {
  const rows = await db.select().from(users).where(eq(users.username, username));
  return rows[0];
};

/** Create a new user. Returns the new user without the password hash. */
export const insertUser = async (data) => {
  const rows = await db.insert(users).values(data).returning(publicUserColumns);
  return rows[0];
};

/** Update a user by ID. Returns undefined if not found. */
export const updateUser = async (id, data) => {
  const rows = await db.update(users).set(data).where(eq(users.user_id, id)).returning(publicUserColumns);
  return rows[0];
};

/** Delete a user by ID. Returns undefined if not found. */
export const removeUser = async (id) => {
  const rows = await db.delete(users).where(eq(users.user_id, id)).returning(publicUserColumns);
  return rows[0];
};
