// Progress and message notifications for extensions, on the app's toasts.
import { toast } from "sonner";

/** One open progress notification. */
export interface ProgressNotification {
  report: (message: string | undefined) => void;
  /** Closes it; with `error`, it turns into an error notification instead. */
  close: (error?: string) => void;
}

export interface Notifications {
  openProgress: (title: string) => ProgressNotification;
  info: (message: string) => void;
  error: (message: string) => void;
}

const ERROR_DURATION_MS = 12_000;

/** Notifications through the app's sonner toasts. */
export const toastNotifications: Notifications = {
  openProgress(title) {
    const id = toast.loading(title);
    let closed = false;
    return {
      report(message) {
        if (!closed) toast.loading(title, { id, description: message });
      },
      close(error) {
        if (closed) return;
        closed = true;
        if (error === undefined) toast.dismiss(id);
        else toast.error(title, { id, description: error, duration: ERROR_DURATION_MS });
      },
    };
  },
  info(message) {
    toast.success(message);
  },
  error(message) {
    toast.error(message, { duration: ERROR_DURATION_MS });
  },
};

export interface ProgressReport {
  message?: string;
  increment?: number;
}

/** The `progress` a `withProgress` task gets: the last reported message is shown. */
export interface ProgressReporter {
  report: (value: ProgressReport) => void;
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return typeof error === "string" ? error : "Something went wrong.";
}

/**
 * Shows `title` while `task` runs, with each reported message. When the task
 * fails, the notification shows its error, and the promise rejects with it.
 */
export async function runWithProgress<T>(
  notifications: Notifications,
  title: string,
  task: (progress: ProgressReporter) => T | Promise<T>,
  onOpen?: (progress: ProgressReporter) => () => void,
): Promise<T> {
  const notification = notifications.openProgress(title);
  const progress: ProgressReporter = Object.freeze({
    report(value: ProgressReport) {
      if (typeof value?.message === "string") notification.report(value.message);
    },
  });
  const onClose = onOpen?.(progress);
  try {
    const result = await task(progress);
    notification.close();
    return result;
  } catch (error) {
    notification.close(errorText(error));
    throw error;
  } finally {
    onClose?.();
  }
}
