'use strict';

// Token-bucket rate limiter: max 1 request per second toward Steam Market API.
// All other Steam API calls share a separate bucket (60/min).

class TokenBucket {
  constructor({ tokensPerInterval, intervalMs }) {
    this.tokensPerInterval = tokensPerInterval;
    this.intervalMs = intervalMs;
    this.tokens = tokensPerInterval;
    this.lastRefill = Date.now();
    this.queue = [];
    this.processing = false;
  }

  _refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const add = Math.floor((elapsed / this.intervalMs) * this.tokensPerInterval);
    if (add > 0) {
      this.tokens = Math.min(this.tokensPerInterval, this.tokens + add);
      this.lastRefill = now;
    }
  }

  acquire() {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this._process();
    });
  }

  _process() {
    if (this.processing) return;
    this.processing = true;

    const tick = () => {
      this._refill();

      while (this.queue.length > 0 && this.tokens >= 1) {
        this.tokens -= 1;
        this.queue.shift()();
      }

      if (this.queue.length > 0) {
        setTimeout(tick, this.intervalMs / this.tokensPerInterval);
      } else {
        this.processing = false;
      }
    };

    tick();
  }
}

// 1 req/sec for market price endpoint
const marketBucket = new TokenBucket({ tokensPerInterval: 1, intervalMs: 1000 });

// 60 req/min for general Steam Web API
const apiBucket = new TokenBucket({ tokensPerInterval: 60, intervalMs: 60000 });

module.exports = { marketBucket, apiBucket };
