// The error a feature throws to refuse a request; `status` is the HTTP status to answer with and
// nothing was written. http.js turns it into the answer; anything else thrown becomes a 502.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
