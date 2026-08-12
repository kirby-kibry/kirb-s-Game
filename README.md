# Kibry — Draw & Guess

A two-player drawing game. One player opens a room and is given a secret word to
draw; the other joins with the room code and has to guess what it is before the
timer runs out. Get it right and **both** players score. Points are spent in a
shop on cosmetic borders for the canvas, and a leaderboard ranks players by
total score.

Scoring rounds need two people. If nobody is around, **Kibry Bot** will draw for
you as practice — see below.

Built with Express.js + libsql + Drizzle ORM, with a plain HTML/CSS/JS frontend.

## Setup

```bash
npm install       # install dependencies
npm run db        # create and seed the database
npm start         # start the server
```

Use `npm run dev` instead of `npm start` while developing — it restarts the
server whenever a file changes.

**No API key and no `.env` file are needed to play.** Every setting has a working
default, and Kibry Bot's pictures are drawn ahead of time and ship with the
project, so a fresh clone works out of the box and offline. Copy `.env.example`
to `.env` if you want to change the port, the database location, or the token
secret. A Gemini key is only needed to teach the bot *new* words — see
[Teaching the bot more words](#teaching-the-bot-more-words).

Then open [http://localhost:3000](http://localhost:3000).
API docs are at [http://localhost:3000/api-docs](http://localhost:3000/api-docs).

Two demo accounts are seeded — log in as **ava** or **ben**, password `password123`.

### Playing it on your own machine

The game needs two players signed in at once. Open the page twice — a normal
window and a private/incognito window works well, since each window keeps its
own login. Sign in as `ava` in one and `ben` in the other.

### Playing from two laptops

One laptop runs the server and both players connect to it — the other laptop
does not need the code, just a browser.

1. On the laptop running `npm run dev`, look at the addresses it prints on
   startup and pick the one for your Wi-Fi adapter, for example
   `http://172.22.66.2:3000`.
2. Make sure both laptops are on the **same Wi-Fi network**.
3. The other player opens that address in their browser and registers an
   account. From there it plays exactly the same — one opens a room, the other
   joins with the code.

The first time you do this Windows may ask whether to allow Node.js through the
firewall. Say yes, and tick both **Private** and **Public** networks.

If the page will not load on the second laptop, the usual cause is the network
rather than the game. School and café Wi-Fi often turn on *client isolation*,
which blocks laptops on the same network from talking to each other. Phone
hotspots normally do not, so tethering both laptops to one phone is the quickest
way to check. To play across different networks entirely, put the server behind
a tunnel (Cloudflare Tunnel or ngrok) and share the address it gives you.

## How the game works

1. One player picks a difficulty and presses **Open a room**. The server picks
   their secret word and gives them a four-letter room code.
2. The other player types that code (or clicks the room in the lobby list) and
   joins as the guesser.
3. The clock starts. The drawer draws; the guesser watches the picture appear
   and types guesses.
4. A correct guess ends the round and pays **both** players. If the clock runs
   out first, nobody scores.

| Difficulty | Time | Points (each player) |
|------------|------|----------------------|
| Easy       | 90s  | 10                   |
| Medium     | 60s  | 20                   |
| Hard       | 45s  | 30                   |

- **points** is spendable currency — it goes down when you buy a cosmetic.
- **total_score** is a lifetime total that only ever goes up, and drives the leaderboard.

Both are awarded together when a round is won, and neither can be set directly
through the API.

## Practising against Kibry Bot

Press **Practise against Kibry Bot** in the lobby and the roles swap round: the
bot draws and you guess.

**The pictures are drawn in advance, not while you wait.** Google's Gemini draws
them once, ahead of time, and they are stored as brush strokes. Playing a
practice round is then just a database read, so:

- it starts instantly, with no "please wait" while something thinks,
- it needs **no API key and no internet** — a fresh clone of this project plays
  straight away,
- it can't fail because a service is busy, rate-limited, or down.

The drawing still appears **stroke by stroke as the clock runs down**, exactly as
if somebody were drawing it live. The strokes are stored in the order a person
would draw them — outline first, details last — and the server only ever sends
the ones that have been "drawn" so far, so the answer cannot be read ahead out of
the network tab.

**Practice rounds award no points.** The leaderboard is a record of rounds won
with another person, and beating a computer on your own shouldn't count towards
it.

### Teaching the bot more words

The pictures live in `src/db/bot-drawings.json`, which is part of the project.
`npm run db` loads that file into the database, which is why **resetting the
database never loses the drawings** — they go straight back in.

To draw pictures for words the bot doesn't know yet, put a Gemini API key in
`.env` and run:

```bash
npm run draw              # every word that is still missing
npm run draw easy         # only the easy words
npm run draw easy 10      # only the easy words, stopping after 10 new ones
npm run db                # load the new pictures into the database
```

It saves after every picture and skips words it already has, so it is safe to
stop it with `Ctrl+C` and carry on later. It also waits out Gemini's free-tier
limit by itself rather than giving up.

This is the only part of the project that ever contacts an AI service, and it
runs on your machine when *you* choose — never while somebody is playing.

The whole integration lives in one file, `src/utils/bot-artist.js`, so swapping
to a different AI provider means rewriting that file and nothing else.

### How the two browsers stay in sync

There are no WebSockets. Both browsers poll `GET /api/games/:id/state` about
once a second, and the server is the referee:

- The **secret word** is picked on the server and is only ever sent back to the
  drawer. The guesser gets a blanked-out hint like `______ _______` instead, and
  only sees the real word once the round is over.
- The **clock** is worked out from the round's `started_at` on the server, so
  changing your computer's clock does not buy you extra time.
- The **picture** is saved with a version number that counts up on every change.
  The guesser's browser only downloads it again when that number moves.
- **Points** are awarded inside a single database transaction that also closes
  the round, so a round can only ever be won — and paid out — once.

## Accounts and security

Registering and logging in are the only two ways into the game. Everything else
needs proof of who you are.

**Passwords** are hashed with **bcrypt** before they are stored, and the hash
never leaves the server — every query that can reach the browser selects an
explicit list of columns that does not include it. bcrypt is deliberately slow
and salts each hash itself, so two players with the same password still get
different stored values, and a stolen database is expensive to work through.

**Logging in issues a JSON Web Token.** There are no server-side sessions. The
token holds only the player's id and username, is signed with `JWT_SECRET`, and
expires after `JWT_EXPIRES_IN` (two hours by default). The browser keeps it in
`localStorage` and `src/frontend/api.js` attaches it to every request as
`Authorization: Bearer <token>`.

**`src/middlewares/auth.js` is the gate.** `requireAuth` checks the token and
puts the player it belongs to on `req.user`; anything without a valid one is
turned away with **401** before it reaches a controller. `requireSelf` sits on
top of it for the two routes that name a user in the path, so being signed in as
somebody is not the same as being allowed to rename or delete anybody.

**Controllers never read a user id out of the request.** This is the part that
matters most. A request body is just text the browser typed — when the buy
endpoint took `user_id` from the body, anyone could post somebody else's id and
spend the points they had earned. Every action now takes its actor from
`req.user.user_id`, which came out of a signed token and cannot be forged
without the secret. The same change closed a smaller leak in the round state
endpoint, where a guesser could ask for the drawer's view and be handed the
secret word.

If a token expires mid-game, `api.js` clears the stale login and raises a
`kibry:session-expired` event; the game page returns to the sign-in form with an
explanation and the other pages send you back to it, rather than failing
silently.

## IDs and randomness

Every generated id is declared on its column in `src/db/schema.js` with
`$defaultFn`, not built at the call site. Inserting a row without one is
therefore impossible to get wrong, and there is one place to look to see how any
id is made.

Ids are **UUID v4** from `crypto.randomUUID()` — 122 random bits from a
cryptographic generator. Two rows colliding is not a practical worry: you would
need to generate around a billion ids per second for decades to reach an even
chance of a single duplicate. And a collision could never quietly give one id to
two rows in any case, because the column is a PRIMARY KEY — the database would
reject the second insert. **The uniqueness guarantee is the constraint; the
randomness only keeps the constraint from ever firing.**

Random ids are also preferred here over counting up from 1, because a user id
appears in URLs like `/api/users/:id`. Sequential ids would let anyone walk the
whole user table by adding one.

`cosmetics.cosmetic_id` is the exception: those are fixed, readable strings like
`border-gold`, because the shop catalog is a known list rather than rows that
appear as people play. Seeding twice cannot duplicate them.

**Room codes are the one place randomness genuinely can repeat.** Four
characters from a 32-letter alphabet is only about a million combinations, so
the generator checks each candidate against the database and `room_code` carries
a unique constraint behind that. They are drawn from `randomBytes`, not
`Math.random()` — a code that can be predicted lets a stranger walk into
somebody's room. The prompt word is chosen the same way, with `randomInt`, since
it is the one secret a round has.

## Pages

| Page | What it does |
|---|---|
| `index.html` | Log in / register, open or join a room, then draw or guess |
| `shop.html` | Buy cosmetic canvas borders with points, and equip one |
| `leaderboard.html` | Top 10 players by total score |

## API

Routes marked 🔒 need an `Authorization: Bearer <token>` header and answer
**401** without one. None of them take a user id: whoever the token belongs to
is the one acting.

### Users
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/users` | — | Register. Returns `{ token, user }` |
| POST | `/api/users/login` | — | Log in. Returns `{ token, user }` |
| GET | `/api/users/leaderboard` | — | Top players (supports `?limit=`) |
| GET | `/api/users` | 🔒 | List users (supports `?username=`) |
| GET | `/api/users/:id` | 🔒 | One user's profile |
| GET | `/api/users/:id/cosmetics` | 🔒 | Cosmetics a user owns |
| PUT | `/api/users/:id` | 🔒 own account | Rename yourself |
| DELETE | `/api/users/:id` | 🔒 own account | Delete your account and its data |

The leaderboard is left open on purpose — it is only usernames and scores, and
it means the scoreboard can be linked to without an account.

### Games
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/games` | 🔒 | List games (supports `?status=`, `?mode=`, `?difficulty=`, `?user_id=`) |
| GET | `/api/games/:id` | 🔒 | One game |
| GET | `/api/games/:id/state` | 🔒 | The polling endpoint — your view of the round |
| GET | `/api/games/:id/canvas` | 🔒 | The drawer's latest picture |
| GET | `/api/games/:id/guesses` | 🔒 | Every guess made in a round |
| POST | `/api/games` | 🔒 | Start a round (`opponent: 'player'` opens a room, `'bot'` starts a practice round) |
| POST | `/api/games/join` | 🔒 | Join a room as the guesser, by room code |
| POST | `/api/games/:id/guesses` | 🔒 | Send a guess |
| POST | `/api/games/:id/end` | 🔒 | Quit a round early |
| PUT | `/api/games/:id/canvas` | 🔒 | Save the drawer's picture |
| DELETE | `/api/games/:id` | 🔒 players only | Delete a game you were in |

The prompt word is left out of every response except the drawer's own, until the
round has finished — and which one you are is read from your token, not from
anything you send.

### Cosmetics
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/cosmetics` | 🔒 | Browse the shop |
| POST | `/api/cosmetics/:id/buy` | 🔒 | Buy a cosmetic, charged to you |

Errors always come back in the same shape:

```json
{ "error": { "code": "NOT_FOUND", "message": "User not found", "status": 404 } }
```

**Every** failure uses it, including the ones Express would normally answer
itself. A request to an endpoint that does not exist, a body that is not valid
JSON, and a drawing too large to accept all used to escape this shape — the
first as an HTML page, the other two as a bare 500 — so `src/middlewares/requestErrors.js`
catches them and reshapes them. The frontend can therefore call `response.json()`
on any failure without it throwing.

| Status | When |
|---|---|
| 400 | Validation failed, malformed JSON, or a body over the size limit |
| 401 | No token, an expired or tampered token, or wrong login details |
| 404 | No such row, or no such endpoint |
| 409 | Already exists, or the round has already been won or closed |
| 422 | Not enough points to buy that |
| 500 | Something unexpected — the real cause is logged, never sent |

One known wrinkle: acting on something that is not yours — renaming another
player, drawing when you are the guesser — answers **401** where **403** would
be the correct code. `ERROR_CODES` in `src/utils/_errors.js` has no entry for
403 and that file is marked not to be modified, so the message says exactly what
went wrong even though the status is broader than it should be.

## Project structure

```
index.js                     route registration and middleware
src/db/schema.js             table definitions
src/db/seed.js               database reset and sample data
src/models/                  database queries only, no HTTP
src/controllers/             request handling and business rules
src/routes/                  path definitions, auth guards, and validation
src/middlewares/auth.js      requireAuth and requireSelf, the login gate
src/middlewares/requestErrors.js  bad JSON, oversized bodies, unknown endpoints
src/utils/password.js        bcrypt password hashing
src/utils/token.js           signing and checking login tokens
src/utils/word-list.js       the prompt words, kept server-side on purpose
src/utils/bot-artist.js      asks Gemini to draw a word (npm run draw only)
src/db/draw-bot-pictures.js  the script behind npm run draw
src/db/bot-drawings.json     Kibry Bot's pictures, reloaded on every npm run db
src/frontend/                the game, shop, and leaderboard pages
_extras/tests/               vitest + supertest test suites
```

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Start the server |
| `npm run dev` | Start dev server with auto-reload |
| `npm run db` | Reset database and seed sample data (reloads the bot's pictures) |
| `npm run draw` | Draw new pictures for words Kibry Bot doesn't know yet |
| `npm test` | Run tests |

## Assumptions

Decisions taken while building this that another reading of the brief could
have gone the other way on.

**Game design**

- A scoring round needs two people signed in at the same time. There is no
  matchmaking queue and no way to leave a room open overnight — opening a new
  room closes any the player left waiting, so the lobby only ever lists rooms
  somebody is actually sitting in.
- Practice rounds against Kibry Bot pay nothing. The leaderboard is meant to be
  a record of rounds won against another person, so beating a computer on your
  own should not climb it.
- Both players are paid the same amount for a win. Drawing well is as much of
  the round as guessing well, so splitting the reward unevenly would be a
  judgement the server has no way to make.
- `points` is spendable and goes down in the shop; `total_score` is a lifetime
  total that only ever goes up and drives the leaderboard. Neither can be set
  through the API — they are only ever changed by winning a round.
- Room codes are four characters with `I`, `O`, `0` and `1` left out, on the
  assumption that codes get read aloud across a room.

**API behaviour**

- The two browsers poll rather than hold a socket open. A round is a handful of
  small reads a second, and polling keeps the server a plain Express app with no
  connection state to manage.
- The server owns the clock, the word, and the payout. Anything the browser
  could lie about is decided server-side, and a round is closed and paid inside
  one transaction so it can only ever pay out once.
- The login token lives in `localStorage` rather than an httpOnly cookie. A
  cookie would be the stronger choice against cross-site scripting; this is a
  same-origin app with no third-party scripts, and `localStorage` keeps the
  frontend a set of static files with no cookie or CSRF handling. Worth knowing
  as a trade-off rather than a free choice.
- There are no refresh tokens. When the two-hour token expires the player signs
  in again, which for a game session is a fair swap for the complexity.
- The leaderboard is the one route left open without a token, since it is only
  usernames and scores.

**Mocks and stand-ins**

- Which cosmetic a player has *equipped* is a browser preference in
  `localStorage`, not a database column. Ownership is stored properly in
  `user_cosmetics`; the choice of which owned border to wear is treated as a
  display setting, so it does not follow the player to another machine.
- Kibry Bot's pictures are generated ahead of time by `npm run draw` and shipped
  in `src/db/bot-drawings.json`. Nothing contacts an AI service while somebody
  is playing, which is why the game needs no API key and works offline.
