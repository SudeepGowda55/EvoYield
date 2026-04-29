// Base HTTP client for the KeeperHub REST API.
// Docs: https://docs.keeperhub.com/api

const BASE_URL = "https://app.keeperhub.com/api";

export async function khFetch(path, { body, method = "GET", headers = {} } = {}) {
  const apiKey = process.env.KEEPERHUB_API_KEY;
  if (!apiKey || apiKey === "kh_your_key_here") {
    throw new Error("KEEPERHUB_API_KEY is not configured in .env");
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `KeeperHub [${res.status}] ${path}: ${json?.error?.message ?? JSON.stringify(json)}`
    );
  }
  return json;
}
