import { describe, expect, it } from "vitest";

import { OAuthSessionCoordinator } from "./oauthSessionCoordinator";

describe("OAuthSessionCoordinator", () => {
  it("invalidates work started before a sign-out", () => {
    const coordinator = new OAuthSessionCoordinator();
    const operation = coordinator.startOperation();

    expect(coordinator.isCurrent(operation)).toBe(true);
    coordinator.invalidate();
    expect(coordinator.isCurrent(operation)).toBe(false);
    expect(() =>
      coordinator.assertCurrent(operation, "session changed"),
    ).toThrowError(/session changed/);
  });

  it("invalidates an older sign-in when a newer one starts", () => {
    const coordinator = new OAuthSessionCoordinator();
    const older = coordinator.startOperation();
    const newer = coordinator.startOperation();

    expect(coordinator.isCurrent(older)).toBe(false);
    expect(coordinator.isCurrent(newer)).toBe(true);
  });

  it("serializes the final check-and-write section", async () => {
    const coordinator = new OAuthSessionCoordinator();
    const events: string[] = [];

    const first = coordinator.mutate(async () => {
      events.push("first:start");
      await Promise.resolve();
      events.push("first:end");
    });
    const second = coordinator.mutate(async () => {
      events.push("second:start");
      events.push("second:end");
    });

    await Promise.all([first, second]);
    expect(events).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
  });
});
