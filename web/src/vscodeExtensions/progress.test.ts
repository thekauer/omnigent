// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { runWithProgress, toastNotifications } from "./progress";
import { recordingNotifications } from "./testServices";

vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn(() => "toast-1"),
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runWithProgress", () => {
  it("shows the title and each reported message, and closes when the task resolves", async () => {
    const notifications = recordingNotifications();
    const result = await runWithProgress(notifications, "Working", async (progress) => {
      progress.report({ message: "Step 1" });
      progress.report({ increment: 10 });
      progress.report({ message: "Step 2" });
      return 42;
    });
    expect(result).toBe(42);
    expect(notifications.shown).toEqual([
      { kind: "progress", title: "Working", messages: ["Step 1", "Step 2"], closed: true },
    ]);
  });

  it("shows the error and rejects when the task fails", async () => {
    const notifications = recordingNotifications();
    await expect(
      runWithProgress(notifications, "Working", () => {
        throw new Error("Sign in first.");
      }),
    ).rejects.toThrow("Sign in first.");
    expect(notifications.shown[0]).toMatchObject({ closed: true, error: "Sign in first." });
  });

  it("tells onOpen about the progress and undoes it afterwards", async () => {
    const closed = vi.fn();
    const onOpen = vi.fn(() => closed);
    await runWithProgress(recordingNotifications(), "T", () => undefined, onOpen);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(closed).toHaveBeenCalledOnce();
  });
});

describe("toastNotifications", () => {
  it("uses one loading toast for the progress and dismisses it when done", () => {
    const notification = toastNotifications.openProgress("Reconnecting box");
    notification.report("Starting...");
    notification.close();
    notification.report("late");
    expect(toast.loading).toHaveBeenNthCalledWith(1, "Reconnecting box");
    expect(toast.loading).toHaveBeenNthCalledWith(2, "Reconnecting box", {
      id: "toast-1",
      description: "Starting...",
    });
    expect(toast.loading).toHaveBeenCalledTimes(2);
    expect(toast.dismiss).toHaveBeenCalledWith("toast-1");
  });

  it("turns the progress toast into an error toast on failure", () => {
    toastNotifications.openProgress("Reconnecting box").close("It failed.");
    expect(toast.error).toHaveBeenCalledWith("Reconnecting box", {
      id: "toast-1",
      description: "It failed.",
      duration: expect.any(Number),
    });
    expect(toast.dismiss).not.toHaveBeenCalled();
  });

  it("shows information and error messages", () => {
    toastNotifications.info("Done.");
    toastNotifications.error("Broken.");
    expect(toast.success).toHaveBeenCalledWith("Done.");
    expect(toast.error).toHaveBeenCalledWith("Broken.", { duration: expect.any(Number) });
  });
});
