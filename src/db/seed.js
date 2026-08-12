/**
 * Seed data and database reset script. Run with: npm run db
 *
 * To add your own seed data:
 *   1. Import your table schema from './schema.js'
 *   2. Add a sample data array
 *   3. Insert it inside the seed() function with db.insert()
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import 'dotenv/config';

import { users, games, guesses, cosmetics, bot_drawings } from './schema.js';
import { hashPassword } from '../utils/password.js';

// --- Seed data ---

/**
 * The shop catalog. `css_value` is applied as the canvas border in the browser.
 * IDs are fixed strings rather than random UUIDs so that seeding twice does not
 * silently create duplicate rows.
 */
const shopCosmetics = [
  { cosmetic_id: 'border-red', name: 'Red Border', description: 'A fiery red canvas border', price: 30, css_value: '6px solid #e63946' },
  { cosmetic_id: 'border-blue', name: 'Blue Border', description: 'A cool ocean blue canvas border', price: 30, css_value: '6px solid #1d7fd4' },
  { cosmetic_id: 'border-neon', name: 'Neon Green Border', description: 'A bright neon green canvas border', price: 50, css_value: '6px solid #39ff14' },
  { cosmetic_id: 'border-gold', name: 'Gold Border', description: 'A prestigious gold canvas border', price: 80, css_value: '6px solid #d4af37' },
  { cosmetic_id: 'border-rainbow', name: 'Rainbow Border', description: 'A dazzling rainbow canvas border', price: 150, css_value: '6px solid transparent' },
];

/**
 * Sample players so the app is not empty on first run. The game needs two
 * people, so there are two accounts to sign in with in two browser windows.
 * Password for both: password123
 *
 * Built by a function rather than a plain array because bcrypt hashes on a
 * background thread, so hashing has to be awaited.
 */
const buildSampleUsers = async () => [
  { user_id: 'demo-user-ava', username: 'ava', password: await hashPassword('password123'), total_score: 120, points: 60 },
  { user_id: 'demo-user-ben', username: 'ben', password: await hashPassword('password123'), total_score: 60, points: 60 },
];

/** A finished round so the match history is not empty. */
const finishedGameId = randomUUID();

const sampleGames = [
  {
    game_id: finishedGameId,
    room_code: 'DEMO',
    drawer_id: 'demo-user-ava',
    guesser_id: 'demo-user-ben',
    prompt_word: 'lighthouse',
    difficulty: 'hard',
    status: 'won',
    winning_guess: 'lighthouse',
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
  },
];

/**
 * Kibry Bot's pictures, drawn ahead of time by `npm run draw`.
 *
 * They are read from a file rather than being drawn here, which is what lets
 * them survive a database reset — this script wipes the database, but the file
 * is untouched and the drawings go straight back in.
 */
const loadBotDrawings = () => {
  const file = fileURLToPath(new URL('bot-drawings.json', import.meta.url));

  if (!fs.existsSync(file)) return [];

  return JSON.parse(fs.readFileSync(file, 'utf8')).map((drawing) => ({
    word: drawing.word,
    difficulty: drawing.difficulty,
    strokes: JSON.stringify(drawing.strokes),
  }));
};

/** The guesses from that finished round. */
const sampleGuesses = [
  { game_id: finishedGameId, user_id: 'demo-user-ben', guess_text: 'tower', is_correct: false },
  { game_id: finishedGameId, user_id: 'demo-user-ben', guess_text: 'lighthouse', is_correct: true },
];

// --- Seed function ---

/** Insert seed data into the database. */
export const seed = async (db) => {
  await db.insert(cosmetics).values(shopCosmetics);
  console.log(`  Inserted ${shopCosmetics.length} cosmetics`);

  const sampleUsers = await buildSampleUsers();

  await db.insert(users).values(sampleUsers);
  console.log(`  Inserted ${sampleUsers.length} users (login: ava / password123)`);

  await db.insert(games).values(sampleGames);
  console.log(`  Inserted ${sampleGames.length} games`);

  await db.insert(guesses).values(sampleGuesses);
  console.log(`  Inserted ${sampleGuesses.length} guesses`);

  const botDrawings = loadBotDrawings();

  if (botDrawings.length > 0) {
    await db.insert(bot_drawings).values(botDrawings);
    console.log(`  Inserted ${botDrawings.length} bot drawings`);
  } else {
    console.log('  No bot drawings yet — run "npm run draw" to give Kibry Bot some pictures');
  }
};

// --- Database reset (no need to modify below) ---

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');

const dbUrl = process.env.DATABASE_URL || 'file:local.db';
const dbPath = dbUrl.replace('file:', '');
const absoluteDbPath = path.resolve(projectRoot, dbPath);

const resetDatabase = async () => {
  try {
    // Step 1 — Delete the old database file
    if (fs.existsSync(absoluteDbPath)) {
      fs.unlinkSync(absoluteDbPath);
      console.log(`Deleted old database: ${dbPath}`);
    }

    // Step 2 — Recreate tables from schema.js
    console.log('Creating tables from schema...');
    execSync('npx drizzle-kit push', { cwd: projectRoot, stdio: 'inherit' });

    // Step 3 — Insert seed data
    console.log('Seeding database...');
    const { db } = await import('./connection.js');
    await seed(db);

    console.log('Done! Database is ready.');
  } catch (error) {
    console.error('Failed to reset database:', error.message);
    process.exit(1);
  }
};

resetDatabase();
