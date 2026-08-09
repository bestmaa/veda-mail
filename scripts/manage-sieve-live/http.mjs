import { setTimeout as delay } from "node:timers/promises";

const MAX_ERROR_BODY = 2_048;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export const invariant = (condition, message) => {
  if (!condition) throw new Error(message);
};

const responseFailure = async (response) => {
  const body = (await response.text()).slice(0, MAX_ERROR_BODY);
  return new Error(`HTTP ${response.status}: ${body || response.statusText}`);
};

export const fetchJson = async (url, options = {}, statuses = [200]) => {
  const response = await fetch(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!statuses.includes(response.status)) throw await responseFailure(response);
  return { payload: await response.json(), response };
};

export const fetchSameOriginJson = async (
  initialUrl,
  expectedOrigin,
  options = {},
  statuses = [200],
) => {
  let url = new URL(initialUrl, expectedOrigin);
  for (let count = 0; count <= 3; count += 1) {
    invariant(
      url.origin === expectedOrigin && !url.username && !url.password,
      "The management endpoint changed origin.",
    );
    const response = await fetch(url, {
      ...options,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    if (!REDIRECT_STATUSES.has(response.status)) {
      if (!statuses.includes(response.status)) throw await responseFailure(response);
      return { payload: await response.json(), response };
    }
    const location = response.headers.get("location");
    invariant(location && count < 3, "The management redirect is invalid.");
    url = new URL(location, url);
  }
  throw new Error("The management endpoint redirected too many times.");
};

export const cookieValue = (response, name) => {
  const header = response.headers.get("set-cookie") ?? "";
  const match = new RegExp(`(?:^|,\\s*)${name}=([^;]+)`, "u").exec(header);
  invariant(match?.[1], `The ${name} cookie was not issued.`);
  return `${name}=${match[1]}`;
};

export const waitForHealth = async (baseUrl, child) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("The isolated server exited early.");
    try {
      const response = await fetch(`${baseUrl}/api/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
    } catch {
      // The listener may not be ready yet.
    }
    await delay(250);
  }
  throw new Error("The isolated server did not become healthy.");
};

export const memberRequest = async (
  baseUrl,
  path,
  { body, cookie, method = "GET", scope, statuses = [200] } = {},
) => fetchJson(`${baseUrl}${path}`, {
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  headers: {
    Accept: "application/json",
    Cookie: cookie,
    Origin: baseUrl,
    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    ...(scope ? { "x-veda-mail-session-scope": scope } : {}),
  },
  method,
}, statuses);

export const waitForMessage = async (
  baseUrl,
  cookie,
  scope,
  subject,
) => {
  const deadline = Date.now() + 30_000;
  const search = encodeURIComponent(`subject:"${subject}"`);
  while (Date.now() < deadline) {
    const { payload } = await memberRequest(
      baseUrl,
      `/api/v1/mail/workspace?search=${search}`,
      { cookie, scope },
    );
    const match = payload.data.messages.items.find(
      (message) => message.subject === subject,
    );
    if (match) return match;
    await delay(1_000);
  }
  throw new Error("The independently delivered rule fixture did not arrive.");
};

export const stopChild = async (child) => {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(5_000).then(() => child.kill("SIGKILL")),
  ]);
};
