// Express 4 does not catch errors thrown inside async routes. Wrapping a route with this sends the
// error to the central error handler in server.js instead of leaving the request hanging.
export const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
