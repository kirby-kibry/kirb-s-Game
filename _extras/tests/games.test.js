import { execSync } from 'child_process';
import request from 'supertest';

import { randomUUID } from 'crypto';

import { signIn, registerFreshUser, as } from './helpers/auth.js';

let app;
let insertGame;
let findRandomBotDrawing;
let avaToken;
let benToken;

beforeAll(async () => {
  execSync('node src/db/seed.js', { stdio: 'ignore' });
  const mod = await import('../../index.js');
  app = mod.default;

  // Practice rounds are built straight through the model in these tests, so
  // the suite never calls the Gemini API to get a drawing.
  ({ insertGame, findRandomBotDrawing } = await import('../../src/models/gameModel.js'));

  avaToken = await signIn(app, 'ava');
  benToken = await signIn(app, 'ben');
});

/** Open a room with ava as the drawer. Who is drawing comes from her token. */
const openRoom = async (difficulty = 'easy') => {
  const res = await request(app)
    .post('/api/games')
    .set(as(avaToken))
    .send({ difficulty });

  return res.body;
};

/** Open a room and have ben join it, so a round is running. */
const startRound = async (difficulty = 'easy') => {
  const game = await openRoom(difficulty);

  await request(app)
    .post('/api/games/join')
    .set(as(benToken))
    .send({ room_code: game.room_code });

  return game;
};

describe('Game routes require a signed-in player', () => {
  it('returns 401 for the lobby list without a token', async () => {
    const res = await request(app).get('/api/games');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when opening a room without a token', async () => {
    const res = await request(app).post('/api/games').send({ difficulty: 'easy' });

    expect(res.status).toBe(401);
  });

  it('returns 401 when guessing without a token', async () => {
    const game = await startRound();

    const res = await request(app)
      .post(`/api/games/${game.game_id}/guesses`)
      .send({ guess: game.prompt_word });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/games', () => {
  it('returns 200 with an array of games', async () => {
    const res = await request(app).get('/api/games').set(as(avaToken));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('filters by status', async () => {
    await openRoom();

    const res = await request(app).get('/api/games?status=waiting').set(as(avaToken));

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((game) => game.status === 'waiting')).toBe(true);
  });

  it('never leaks the prompt word of a round that is still being played', async () => {
    await openRoom();

    const res = await request(app).get('/api/games?status=waiting').set(as(avaToken));

    expect(res.body.every((game) => game.prompt_word === null)).toBe(true);
  });
});

describe('POST /api/games', () => {
  it('opens a waiting room with a room code and a server-picked word', async () => {
    const res = await request(app)
      .post('/api/games')
      .set(as(avaToken))
      .send({ difficulty: 'medium' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('waiting');
    expect(res.body.drawer_id).toBe('demo-user-ava');
    expect(res.body.guesser_id).toBe(null);
    expect(res.body.room_code).toHaveLength(4);
    expect(res.body.prompt_word.length).toBeGreaterThan(0);
  });

  it('makes the token holder the drawer, ignoring any user_id in the body', async () => {
    const res = await request(app)
      .post('/api/games')
      .set(as(avaToken))
      .send({ difficulty: 'easy', user_id: 'demo-user-ben' });

    expect(res.status).toBe(201);
    expect(res.body.drawer_id).toBe('demo-user-ava');
  });

  it('rejects an invalid difficulty with 400', async () => {
    const res = await request(app)
      .post('/api/games')
      .set(as(avaToken))
      .send({ difficulty: 'impossible' });

    expect(res.status).toBe(400);
  });

  it('returns 404 when the account behind a valid token has been deleted', async () => {
    const { token, user } = await registerFreshUser(app, 'ghost');

    await request(app).delete(`/api/users/${user.user_id}`).set(as(token));

    // The token is still correctly signed, so it gets past requireAuth — but
    // there is no longer a player behind it.
    const res = await request(app)
      .post('/api/games')
      .set(as(token))
      .send({ difficulty: 'easy' });

    expect(res.status).toBe(404);
  });
});

describe('POST /api/games/join', () => {
  it('puts a second player in and starts the round', async () => {
    const game = await openRoom();

    const res = await request(app)
      .post('/api/games/join')
      .set(as(benToken))
      .send({ room_code: game.room_code });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('drawing');
    expect(res.body.guesser_id).toBe('demo-user-ben');
  });

  it('returns 404 for a room code that does not exist', async () => {
    const res = await request(app)
      .post('/api/games/join')
      .set(as(benToken))
      .send({ room_code: 'ZZZZ' });

    expect(res.status).toBe(404);
  });

  it('returns 409 when the drawer tries to join their own room', async () => {
    const game = await openRoom();

    const res = await request(app)
      .post('/api/games/join')
      .set(as(avaToken))
      .send({ room_code: game.room_code });

    expect(res.status).toBe(409);
  });

  it('returns 409 when the room already has a guesser', async () => {
    const game = await startRound();

    const res = await request(app)
      .post('/api/games/join')
      .set(as(benToken))
      .send({ room_code: game.room_code });

    expect(res.status).toBe(409);
  });
});

describe('GET /api/games/:id/state', () => {
  it('gives the prompt word to the drawer', async () => {
    const game = await startRound();

    const res = await request(app).get(`/api/games/${game.game_id}/state`).set(as(avaToken));

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('drawer');
    expect(res.body.prompt_word).toBe(game.prompt_word);
  });

  it('hides the prompt word from the guesser and sends a blanked hint instead', async () => {
    const game = await startRound();

    const res = await request(app).get(`/api/games/${game.game_id}/state`).set(as(benToken));

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('guesser');
    expect(res.body.prompt_word).toBe(null);
    expect(res.body.prompt_hint).toHaveLength(game.prompt_word.length);
    expect(res.body.prompt_hint).not.toContain(game.prompt_word);
  });

  it('will not let the guesser ask for the drawer’s view to read the word', async () => {
    const game = await startRound();

    // The old version took ?user_id=, so the guesser could simply name the
    // drawer and be handed the answer. The view now comes from the token.
    const res = await request(app)
      .get(`/api/games/${game.game_id}/state?user_id=demo-user-ava`)
      .set(as(benToken));

    expect(res.body.role).toBe('guesser');
    expect(res.body.prompt_word).toBe(null);
  });

  it('counts down from the difficulty time', async () => {
    const game = await startRound('hard');

    const res = await request(app).get(`/api/games/${game.game_id}/state`).set(as(benToken));

    expect(res.body.seconds_left).toBeGreaterThan(0);
    expect(res.body.seconds_left).toBeLessThanOrEqual(45);
  });
});

describe('PUT /api/games/:id/canvas', () => {
  it('saves the drawer picture and bumps the version', async () => {
    const game = await startRound();

    const res = await request(app)
      .put(`/api/games/${game.game_id}/canvas`)
      .set(as(avaToken))
      .send({ canvas_data: 'data:image/png;base64,abc123' });

    expect(res.status).toBe(200);
    expect(res.body.canvas_version).toBe(1);

    const check = await request(app).get(`/api/games/${game.game_id}/canvas`).set(as(avaToken));
    expect(check.body.canvas_data).toBe('data:image/png;base64,abc123');
  });

  it('returns 401 when the guesser tries to draw', async () => {
    const game = await startRound();

    const res = await request(app)
      .put(`/api/games/${game.game_id}/canvas`)
      .set(as(benToken))
      .send({ canvas_data: 'data:image/png;base64,abc123' });

    expect(res.status).toBe(401);
  });
});

describe('POST /api/games/:id/guesses', () => {
  it('records a wrong guess without ending the round or paying out', async () => {
    const before = await request(app).get('/api/users/demo-user-ben').set(as(benToken));
    const game = await startRound();

    const res = await request(app)
      .post(`/api/games/${game.game_id}/guesses`)
      .set(as(benToken))
      .send({ guess: 'definitely not it' });

    expect(res.status).toBe(201);
    expect(res.body.correct).toBe(false);

    const check = await request(app).get(`/api/games/${game.game_id}`).set(as(benToken));
    expect(check.body.status).toBe('drawing');

    const after = await request(app).get('/api/users/demo-user-ben').set(as(benToken));
    expect(after.body.points).toBe(before.body.points);
  });

  it('pays both players when the guess is right', async () => {
    const drawerBefore = await request(app).get('/api/users/demo-user-ava').set(as(avaToken));
    const guesserBefore = await request(app).get('/api/users/demo-user-ben').set(as(benToken));

    const game = await startRound('hard');

    const res = await request(app)
      .post(`/api/games/${game.game_id}/guesses`)
      .set(as(benToken))
      .send({ guess: game.prompt_word });

    expect(res.status).toBe(201);
    expect(res.body.correct).toBe(true);
    expect(res.body.pointsEarned).toBe(30);

    const drawerAfter = await request(app).get('/api/users/demo-user-ava').set(as(avaToken));
    const guesserAfter = await request(app).get('/api/users/demo-user-ben').set(as(benToken));

    expect(drawerAfter.body.points).toBe(drawerBefore.body.points + 30);
    expect(drawerAfter.body.total_score).toBe(drawerBefore.body.total_score + 30);
    expect(guesserAfter.body.points).toBe(guesserBefore.body.points + 30);
    expect(guesserAfter.body.total_score).toBe(guesserBefore.body.total_score + 30);
  });

  it('ignores capitals and extra spaces around the answer', async () => {
    const game = await startRound();

    const res = await request(app)
      .post(`/api/games/${game.game_id}/guesses`)
      .set(as(benToken))
      .send({ guess: `  ${game.prompt_word.toUpperCase()} ` });

    expect(res.body.correct).toBe(true);
  });

  it('returns 401 when the drawer tries to guess their own word', async () => {
    const game = await startRound();

    const res = await request(app)
      .post(`/api/games/${game.game_id}/guesses`)
      .set(as(avaToken))
      .send({ guess: game.prompt_word });

    expect(res.status).toBe(401);
  });

  it('returns 409 for a second correct guess, and pays out only once', async () => {
    const game = await startRound();

    await request(app)
      .post(`/api/games/${game.game_id}/guesses`)
      .set(as(benToken))
      .send({ guess: game.prompt_word });

    const afterFirst = await request(app).get('/api/users/demo-user-ben').set(as(benToken));

    const second = await request(app)
      .post(`/api/games/${game.game_id}/guesses`)
      .set(as(benToken))
      .send({ guess: game.prompt_word });

    expect(second.status).toBe(409);

    const afterSecond = await request(app).get('/api/users/demo-user-ben').set(as(benToken));
    expect(afterSecond.body.points).toBe(afterFirst.body.points);
  });

  it('returns 404 for an unknown game', async () => {
    const res = await request(app)
      .post('/api/games/does-not-exist/guesses')
      .set(as(benToken))
      .send({ guess: 'cat' });

    expect(res.status).toBe(404);
  });

  it('rejects an empty guess with 400', async () => {
    const game = await startRound();

    const res = await request(app)
      .post(`/api/games/${game.game_id}/guesses`)
      .set(as(benToken))
      .send({ guess: '   ' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/games/:id/guesses', () => {
  it('returns the guesses made in a round, oldest first', async () => {
    const game = await startRound();

    await request(app)
      .post(`/api/games/${game.game_id}/guesses`)
      .set(as(benToken))
      .send({ guess: 'first try' });

    const res = await request(app).get(`/api/games/${game.game_id}/guesses`).set(as(benToken));

    expect(res.status).toBe(200);
    expect(res.body[0].guess_text).toBe('first try');
    expect(res.body[0].is_correct).toBe(false);
  });
});

describe('POST /api/games/:id/end', () => {
  it('lets a player quit the round, and reveals the word afterwards', async () => {
    const game = await startRound();

    const res = await request(app)
      .post(`/api/games/${game.game_id}/end`)
      .set(as(benToken));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('abandoned');

    const check = await request(app).get(`/api/games/${game.game_id}`).set(as(benToken));
    expect(check.body.prompt_word).toBe(game.prompt_word);
  });

  it('returns 401 for somebody who is not in the room', async () => {
    const game = await startRound();

    const { token } = await registerFreshUser(app, 'nosy');

    const res = await request(app)
      .post(`/api/games/${game.game_id}/end`)
      .set(as(token));

    expect(res.status).toBe(401);
  });
});

describe('Practice rounds against Kibry Bot', () => {
  /** Six throwaway strokes standing in for a drawing the bot would produce. */
  const botStrokes = [1, 2, 3, 4, 5, 6].map((n) => ({
    colour: '#222222',
    width: 6,
    points: [{ x: n * 10, y: n * 10 }, { x: n * 20, y: n * 20 }],
  }));

  /**
   * Build a practice round directly in the database.
   * `secondsAgo` backdates the clock so the stroke reveal can be checked.
   */
  const startPractice = async (secondsAgo = 0) => {
    return await insertGame({
      game_id: randomUUID(),
      room_code: `B${Math.floor(Math.random() * 900 + 100)}`,
      mode: 'ai',
      guesser_id: 'demo-user-ben',
      prompt_word: 'lighthouse',
      difficulty: 'easy',
      status: 'drawing',
      started_at: new Date(Date.now() - secondsAgo * 1000).toISOString(),
      ai_strokes: JSON.stringify(botStrokes),
    });
  };

  it('hides the prompt word from the player, who is the guesser', async () => {
    const game = await startPractice();

    const res = await request(app).get(`/api/games/${game.game_id}/state`).set(as(benToken));

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('ai');
    expect(res.body.role).toBe('guesser');
    expect(res.body.prompt_word).toBe(null);
    expect(res.body.drawer).toBe(null);
  });

  it('reveals the drawing gradually rather than all at once', async () => {
    const fresh = await startPractice(0);
    const partway = await startPractice(35);

    const atStart = await request(app).get(`/api/games/${fresh.game_id}/state`).set(as(benToken));
    const later = await request(app).get(`/api/games/${partway.game_id}/state`).set(as(benToken));

    expect(atStart.body.strokes).toHaveLength(0);
    expect(later.body.strokes.length).toBeGreaterThan(0);
    expect(later.body.strokes.length).toBeLessThan(botStrokes.length);
  });

  it('sends the whole drawing once the round is over', async () => {
    const game = await startPractice();

    await request(app)
      .post(`/api/games/${game.game_id}/guesses`)
      .set(as(benToken))
      .send({ guess: 'lighthouse' });

    const res = await request(app).get(`/api/games/${game.game_id}/state`).set(as(benToken));

    expect(res.body.strokes).toHaveLength(botStrokes.length);
    expect(res.body.prompt_word).toBe('lighthouse');
  });

  it('ends the round on a correct guess but pays out nothing', async () => {
    const before = await request(app).get('/api/users/demo-user-ben').set(as(benToken));
    const game = await startPractice();

    const res = await request(app)
      .post(`/api/games/${game.game_id}/guesses`)
      .set(as(benToken))
      .send({ guess: 'lighthouse' });

    expect(res.status).toBe(201);
    expect(res.body.correct).toBe(true);
    expect(res.body.pointsEarned).toBe(0);

    const check = await request(app).get(`/api/games/${game.game_id}`).set(as(benToken));
    expect(check.body.status).toBe('won');

    const after = await request(app).get('/api/users/demo-user-ben').set(as(benToken));
    expect(after.body.points).toBe(before.body.points);
    expect(after.body.total_score).toBe(before.body.total_score);
  });

  it('reports zero points earned on the finished round', async () => {
    const game = await startPractice();

    await request(app)
      .post(`/api/games/${game.game_id}/guesses`)
      .set(as(benToken))
      .send({ guess: 'lighthouse' });

    const res = await request(app).get(`/api/games/${game.game_id}/state`).set(as(benToken));

    expect(res.body.status).toBe('won');
    expect(res.body.points_earned).toBe(0);
  });

  it('keeps practice rounds out of the two-player lobby list', async () => {
    await startPractice();
    await openRoom();

    const lobby = await request(app).get('/api/games?status=waiting&mode=pvp').set(as(avaToken));

    expect(lobby.status).toBe(200);
    expect(lobby.body.length).toBeGreaterThan(0);
    expect(lobby.body.every((game) => game.mode === 'pvp')).toBe(true);
  });

  it('starts from a pre-drawn picture, with no AI service involved', async () => {
    // No API key is set while the tests run, so this passing is itself the
    // proof that starting a practice round never calls out to anything.
    const res = await request(app)
      .post('/api/games')
      .set(as(benToken))
      .send({ difficulty: 'easy', opponent: 'bot' });

    expect(res.status).toBe(201);
    expect(res.body.mode).toBe('ai');
    expect(res.body.status).toBe('drawing');
    expect(res.body.guesser_id).toBe('demo-user-ben');
    // The player is the guesser, so the word must not come back.
    expect(res.body.prompt_word).toBeUndefined();
  });

  it('gives the player a word the bot actually has a picture for', async () => {
    const res = await request(app)
      .post('/api/games')
      .set(as(benToken))
      .send({ difficulty: 'easy', opponent: 'bot' });

    const state = await request(app).get(`/api/games/${res.body.game_id}/state`).set(as(benToken));

    // Ending the round reveals the word, which has to match the drawing shown.
    await request(app).post(`/api/games/${res.body.game_id}/end`).set(as(benToken));
    const finished = await request(app).get(`/api/games/${res.body.game_id}/state`).set(as(benToken));

    expect(state.body.prompt_hint.length).toBe(finished.body.prompt_word.length);
    expect(finished.body.strokes.length).toBeGreaterThan(0);
  });

  it('has no picture to offer for a difficulty it has never been taught', async () => {
    expect(await findRandomBotDrawing('a-difficulty-that-does-not-exist')).toBeUndefined();
  });

  it('rejects an unknown opponent with 400', async () => {
    const res = await request(app)
      .post('/api/games')
      .set(as(avaToken))
      .send({ difficulty: 'easy', opponent: 'robot' });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/games/:id', () => {
  it('deletes a game and returns 204', async () => {
    const game = await openRoom();

    const res = await request(app).delete(`/api/games/${game.game_id}`).set(as(avaToken));
    expect(res.status).toBe(204);

    const check = await request(app).get(`/api/games/${game.game_id}`).set(as(avaToken));
    expect(check.status).toBe(404);
  });

  it('returns 401 when somebody who was not in the room tries to delete it', async () => {
    const game = await openRoom();

    const { token } = await registerFreshUser(app, 'meddler');

    const res = await request(app).delete(`/api/games/${game.game_id}`).set(as(token));
    expect(res.status).toBe(401);

    const check = await request(app).get(`/api/games/${game.game_id}`).set(as(avaToken));
    expect(check.status).toBe(200);
  });
});
