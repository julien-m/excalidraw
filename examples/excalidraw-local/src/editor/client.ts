export class RequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Calls the same-origin local board service. */
export const request = async <T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> => {
  const response = await fetch(`/api/${path}`, {
    method,
    headers: {
      "X-Excalidraw-Local": "1",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const failure = (await response.json()) as { error: string };
    throw new RequestError(response.status, failure.error);
  }
  return (await response.json()) as T;
};
