import "server-only";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export const invalidJmapResponse = (subject: string): Error =>
  new Error(`Mail provider returned invalid ${subject}.`);

export const readJmapResponseJson = async (
  response: Response,
): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    throw invalidJmapResponse("JSON");
  }
};

export const sameOriginJmapUrl = (
  value: string,
  expectedOrigin: string,
): URL => {
  const parsed = new URL(value, expectedOrigin);
  if (
    parsed.origin !== expectedOrigin ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    throw new Error("Mail provider returned a cross-origin JMAP endpoint.");
  }
  return parsed;
};

export const fetchSameOriginJmap = async (
  initialUrl: URL,
  expectedOrigin: string,
  init: RequestInit,
): Promise<Response> => {
  let requestUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    const response = await fetch(requestUrl, { ...init, redirect: "manual" });
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    const location = response.headers.get("location");
    if (!location || redirectCount === 3) {
      throw new Error("Mail provider returned an invalid redirect.");
    }
    requestUrl = sameOriginJmapUrl(location, expectedOrigin);
  }
  throw new Error("Mail provider returned too many redirects.");
};
