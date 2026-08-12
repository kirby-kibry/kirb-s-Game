/**
 * Leaderboard Row Component
 *
 * Builds one table row for the leaderboard, highlighting the signed-in player.
 *
 * Usage:
 *   import { createLeaderboardRow } from '../components/leaderboard-row.js';
 *   tableBody.appendChild(createLeaderboardRow(user, 1, currentUserId));
 */

/** Medal for the top three places, plain number for everyone else. */
const formatRank = (rank) => {
  const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
  return medals[rank] || `${rank}`;
};

/**
 * Create one leaderboard row.
 *
 * @param {Object} user - A user from the API.
 * @param {number} rank - The player's position, starting at 1.
 * @param {string|null} currentUserId - The signed-in player's id, for highlighting.
 * @returns {HTMLTableRowElement} The finished row.
 */
export const createLeaderboardRow = (user, rank, currentUserId) => {
  const row = document.createElement('tr');

  if (user.user_id === currentUserId) {
    row.classList.add('current-player');
  }

  const rankCell = document.createElement('td');
  rankCell.classList.add('rank-cell');
  rankCell.textContent = formatRank(rank);

  const nameCell = document.createElement('td');
  nameCell.textContent = user.username;

  const scoreCell = document.createElement('td');
  scoreCell.classList.add('score-cell');
  scoreCell.textContent = user.total_score;

  row.appendChild(rankCell);
  row.appendChild(nameCell);
  row.appendChild(scoreCell);

  return row;
};
