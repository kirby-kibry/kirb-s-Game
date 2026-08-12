import { execSync } from 'child_process';
import request from 'supertest';

import { signIn, registerFreshUser, as } from './helpers/auth.js';

let app;
let avaToken;
let benToken;

// Reset the database BEFORE importing the app so the libsql client
// connects to the freshly created file (not a stale/deleted one).
beforeAll(async () => {
  execSync('node src/db/seed.js', { stdio: 'ignore' });
  const mod = await import('../../index.js');
  app = mod.default;

  avaToken = await signIn(app, 'ava');
  benToken = await signIn(app, 'ben');
});

describe('GET /api/users', () => {
  it('returns 200 with an array of users', async () => {
    const res = await request(app).get('/api/users').set(as(avaToken));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  it('never exposes the password hash', async () => {
    const res = await request(app).get('/api/users').set(as(avaToken));

    res.body.forEach((user) => {
      expect(user.password).toBeUndefined();
    });
  });

  it('filters by username', async () => {
    const res = await request(app).get('/api/users?username=ava').set(as(avaToken));

    expect(res.status).toBe(200);
    expect(res.body.every((user) => user.username.includes('ava'))).toBe(true);
  });
});

describe('Protected routes reject unauthenticated requests', () => {
  it('returns 401 when no token is sent at all', async () => {
    const res = await request(app).get('/api/users');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 for a token that is not signed by this server', async () => {
    const forged = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiZGVtby11c2VyLWF2YSJ9.not-a-real-signature';

    const res = await request(app).get('/api/users').set(as(forged));

    expect(res.status).toBe(401);
  });

  it('returns 401 when the Authorization header is not a Bearer header', async () => {
    const res = await request(app).get('/api/users').set({ Authorization: avaToken });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/users/leaderboard', () => {
  it('is public, and returns users ordered by total_score, highest first', async () => {
    const res = await request(app).get('/api/users/leaderboard');

    expect(res.status).toBe(200);

    const scores = res.body.map((user) => user.total_score);
    const sorted = [...scores].sort((a, b) => b - a);
    expect(scores).toEqual(sorted);
  });
});

describe('POST /api/users', () => {
  it('creates a user, returns 201, and hands back a token', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ username: 'newplayer', password: 'password123' });

    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe('newplayer');
    expect(res.body.user.points).toBe(0);
    expect(typeof res.body.token).toBe('string');
  });

  it('never returns the password in any form', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ username: 'secretive', password: 'password123' });

    expect(res.body.user.password).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('password123');
  });

  it('stores the password as a bcrypt hash, not as plaintext', async () => {
    const username = `hash-${Math.random().toString(36).slice(2, 8)}`;

    await request(app).post('/api/users').send({ username, password: 'password123' });

    const { findUserByUsernameWithPassword } = await import('../../src/models/userModel.js');
    const stored = await findUserByUsernameWithPassword(username);

    expect(stored.password).not.toBe('password123');
    // bcrypt hashes always start with the algorithm and cost, e.g. $2b$10$
    expect(stored.password).toMatch(/^\$2[aby]\$\d{2}\$/);
  });

  it('rejects a duplicate username with 409', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ username: 'ava', password: 'password123' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('rejects a short password with 400', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ username: 'shorty', password: 'abc' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/users/login', () => {
  it('logs in with correct credentials and issues a token', async () => {
    const res = await request(app)
      .post('/api/users/login')
      .send({ username: 'ava', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('ava');
    expect(res.body.user.password).toBeUndefined();
    expect(typeof res.body.token).toBe('string');
  });

  it('issues a token that actually opens a protected route', async () => {
    const login = await request(app)
      .post('/api/users/login')
      .send({ username: 'ava', password: 'password123' });

    const res = await request(app).get('/api/users/demo-user-ava').set(as(login.body.token));

    expect(res.status).toBe(200);
    expect(res.body.username).toBe('ava');
  });

  it('rejects a wrong password with 401', async () => {
    const res = await request(app)
      .post('/api/users/login')
      .send({ username: 'ava', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });

  it('rejects an unknown username with 401', async () => {
    const res = await request(app)
      .post('/api/users/login')
      .send({ username: 'nobody', password: 'password123' });

    expect(res.status).toBe(401);
  });
});

describe('PUT /api/users/:id', () => {
  it('cannot be used to change total_score', async () => {
    const before = await request(app).get('/api/users/demo-user-ben').set(as(benToken));

    const res = await request(app)
      .put('/api/users/demo-user-ben')
      .set(as(benToken))
      .send({ username: 'ben', total_score: 999999 });

    expect(res.status).toBe(200);
    expect(res.body.total_score).toBe(before.body.total_score);
  });

  it('returns 401 when editing somebody else’s account', async () => {
    const res = await request(app)
      .put('/api/users/demo-user-ben')
      .set(as(avaToken))
      .send({ username: 'stolen' });

    expect(res.status).toBe(401);

    const check = await request(app).get('/api/users/demo-user-ben').set(as(benToken));
    expect(check.body.username).toBe('ben');
  });

  it('returns 401 without a token', async () => {
    const res = await request(app)
      .put('/api/users/demo-user-ben')
      .send({ username: 'anonymous' });

    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/users/:id', () => {
  it('lets a player delete their own account and returns 204', async () => {
    const { token, user } = await registerFreshUser(app, 'tempuser');

    const res = await request(app).delete(`/api/users/${user.user_id}`).set(as(token));
    expect(res.status).toBe(204);

    const check = await request(app).get(`/api/users/${user.user_id}`).set(as(avaToken));
    expect(check.status).toBe(404);
  });

  it('returns 401 when deleting somebody else’s account', async () => {
    const res = await request(app).delete('/api/users/demo-user-ava').set(as(benToken));

    expect(res.status).toBe(401);

    const check = await request(app).get('/api/users/demo-user-ava').set(as(avaToken));
    expect(check.status).toBe(200);
  });
});
