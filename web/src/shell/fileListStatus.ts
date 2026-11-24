interface QueryStatus {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

/**
 * A file list's query waits for the workspace environment, so until either has
 * data the list reports the environment's load or failure instead of empty.
 */
export function fileListStatus(list: QueryStatus, environment: QueryStatus) {
  const waiting = list.data === undefined && environment.data === undefined;
  return {
    isLoading: list.isLoading || (waiting && environment.isLoading),
    isError: list.isError || (waiting && environment.isError),
    error: list.error ?? (waiting ? environment.error : null),
  };
}
