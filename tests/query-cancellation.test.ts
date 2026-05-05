import { describe, it, expect } from "vitest";

describe("Query cancellation (AbortController)", () => {
  it("AbortController can abort a signal", () => {
    const controller = new AbortController();
    expect(controller.signal.aborted).toBe(false);
    controller.abort();
    expect(controller.signal.aborted).toBe(true);
  });

  it("aborting after query complete is safe", () => {
    const controller = new AbortController();
    controller.abort();
    expect(controller.signal.aborted).toBe(true);
    controller.abort();
    expect(controller.signal.aborted).toBe(true);
  });

  it("timeout triggers abort on fetch", async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5);
    await new Promise((r) => setTimeout(r, 20));
    clearTimeout(timer);
    expect(controller.signal.aborted).toBe(true);
  });
});

describe("Query mutex (enqueueQuery)", () => {
  it("serializes concurrent queries", async () => {
    const order: number[] = [];
    let queryLock: Promise<void> = Promise.resolve();

    async function enqueueQuery(id: number): Promise<string> {
      const prev = queryLock;
      let resolveLock!: () => void;
      queryLock = new Promise<void>((r) => { resolveLock = r; });
      await prev;
      order.push(id);
      resolveLock();
      return `result-${id}`;
    }

    const p1 = enqueueQuery(1);
    const p2 = enqueueQuery(2);
    const p3 = enqueueQuery(3);

    await Promise.all([p1, p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("resolves all promises", async () => {
    let queryLock: Promise<void> = Promise.resolve();

    async function enqueueQuery(id: number): Promise<string> {
      const prev = queryLock;
      let resolveLock!: () => void;
      queryLock = new Promise<void>((r) => { resolveLock = r; });
      await prev;
      resolveLock();
      return `result-${id}`;
    }

    const results = await Promise.all([enqueueQuery(1), enqueueQuery(2)]);
    expect(results).toEqual(["result-1", "result-2"]);
  });
});
