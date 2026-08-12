/**
 * word-list.js — the prompt words a round can pick from, plus the rules that
 * depend on the chosen difficulty.
 *
 * This lives on the server on purpose. The prompt is only ever sent back to the
 * drawer, so the guesser cannot read the answer out of the page source.
 */

import { randomInt } from 'crypto';

/**
 * Every word has to pass two tests: it has to be drawable as a simple doodle,
 * and the drawing has to point at one obvious answer. Words with a common
 * second name are left out on purpose — a guesser who types "plane" when the
 * word is "aeroplane" would be told they are wrong, which is no fun.
 *
 * Plain shapes like a circle or a square are left out for the same reason:
 * they could be a ball, the sun, an egg or a coin, and there is no way for the
 * guesser to tell which.
 */
export const WORDS_BY_DIFFICULTY = {
  easy: [
    'apple', 'balloon', 'banana', 'bed', 'bird', 'boat', 'bone', 'book', 'bus', 'cake',
    'candle', 'car', 'carrot', 'cat', 'chair', 'clock', 'cloud', 'crown', 'cup', 'dog',
    'door', 'drum', 'egg', 'eye', 'fish', 'flag', 'flower', 'fork', 'hammer', 'hat',
    'heart', 'house', 'key', 'kite', 'ladder', 'lamp', 'leaf', 'moon', 'mushroom', 'pencil',
    'shoe', 'snake', 'snowman', 'sock', 'spoon', 'star', 'sun', 'table', 'tent', 'tree',
    'umbrella',
  ],
  medium: [
    'anchor', 'bicycle', 'butterfly', 'cactus', 'camera', 'campfire', 'castle', 'crab', 'cupcake', 'dinosaur',
    'dolphin', 'dragon', 'duck', 'elephant', 'ferris wheel', 'frog', 'ghost', 'giraffe', 'guitar', 'hamburger',
    'helicopter', 'horse', 'hot air balloon', 'igloo', 'mermaid', 'octopus', 'owl', 'penguin', 'piano', 'pumpkin',
    'pyramid', 'rabbit', 'rainbow', 'robot', 'rocket', 'sandwich', 'scarecrow', 'shark', 'skateboard', 'snail',
    'snowflake', 'spider', 'starfish', 'sunglasses', 'teapot', 'telescope', 'tractor', 'train', 'turtle', 'unicorn',
    'volcano', 'whale', 'windmill',
  ],
  hard: [
    'accordion', 'astronaut', 'carousel', 'cathedral', 'chandelier', 'drawbridge', 'escalator', 'excavator',
    'fire hydrant', 'gramophone', 'grandfather clock', 'greenhouse', 'hang glider', 'harp', 'hourglass', 'hovercraft',
    'jellyfish', 'lawnmower', 'lighthouse', 'microscope', 'pagoda', 'parachute', 'record player', 'roller coaster',
    'satellite', 'saxophone', 'sewing machine', 'skyscraper', 'space station', 'steam engine', 'stethoscope',
    'submarine', 'suspension bridge', 'traffic light', 'treadmill', 'typewriter', 'vending machine', 'wheelbarrow',
    'xylophone',
  ],
};

/** How long a round lasts, in seconds, for each difficulty. */
export const SECONDS_BY_DIFFICULTY = { easy: 90, medium: 60, hard: 45 };

/** How many points each player earns when the guess lands, for each difficulty. */
export const POINTS_BY_DIFFICULTY = { easy: 10, medium: 20, hard: 30 };

/**
 * Pick a random prompt word for a difficulty.
 *
 * The word is the one secret in a round, so it is chosen with `randomInt` from
 * the crypto module rather than `Math.random()`. `Math.random()` is a plain
 * arithmetic sequence — watch enough of its output and you can work out where
 * it is up to and say what comes next, which for the answer to the game is the
 * wrong property to have. `randomInt` also avoids the modulo bias that plain
 * scaling introduces when the list length is not a power of two.
 *
 * @param {string} difficulty - 'easy', 'medium', or 'hard'.
 * @returns {string} A word for the drawer to draw.
 */
export const pickRandomWord = (difficulty) => {
  const words = WORDS_BY_DIFFICULTY[difficulty] || WORDS_BY_DIFFICULTY.easy;
  return words[randomInt(words.length)];
};

/**
 * Tidy a word or a guess so that "  The  Cat " and "the cat" count as a match.
 * @param {string} value - The raw text.
 * @returns {string} Lowercased, trimmed, with runs of spaces collapsed to one.
 */
export const normaliseGuess = (value) => {
  return String(value).trim().toLowerCase().replace(/\s+/g, ' ');
};

/**
 * Build the blanked-out hint the guesser sees, e.g. 'roller coaster' becomes
 * '______ _______'. It gives away the shape of the answer but not the letters.
 * @param {string} word - The secret prompt word.
 * @returns {string} One underscore per letter, with spaces kept.
 */
export const buildPromptHint = (word) => {
  return word
    .split(' ')
    .map((part) => '_'.repeat(part.length))
    .join(' ');
};
