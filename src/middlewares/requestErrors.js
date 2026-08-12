/**
 * Translates failures that happen before any route runs into the app's own
 * error shape.
 *
 * `express.json()` rejects a malformed or oversized body itself, and the error
 * it raises describes the problem with `type` and `status` rather than the
 * `code` the global handler looks for. Without this both came back as a generic
 * 500 "Internal server error", which is both the wrong status and useless to
 * whoever sent the request.
 */

import { AppError } from '../utils/_errors.js';

/**
 * Turn body-parser failures into AppErrors.
 *
 * Registered as error-handling middleware, so it needs all four parameters for
 * Express to recognise it, and it must sit after the routes but before the
 * global handler it hands off to.
 *
 * Note: a body over the limit is really a 413. `ERROR_CODES` has no entry for
 * that and `_errors.js` is marked not to be modified, so it is reported as a
 * 400 with an explicit message instead — wrong in code, right in substance.
 */
// eslint-disable-next-line no-unused-vars
export const handleRequestErrors = (err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return next(new AppError('VALIDATION_ERROR', 'The request body is not valid JSON'));
  }

  if (err.type === 'entity.too.large') {
    return next(new AppError(
      'VALIDATION_ERROR',
      'That drawing is too large to send. Try clearing the canvas and drawing it more simply.'
    ));
  }

  next(err);
};

/**
 * Answer any unmatched path under /api in the same shape as every other error.
 *
 * Without this Express falls back to its built-in handler, which sends an HTML
 * page — so a typo'd endpoint was the one failure the frontend could not read,
 * because `response.json()` throws on it.
 */
export const handleUnknownApiRoute = (req, res, next) => {
  next(new AppError('NOT_FOUND', `No API endpoint matches ${req.method} ${req.originalUrl}`));
};
