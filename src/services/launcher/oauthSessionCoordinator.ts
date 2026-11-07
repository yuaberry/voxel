/**
 * Coordinates mutations of one local OAuth session.
 *
 * A generation invalidates work that started before a sign-out or a newer
 * sign-in. The mutation queue makes the final check-and-write section atomic,
 * so a late refresh can never recreate credentials after sign-out.
 */
export class OAuthSessionCoordinator {
  private generation = 0;
  private mutationTail: Promise<void> = Promise.resolve();

  /** Starts a new sign-in and invalidates every older sign-in. */
  startOperation(): number {
    this.generation += 1;
    return this.generation;
  }

  get version(): number {
    return this.generation;
  }

  invalidate(): number {
    this.generation += 1;
    return this.generation;
  }

  isCurrent(operation: number): boolean {
    return operation === this.generation;
  }

  assertCurrent(operation: number, message: string): void {
    if (!this.isCurrent(operation)) {
      throw new DOMException(message, "AbortError");
    }
  }

  /** Serializes only the final check-and-write section, never the network wait. */
  async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail;
    let release!: () => void;
    this.mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
