import { describe, it, expect, vi, beforeEach } from "vitest";
describe("native transport", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
  });
  it("rejects disconnected execution instead of simulating audio", async () => {
    vi.stubGlobal("window", {});
    const { command } = await import("./bridge");
    await expect(command("play")).rejects.toThrow("Open ToneScope");
  });
  it("sends the versioned allowlisted envelope and resolves native completion", async () => {
    let listener: (v: unknown) => void = () => {};
    const emit = vi.fn();
    vi.stubGlobal("window", {
      __JUCE__: {
        backend: {
          addEventListener: (_name: string, fn: (v: unknown) => void) => {
            listener = fn;
          },
          emitEvent: emit,
        },
      },
    });
    const { command } = await import("./bridge");
    const result = command("parameter", { key: "driveDb", value: 12 });
    expect(emit).toHaveBeenCalledWith("__juce__invoke", {
      name: "tonescopeCommand",
      params: [{ version: 1, action: "parameter", key: "driveDb", value: 12 }],
      resultId: 0,
    });
    listener({ promiseId: 0, result: { version: 1, revision: 5 } });
    expect(await result).toEqual({ version: 1, revision: 5 });
  });
  it("times out without leaking an unresolved native operation", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      __JUCE__: { backend: { addEventListener: vi.fn(), emitEvent: vi.fn() } },
    });
    const { command } = await import("./bridge");
    const result = expect(command("snapshot")).rejects.toThrow(
      "did not respond",
    );
    await vi.advanceTimersByTimeAsync(8001);
    await result;
  });
});
describe("measured traces", () => {
  beforeEach(() => vi.stubGlobal("window", {}));
  it("does not invent traces when measured data is absent", async () => {
    const { wavePath, spectrumPath } = await import("./bridge");
    expect(wavePath([])).toBe("");
    expect(spectrumPath([])).toBe("");
  });
  it("bounds waveform amplitude and spectral extent", async () => {
    const { wavePath, spectrumPath } = await import("./bridge");
    expect(wavePath([0, 2])).not.toContain("NaN");
    expect(wavePath([0.5])).not.toMatch(/NaN|Infinity/);
    expect(spectrumPath([-200, 0, 10])).toBe("M0,180 L500,0 L1000,0");
  });
});
