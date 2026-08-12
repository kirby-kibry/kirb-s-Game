/**
 * game.js — the main game page.
 *
 * Kibry is played by two people at the same time. One opens a room and gets a
 * secret word to draw; the other joins with the room code and types guesses.
 *
 * The two browsers never talk to each other directly. Both of them ask the
 * server what is going on about once a second, and the server is the referee —
 * it owns the clock, the secret word, and the points.
 */

import {
  registerUser,
  loginUser,
  fetchUser,
  createGame,
  createPracticeGame,
  joinGame,
  fetchOpenGames,
  fetchGameState,
  fetchGameCanvas,
  sendGameCanvas,
  sendGuess,
  endGame,
  SESSION_EXPIRED_EVENT,
} from './api.js';
import { saveSession, loadSession, loadToken, clearSession, loadEquippedBorder } from './session.js';

/** How often each browser asks the server for the latest state, in milliseconds. */
const POLL_MS = 1000;

/** How often the list of open rooms refreshes while sitting in the lobby. */
const LOBBY_POLL_MS = 4000;

// --- DOM references ---

const authView = document.getElementById('auth-view');
const gameView = document.getElementById('game-view');

const authForm = document.getElementById('auth-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const registerBtn = document.getElementById('register-btn');
const authMessage = document.getElementById('auth-message');

const playerName = document.getElementById('player-name');
const playerPoints = document.getElementById('player-points');
const playerScore = document.getElementById('player-score');
const logoutBtn = document.getElementById('logout-btn');

const lobbySection = document.getElementById('lobby-section');
const waitingSection = document.getElementById('waiting-section');
const roundSection = document.getElementById('round-section');
const resultSection = document.getElementById('result-section');

const createBtn = document.getElementById('create-btn');
const practiceBtn = document.getElementById('practice-btn');
const joinForm = document.getElementById('join-form');
const roomCodeInput = document.getElementById('room-code-input');
const openRooms = document.getElementById('open-rooms');

const roomCode = document.getElementById('room-code');
const waitingWord = document.getElementById('waiting-word');
const cancelRoomBtn = document.getElementById('cancel-room-btn');

const roleBadge = document.getElementById('role-badge');
const promptLine = document.getElementById('prompt-line');
const timerDisplay = document.getElementById('timer');

const canvas = document.getElementById('drawing-canvas');
const context = canvas.getContext('2d');

const tools = document.getElementById('tools');
const colourPicker = document.getElementById('colour-picker');
const brushSize = document.getElementById('brush-size');
const eraserBtn = document.getElementById('eraser-btn');
const clearBtn = document.getElementById('clear-btn');

const guessForm = document.getElementById('guess-form');
const guessInput = document.getElementById('guess-input');
const guessFeed = document.getElementById('guess-feed');

const quitBtn = document.getElementById('quit-btn');

const resultTitle = document.getElementById('result-title');
const resultMessage = document.getElementById('result-message');
const resultImage = document.getElementById('result-image');
const playAgainBtn = document.getElementById('play-again-btn');

const gameMessage = document.getElementById('game-message');

// --- Round state ---

let currentUser = null;
let currentGameId = null;
let currentRole = null;
let lastStatus = null;

let stateTimerId = null;
let lobbyTimerId = null;

let canvasVersionSeen = -1;
let isFetchingCanvas = false;

let hasUnsentStrokes = false;
let isSendingCanvas = false;

let renderedGuessCount = -1;
let renderedStrokeCount = -1;
let failedPolls = 0;

let isDrawing = false;
let isErasing = false;

// --- Small helpers ---

/** Show a message to the player. Pass isError to style it red. */
const showMessage = (element, text, isError = false) => {
  element.textContent = text;
  element.classList.toggle('error', isError);
};

/** Show exactly one of the four game sections. */
const showSection = (section) => {
  lobbySection.hidden = section !== 'lobby';
  waitingSection.hidden = section !== 'waiting';
  roundSection.hidden = section !== 'round';
  resultSection.hidden = section !== 'result';
};

/** Read the selected difficulty radio button. */
const getSelectedDifficulty = () => {
  return document.querySelector('input[name="difficulty"]:checked').value;
};

/** Show a number of seconds as m:ss. */
const formatTime = (totalSeconds) => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');

  return `${minutes}:${seconds}`;
};

// --- Canvas ---

/** Fill the canvas white so the saved picture is not transparent. */
const clearCanvas = () => {
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
};

/** Apply the player's equipped cosmetic border, if they have one. */
const applyEquippedBorder = () => {
  const border = loadEquippedBorder();

  if (border) {
    canvas.style.border = border.css_value;
    canvas.dataset.cosmetic = border.cosmetic_id;
  } else {
    canvas.style.border = '';
    delete canvas.dataset.cosmetic;
  }
};

/**
 * Convert a mouse or touch event into canvas coordinates.
 * The canvas is scaled by CSS, so the ratio has to be applied by hand.
 */
const getCanvasPosition = (event) => {
  const bounds = canvas.getBoundingClientRect();
  const point = event.touches ? event.touches[0] : event;

  return {
    x: (point.clientX - bounds.left) * (canvas.width / bounds.width),
    y: (point.clientY - bounds.top) * (canvas.height / bounds.height),
  };
};

/** Begin a brush stroke. Only the drawer is allowed to. */
const startStroke = (event) => {
  if (currentRole !== 'drawer') return;

  event.preventDefault();
  isDrawing = true;

  const { x, y } = getCanvasPosition(event);
  context.beginPath();
  context.moveTo(x, y);
};

/** Continue a brush stroke while the pointer moves. */
const continueStroke = (event) => {
  if (!isDrawing) return;
  event.preventDefault();

  const { x, y } = getCanvasPosition(event);

  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = Number(brushSize.value);
  context.strokeStyle = isErasing ? '#ffffff' : colourPicker.value;

  context.lineTo(x, y);
  context.stroke();

  // Flag the picture as changed so the next upload actually sends something.
  hasUnsentStrokes = true;
};

/** End the current brush stroke. */
const endStroke = () => {
  isDrawing = false;
};

canvas.addEventListener('mousedown', startStroke);
canvas.addEventListener('mousemove', continueStroke);
canvas.addEventListener('mouseup', endStroke);
canvas.addEventListener('mouseleave', endStroke);

canvas.addEventListener('touchstart', startStroke);
canvas.addEventListener('touchmove', continueStroke);
canvas.addEventListener('touchend', endStroke);

eraserBtn.addEventListener('click', () => {
  isErasing = !isErasing;
  eraserBtn.textContent = isErasing ? 'Draw' : 'Eraser';
  eraserBtn.classList.toggle('active', isErasing);
});

clearBtn.addEventListener('click', () => {
  clearCanvas();
  hasUnsentStrokes = true;
});

/** Send the drawer's picture up, but only when it has actually changed. */
const uploadCanvas = async () => {
  if (currentRole !== 'drawer') return;
  if (!currentGameId || !hasUnsentStrokes || isSendingCanvas) return;

  isSendingCanvas = true;
  hasUnsentStrokes = false;

  try {
    await sendGameCanvas(currentGameId, canvas.toDataURL('image/png'));
  } catch {
    // A failed upload is not worth interrupting the round for — the next
    // stroke will try again.
    hasUnsentStrokes = true;
  } finally {
    isSendingCanvas = false;
  }
};

/** Copy the drawer's latest picture onto the guesser's canvas. */
const downloadCanvas = async () => {
  if (isFetchingCanvas) return;

  isFetchingCanvas = true;

  try {
    const picture = await fetchGameCanvas(currentGameId);

    canvasVersionSeen = picture.canvas_version;

    if (!picture.canvas_data) return;

    const image = new Image();
    image.onload = () => context.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.src = picture.canvas_data;
  } catch {
    // Ignore a dropped frame — the next poll will ask again.
  } finally {
    isFetchingCanvas = false;
  }
};

/**
 * Paint a practice drawing onto the canvas.
 *
 * Kibry Bot sends brush strokes rather than a picture, and only the ones it
 * has drawn so far. Repainting the whole set each time keeps the canvas right
 * even if a poll goes missing.
 */
const drawStrokes = (strokes) => {
  clearCanvas();

  context.lineCap = 'round';
  context.lineJoin = 'round';

  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;

    context.strokeStyle = stroke.colour;
    context.lineWidth = stroke.width;

    context.beginPath();
    context.moveTo(stroke.points[0].x, stroke.points[0].y);

    // A single-point stroke is a dot — draw it back onto itself so the round
    // brush cap leaves a mark.
    for (const point of stroke.points.slice(1)) {
      context.lineTo(point.x, point.y);
    }

    if (stroke.points.length === 1) {
      context.lineTo(stroke.points[0].x, stroke.points[0].y);
    }

    context.stroke();
  }
};

// --- Player profile ---

/** Re-fetch points and score from the API so the header is always accurate. */
const refreshPlayer = async () => {
  const user = await fetchUser(currentUser.user_id);

  playerName.textContent = user.username;
  playerPoints.textContent = user.points;
  playerScore.textContent = user.total_score;
};

// --- The lobby ---

/** Draw the list of rooms that are still waiting for a guesser. */
const renderOpenRooms = (rooms) => {
  openRooms.innerHTML = '';

  if (rooms.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-note';
    empty.textContent = 'No open rooms right now — open one yourself.';
    openRooms.appendChild(empty);
    return;
  }

  for (const room of rooms) {
    const item = document.createElement('li');

    const label = document.createElement('span');
    label.innerHTML = `<strong>${room.room_code}</strong> &middot; ${room.difficulty}`;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = 'Join';
    button.addEventListener('click', () => handleJoin(room.room_code));

    item.appendChild(label);
    item.appendChild(button);
    openRooms.appendChild(item);
  }
};

/** Refresh the open-room list, leaving out rooms this player opened. */
const refreshOpenRooms = async () => {
  try {
    const rooms = await fetchOpenGames();
    renderOpenRooms(rooms.filter((room) => room.drawer_id !== currentUser.user_id));
  } catch {
    // The lobby list is a convenience — a failed refresh can be ignored.
  }
};

/** Start refreshing the open-room list. */
const startLobbyRefresh = () => {
  stopLobbyRefresh();
  refreshOpenRooms();
  lobbyTimerId = setInterval(refreshOpenRooms, LOBBY_POLL_MS);
};

/** Stop refreshing the open-room list. */
const stopLobbyRefresh = () => {
  clearInterval(lobbyTimerId);
  lobbyTimerId = null;
};

/** Go back to the lobby and forget the round that just finished. */
const returnToLobby = () => {
  stopPolling();
  currentGameId = null;
  currentRole = null;
  lastStatus = null;

  showMessage(gameMessage, '');
  showSection('lobby');
  startLobbyRefresh();
};

// --- Drawing the round on screen ---

/** Show the drawer their room code while they wait for somebody to join. */
const renderWaiting = (state) => {
  roomCode.textContent = state.room_code;
  waitingWord.textContent = state.prompt_word;

  showSection('waiting');
};

/** Redraw the guess feed. */
const renderGuesses = (guesses) => {
  guessFeed.innerHTML = '';

  if (guesses.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-note';
    empty.textContent = 'No guesses yet.';
    guessFeed.appendChild(empty);
    return;
  }

  for (const guess of guesses) {
    const item = document.createElement('li');
    item.textContent = guess.guess_text;
    item.classList.toggle('correct', Boolean(guess.is_correct));
    guessFeed.appendChild(item);
  }

  guessFeed.scrollTop = guessFeed.scrollHeight;
};

/** Set up the round screen for whichever side of the game this player is on. */
const enterRound = (state) => {
  clearCanvas();

  canvasVersionSeen = -1;
  hasUnsentStrokes = false;
  renderedGuessCount = -1;
  renderedStrokeCount = -1;

  const isDrawer = state.role === 'drawer';

  roleBadge.textContent = isDrawer ? 'You are drawing' : 'You are guessing';
  roleBadge.classList.toggle('guessing', !isDrawer);

  tools.hidden = !isDrawer;
  guessForm.hidden = isDrawer;
  canvas.classList.toggle('watching', !isDrawer);

  showSection('round');

  if (!isDrawer) {
    guessInput.value = '';
    guessInput.focus();
  }
};

/** Update the round screen from the latest server state. */
const renderRound = (state) => {
  if (lastStatus !== 'drawing') enterRound(state);

  const opponent = state.role === 'drawer' ? state.guesser : state.drawer;

  if (state.role === 'drawer') {
    promptLine.innerHTML = `Draw: <strong>${state.prompt_word}</strong>`;
  } else {
    promptLine.innerHTML = `Guess: <strong class="hint">${state.prompt_hint}</strong>`;
  }

  if (state.mode === 'ai') {
    roleBadge.title = 'Playing against Kibry Bot';
  } else if (opponent) {
    roleBadge.title = `Playing against ${opponent.username}`;
  }

  timerDisplay.textContent = formatTime(state.seconds_left);
  timerDisplay.classList.toggle('urgent', state.seconds_left <= 10);

  if (state.guesses.length !== renderedGuessCount) {
    renderGuesses(state.guesses);
    renderedGuessCount = state.guesses.length;
  }

  if (state.mode === 'ai') {
    // Kibry Bot's drawing arrives as strokes, and grows as the clock runs down.
    if (state.strokes.length !== renderedStrokeCount) {
      drawStrokes(state.strokes);
      renderedStrokeCount = state.strokes.length;
    }
    return;
  }

  // The guesser only downloads the picture once the version number moves.
  if (state.role !== 'drawer' && state.canvas_version !== canvasVersionSeen) {
    downloadCanvas();
  }
};

/** Show the end-of-round screen and top the player's stats back up. */
const renderResult = async (state) => {
  stopPolling();

  const wasDrawer = state.role === 'drawer';
  const wasPractice = state.mode === 'ai';

  if (state.status === 'won' && wasPractice) {
    resultTitle.textContent = 'Guessed it!';
    resultMessage.textContent = `"${state.prompt_word}" was right. Practice rounds don't earn points — beat a real person for those.`;
  } else if (state.status === 'won') {
    resultTitle.textContent = `Guessed it! +${state.points_earned} points each`;
    resultMessage.textContent = wasDrawer
      ? `${state.guesser.username} worked out "${state.prompt_word}" from your drawing. You both earned ${state.points_earned} points.`
      : `"${state.prompt_word}" was right. You and ${state.drawer.username} both earned ${state.points_earned} points.`;
  } else if (state.status === 'timeout' && wasPractice) {
    resultTitle.textContent = "Time's up!";
    resultMessage.textContent = `Kibry Bot was drawing "${state.prompt_word}".`;
  } else if (state.status === 'timeout') {
    resultTitle.textContent = "Time's up!";
    resultMessage.textContent = `The word was "${state.prompt_word}". Nobody scored this round.`;
  } else {
    resultTitle.textContent = 'Round ended';
    resultMessage.textContent = `The word was "${state.prompt_word}". A player left, so nobody scored.`;
  }

  resultImage.hidden = true;

  if (wasPractice) {
    // The round is over, so the server sends the whole drawing — paint it and
    // photograph the canvas so the finished picture stays on the result screen.
    drawStrokes(state.strokes);
    resultImage.src = canvas.toDataURL('image/png');
    resultImage.hidden = false;
  } else {
    try {
      const picture = await fetchGameCanvas(state.game_id);

      if (picture.canvas_data) {
        resultImage.src = picture.canvas_data;
        resultImage.hidden = false;
      }
    } catch {
      // No final picture to show — the round ended before anything was drawn.
    }
  }

  showSection('result');
  await refreshPlayer();
};

// --- The polling loop ---

/** Ask the server what is happening, and put it on screen. */
const pollGameState = async () => {
  if (!currentGameId) return;

  try {
    const state = await fetchGameState(currentGameId);

    currentRole = state.role;

    if (state.status === 'waiting') {
      renderWaiting(state);
    } else if (state.status === 'drawing') {
      renderRound(state);
      await uploadCanvas();
    } else {
      await renderResult(state);
    }

    lastStatus = state.status;
    failedPolls = 0;
  } catch (error) {
    failedPolls += 1;

    // One dropped request is not worth ending the round over, but three in a
    // row means the room really is gone.
    if (failedPolls >= 3) {
      showMessage(gameMessage, error.message, true);
      returnToLobby();
    }
  }
};

/** Start watching the current room. */
const startPolling = () => {
  stopPolling();
  stopLobbyRefresh();

  failedPolls = 0;
  pollGameState();
  stateTimerId = setInterval(pollGameState, POLL_MS);
};

/** Stop watching the current room. */
const stopPolling = () => {
  clearInterval(stateTimerId);
  stateTimerId = null;
};

// --- Lobby actions ---

/** Open a room and wait for an opponent. */
const handleCreate = async () => {
  createBtn.disabled = true;
  showMessage(gameMessage, '');

  try {
    const game = await createGame(getSelectedDifficulty());

    currentGameId = game.game_id;
    currentRole = 'drawer';
    lastStatus = null;

    startPolling();
  } catch (error) {
    showMessage(gameMessage, error.message, true);
  } finally {
    createBtn.disabled = false;
  }
};

/** Start a practice round where Kibry Bot draws and you guess. */
const handlePractice = async () => {
  practiceBtn.disabled = true;
  createBtn.disabled = true;
  showMessage(gameMessage, 'Kibry Bot is sketching… this takes a few seconds.');

  try {
    const game = await createPracticeGame(getSelectedDifficulty());

    currentGameId = game.game_id;
    currentRole = 'guesser';
    lastStatus = null;

    showMessage(gameMessage, '');
    startPolling();
  } catch (error) {
    showMessage(gameMessage, error.message, true);
  } finally {
    practiceBtn.disabled = false;
    createBtn.disabled = false;
  }
};

/** Join somebody else's room as the guesser. */
const handleJoin = async (code) => {
  const cleaned = code.trim().toUpperCase();

  if (!cleaned) {
    showMessage(gameMessage, 'Type the room code your opponent gave you.', true);
    return;
  }

  showMessage(gameMessage, '');

  try {
    const game = await joinGame(cleaned);

    currentGameId = game.game_id;
    currentRole = 'guesser';
    lastStatus = null;
    roomCodeInput.value = '';

    startPolling();
  } catch (error) {
    showMessage(gameMessage, error.message, true);
  }
};

/** Send a guess to the server. */
const handleGuess = async (event) => {
  event.preventDefault();

  const guess = guessInput.value.trim();
  if (!guess) return;

  guessInput.value = '';

  try {
    await sendGuess(currentGameId, guess);

    // The next poll picks up the result, so there is nothing to render here.
    await pollGameState();
  } catch (error) {
    showMessage(gameMessage, error.message, true);
  }
};

/** Leave the round early. Nobody scores. */
const handleQuit = async () => {
  try {
    await endGame(currentGameId);
    await pollGameState();
  } catch (error) {
    showMessage(gameMessage, error.message, true);
    returnToLobby();
  }
};

createBtn.addEventListener('click', handleCreate);
practiceBtn.addEventListener('click', handlePractice);

joinForm.addEventListener('submit', (event) => {
  event.preventDefault();
  handleJoin(roomCodeInput.value);
});

cancelRoomBtn.addEventListener('click', async () => {
  try {
    await endGame(currentGameId);
  } catch {
    // The room may already be gone, which is exactly what we wanted anyway.
  }

  returnToLobby();
});

guessForm.addEventListener('submit', handleGuess);
quitBtn.addEventListener('click', handleQuit);
playAgainBtn.addEventListener('click', returnToLobby);

// --- Sign in and out ---

/**
 * Switch the page into signed-in mode.
 *
 * The token is stored alongside the player because it, not the stored id, is
 * what the server actually trusts on every request from here on.
 */
const enterGame = async (token, user) => {
  currentUser = user;
  saveSession(token, user);

  showMessage(authMessage, '');
  authView.hidden = true;
  gameView.hidden = false;

  applyEquippedBorder();
  returnToLobby();

  await refreshPlayer();
};

/**
 * Switch the page back into signed-out mode and forget the login.
 *
 * Shared by the log out button and by a session that has expired underneath
 * the player, so both land in exactly the same state.
 */
const leaveGame = (message = '') => {
  clearSession();
  stopPolling();
  stopLobbyRefresh();

  currentUser = null;
  currentGameId = null;
  currentRole = null;

  gameView.hidden = true;
  authView.hidden = false;
  authForm.reset();
  showMessage(authMessage, message, Boolean(message));
};

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showMessage(authMessage, 'Signing in...');

  try {
    const { token, user } = await loginUser(usernameInput.value.trim(), passwordInput.value);
    await enterGame(token, user);
  } catch (error) {
    showMessage(authMessage, error.message, true);
  }
});

registerBtn.addEventListener('click', async () => {
  showMessage(authMessage, 'Creating your account...');

  try {
    // Registering hands back a token too, so there is no second sign-in step.
    const { token, user } = await registerUser(usernameInput.value.trim(), passwordInput.value);
    await enterGame(token, user);
  } catch (error) {
    showMessage(authMessage, error.message, true);
  }
});

logoutBtn.addEventListener('click', () => leaveGame());

// A token only lasts a couple of hours. When one runs out mid-session api.js
// raises this, and the player is put back on the sign-in form with an
// explanation rather than being left staring at a page that has quietly
// stopped working.
window.addEventListener(SESSION_EXPIRED_EVENT, () => {
  leaveGame('Your session has expired — please sign in again.');
});

// --- Start up ---

/** Restore the previous session if there is one, otherwise show the sign-in form. */
const init = async () => {
  const session = loadSession();

  if (!session) {
    authView.hidden = false;
    return;
  }

  try {
    // Check the stored token is still good before trusting it. A rejected one
    // raises the expiry event above, which shows the sign-in form.
    const user = await fetchUser(session.user_id);
    await enterGame(loadToken(), user);
  } catch {
    clearSession();
    authView.hidden = false;
  }
};

init();
