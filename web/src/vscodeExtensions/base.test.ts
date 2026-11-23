import { describe, expect, it, vi } from "vitest";
import { Disposable, EventEmitter, disposeAll } from "./base";

describe("Disposable", () => {
  it("calls its callback once", () => {
    const callback = vi.fn();
    const disposable = new Disposable(callback);
    disposable.dispose();
    disposable.dispose();
    expect(callback).toHaveBeenCalledOnce();
  });

  it("from() disposes every item in order, once", () => {
    const order: string[] = [];
    const combined = Disposable.from(
      { dispose: () => order.push("a") },
      new Disposable(() => order.push("b")),
    );
    combined.dispose();
    combined.dispose();
    expect(order).toEqual(["a", "b"]);
  });

  it("disposeAll keeps going after a throwing item and reports it", () => {
    const report = vi.fn();
    const second = vi.fn();
    disposeAll(
      [
        {
          dispose: () => {
            throw new Error("boom");
          },
        },
        { dispose: second },
      ],
      report,
    );
    expect(second).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: "boom" }));
  });
});

describe("EventEmitter", () => {
  it("delivers to listeners until their disposable is disposed", () => {
    const emitter = new EventEmitter<number>();
    const seen: number[] = [];
    const subscription = emitter.event((value) => seen.push(value));
    emitter.fire(1);
    subscription.dispose();
    emitter.fire(2);
    expect(seen).toEqual([1]);
  });

  it("binds thisArgs and pushes the subscription into the disposables array", () => {
    const emitter = new EventEmitter<string>();
    const target = { seen: [] as string[] };
    const disposables: Disposable[] = [];
    emitter.event(
      function (this: typeof target, value) {
        this.seen.push(value);
      },
      target,
      disposables,
    );
    emitter.fire("x");
    expect(target.seen).toEqual(["x"]);
    expect(disposables).toHaveLength(1);
    disposables[0]!.dispose();
    emitter.fire("y");
    expect(target.seen).toEqual(["x"]);
  });

  it("keeps delivering after a listener throws or rejects", async () => {
    const report = vi.fn();
    const emitter = new EventEmitter<number>(report);
    const after = vi.fn();
    emitter.event(() => {
      throw new Error("sync");
    });
    emitter.event(() => Promise.reject(new Error("async")));
    emitter.event(after);
    emitter.fire(7);
    await Promise.resolve();
    expect(after).toHaveBeenCalledWith(7);
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("applies listener changes made while firing on the next fire", () => {
    const emitter = new EventEmitter<void>();
    const late = vi.fn();
    emitter.event(() => {
      emitter.event(late);
    });
    emitter.fire();
    expect(late).not.toHaveBeenCalled();
    emitter.fire();
    expect(late).toHaveBeenCalledOnce();
  });

  it("is inert after dispose", () => {
    const emitter = new EventEmitter<number>();
    const listener = vi.fn();
    emitter.event(listener);
    emitter.dispose();
    emitter.fire(1);
    emitter.event(listener).dispose();
    expect(listener).not.toHaveBeenCalled();
  });
});
