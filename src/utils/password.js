/**
 * Password hashing helpers.
 *
 * Uses bcrypt, which is deliberately slow. The cost factor below decides how
 * many rounds of hashing every password goes through, so guessing passwords in
 * bulk stays expensive even if the database is ever stolen. bcrypt also salts
 * each hash itself, which means two people with the same password still end up
 * with different stored values.
 *
 * Both functions are async on purpose: bcrypt does the work on a background
 * thread, so hashing never blocks the server from answering other requests
 * while it runs.
 */

import bcrypt from 'bcrypt';

/**
 * How much work bcrypt does per hash. Every extra round doubles the time taken.
 * 10 is the usual default — slow enough to be a real obstacle to an attacker,
 * fast enough that logging in still feels instant.
 */
const SALT_ROUNDS = 10;

/**
 * Hash a plaintext password for storage.
 * @param {string} plainPassword - The password the user typed.
 * @returns {Promise<string>} A bcrypt hash, safe to store in the database.
 */
export const hashPassword = async (plainPassword) => {
  return await bcrypt.hash(plainPassword, SALT_ROUNDS);
};

/**
 * Check a plaintext password against a stored hash.
 * @param {string} plainPassword - The password the user typed.
 * @param {string} storedHash - The bcrypt hash from the database.
 * @returns {Promise<boolean>} True when the password matches.
 */
export const verifyPassword = async (plainPassword, storedHash) => {
  if (!storedHash) return false;

  try {
    return await bcrypt.compare(plainPassword, storedHash);
  } catch {
    // A stored value that isn't a bcrypt hash is a failed match, not a crash.
    return false;
  }
};
