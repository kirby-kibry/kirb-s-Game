/**
 * Test helpers for signing in.
 *
 * Every protected route needs a real token now, so suites log in once in their
 * beforeAll and pass the header around. This file is not a suite itself — the
 * vitest config only picks up files ending in `.test.js`.
 */

import request from 'supertest';

/**
 * Log in and return the token.
 * @param {import('express').Express} app - The app under test.
 * @param {string} username - Who to sign in as.
 * @param {string} [password] - Their password. The seeded accounts share one.
 * @returns {Promise<string>} A signed JWT.
 */
export const signIn = async (app, username, password = 'password123') => {
  const res = await request(app).post('/api/users/login').send({ username, password });

  return res.body.token;
};

/**
 * Register a throwaway account and return its token and user record.
 * Registering hands back a token, so no second call is needed.
 *
 * The name is built here rather than passed in whole because usernames are
 * capped at 20 characters — a timestamp tacked onto a prefix overruns that and
 * the registration quietly fails validation instead.
 *
 * @param {import('express').Express} app - The app under test.
 * @param {string} [prefix] - A readable prefix, trimmed to fit.
 * @returns {Promise<{token: string, user: Object}>}
 */
export const registerFreshUser = async (app, prefix = 'tester') => {
  const username = `${prefix.slice(0, 12)}-${Math.random().toString(36).slice(2, 8)}`;

  const res = await request(app)
    .post('/api/users')
    .send({ username, password: 'password123' });

  if (res.status !== 201) {
    throw new Error(`Could not register ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return res.body;
};

/**
 * Turn a token into the header supertest wants.
 * @example await request(app).get('/api/users').set(as(token));
 */
export const as = (token) => ({ Authorization: `Bearer ${token}` });
