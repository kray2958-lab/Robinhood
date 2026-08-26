export class RateLimiter {
  private timestamps: number[] = [];

  constructor(private readonly maxPerMinute: number) {}

  async acquire(): Promise<void> {
    const now = Date.now();
    const windowStart = now - 60_000;
    this.timestamps = this.timestamps.filter((t) => t > windowStart);

    if (this.timestamps.length >= this.maxPerMinute) {
      const oldest = this.timestamps[0]!;
      const waitMs = oldest + 60_000 - now + 50;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return this.acquire();
    }

    this.timestamps.push(now);
  }
}

let sharedLimiter: RateLimiter | null = null;

export function getRateLimiter(maxPerMinute: number): RateLimiter {
  if (!sharedLimiter) {
    sharedLimiter = new RateLimiter(maxPerMinute);
  }
  return sharedLimiter;
}
