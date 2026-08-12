/**
 * leaderboard.js — shows the highest total scores.
 */

import { fetchLeaderboard } from './api.js';
import { loadSession } from './session.js';
import { createLeaderboardRow } from './components/leaderboard-row.js';

const leaderboardBody = document.getElementById('leaderboard-body');
const leaderboardMessage = document.getElementById('leaderboard-message');

// The leaderboard is public, so a signed-out visitor still sees it —
// there is simply no row to highlight.
const session = loadSession();
const currentUserId = session ? session.user_id : null;

/** Fetch the top players and build the table. */
const loadLeaderboard = async () => {
  try {
    const users = await fetchLeaderboard(10);

    leaderboardBody.innerHTML = '';

    if (users.length === 0) {
      leaderboardMessage.textContent = 'Nobody has played yet. Be the first!';
      return;
    }

    users.forEach((user, index) => {
      leaderboardBody.appendChild(createLeaderboardRow(user, index + 1, currentUserId));
    });

    leaderboardMessage.textContent = '';
  } catch (error) {
    leaderboardMessage.textContent = error.message;
    leaderboardMessage.classList.add('error');
  }
};

loadLeaderboard();
