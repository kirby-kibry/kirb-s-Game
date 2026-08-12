import { execSync } from 'child_process';
import request from 'supertest';

import { signIn, registerFreshUser, as } from './helpers/auth.js';

let app;
let avaToken;
let benToken;

beforeAll(async () => {
  execSync('node src/db/seed.js', { stdio: 'ignore' });
  const mod = await import('../../index.js');
  app = mod.default;

  avaToken = await signIn(app, 'ava');
  benToken = await signIn(app, 'ben');
});

describe('GET /api/cosmetics', () => {
  it('returns the shop catalog ordered by price', async () => {
    const res = await request(app).get('/api/cosmetics').set(as(benToken));

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(5);

    const prices = res.body.map((cosmetic) => cosmetic.price);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/cosmetics');

    expect(res.status).toBe(401);
  });
});

describe('GET /api/users/:id/cosmetics', () => {
  it('starts empty for a new player', async () => {
    const res = await request(app).get('/api/users/demo-user-ben/cosmetics').set(as(benToken));

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns 404 for an unknown user', async () => {
    const res = await request(app).get('/api/users/nobody/cosmetics').set(as(benToken));
    expect(res.status).toBe(404);
  });
});

describe('POST /api/cosmetics/:id/buy', () => {
  it('deducts the price and records ownership', async () => {
    const before = await request(app).get('/api/users/demo-user-ben').set(as(benToken));

    const res = await request(app)
      .post('/api/cosmetics/border-red/buy')
      .set(as(benToken));

    expect(res.status).toBe(200);
    expect(res.body.pointsSpent).toBe(30);
    expect(res.body.remainingPoints).toBe(before.body.points - 30);

    const owned = await request(app).get('/api/users/demo-user-ben/cosmetics').set(as(benToken));
    expect(owned.body.map((cosmetic) => cosmetic.cosmetic_id)).toContain('border-red');
  });

  it('charges the player the token belongs to, not one named in the body', async () => {
    const avaBefore = await request(app).get('/api/users/demo-user-ava').set(as(avaToken));
    const benBefore = await request(app).get('/api/users/demo-user-ben').set(as(benToken));

    // Ben asks to buy while claiming to be Ava. The body is ignored — the
    // server charges whoever the token says is asking.
    const res = await request(app)
      .post('/api/cosmetics/border-blue/buy')
      .set(as(benToken))
      .send({ user_id: 'demo-user-ava' });

    expect(res.status).toBe(200);

    const avaAfter = await request(app).get('/api/users/demo-user-ava').set(as(avaToken));
    const benAfter = await request(app).get('/api/users/demo-user-ben').set(as(benToken));

    expect(avaAfter.body.points).toBe(avaBefore.body.points);
    expect(benAfter.body.points).toBe(benBefore.body.points - 30);
  });

  it('returns 409 when the player already owns it, without charging again', async () => {
    await request(app).post('/api/cosmetics/border-blue/buy').set(as(avaToken));
    const afterFirst = await request(app).get('/api/users/demo-user-ava').set(as(avaToken));

    const res = await request(app)
      .post('/api/cosmetics/border-blue/buy')
      .set(as(avaToken));

    expect(res.status).toBe(409);

    const afterSecond = await request(app).get('/api/users/demo-user-ava').set(as(avaToken));
    expect(afterSecond.body.points).toBe(afterFirst.body.points);
  });

  it('returns 422 when the player cannot afford it', async () => {
    const { token } = await registerFreshUser(app, 'brokeplayer');

    const res = await request(app)
      .post('/api/cosmetics/border-rainbow/buy')
      .set(as(token));

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_POINTS');
  });

  it('never lets a balance go negative', async () => {
    const { token, user } = await registerFreshUser(app, 'checkbalance');

    await request(app).post('/api/cosmetics/border-gold/buy').set(as(token));

    const check = await request(app).get(`/api/users/${user.user_id}`).set(as(token));
    expect(check.body.points).toBeGreaterThanOrEqual(0);
  });

  it('returns 404 for an unknown cosmetic', async () => {
    const res = await request(app)
      .post('/api/cosmetics/not-a-real-item/buy')
      .set(as(benToken));

    expect(res.status).toBe(404);
  });

  it('returns 401 without a token, and charges nobody', async () => {
    const before = await request(app).get('/api/users/demo-user-ben').set(as(benToken));

    const res = await request(app).post('/api/cosmetics/border-gold/buy');
    expect(res.status).toBe(401);

    const after = await request(app).get('/api/users/demo-user-ben').set(as(benToken));
    expect(after.body.points).toBe(before.body.points);
  });
});
