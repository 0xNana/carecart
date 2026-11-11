import assert from "node:assert/strict";
import test from "node:test";
import { verifyAppSession } from "../src/lib/app-access.ts";
import { proxyOperatorRequest } from "../src/lib/operator-proxy.ts";

const token = "a".repeat(64);
const session = {
  role: "operator",
  profileFingerprint: "b".repeat(64),
  csrf: "c".repeat(64),
  nonce: "d".repeat(48),
};

test("app guard validates the scoped opaque session against the loopback operations service", async () => {
  let requestUrl = "";
  let cookie = "";
  const access = await verifyAppSession(token, async (input, init) => {
    requestUrl = String(input);
    cookie = new Headers(init?.headers).get("cookie") ?? "";
    return Response.json(session);
  }, "http://127.0.0.1:3002");

  assert.deepEqual(access, { role: "operator" });
  assert.equal(requestUrl, "http://127.0.0.1:3002/api/operations/session");
  assert.equal(cookie, `carecart_ops=${token}`);
});

test("app guard rejects malformed tokens, unsupported origins, expired and invalid sessions", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    return Response.json(session);
  };
  assert.equal(await verifyAppSession("not-a-token", fetcher), null);
  await assert.rejects(verifyAppSession(token, fetcher, "http://localhost:3002"));
  assert.equal(calls, 0);
  assert.equal(await verifyAppSession(token, async () => new Response(null, { status: 401 })), null);
  await assert.rejects(verifyAppSession(token, async () => Response.json({ ...session, role: "admin" })), /invalid session evidence/i);
});

test("operations proxy preserves both scoped cookies", async () => {
  const request = new Request("http://localhost:3000/api/operations/session", {
    headers: { Cookie: `carecart_ops=${token}`, Host: "localhost:3000" },
  });
  const response = await proxyOperatorRequest(request, ["session"], "http://127.0.0.1:3002", async () => {
    const headers = new Headers({ "Content-Type": "application/json" });
    headers.append("Set-Cookie", `carecart_ops=${token}; Path=/api/operations; HttpOnly`);
    headers.append("Set-Cookie", `carecart_app=${token}; Path=/app; HttpOnly`);
    return new Response(JSON.stringify(session), { status: 200, headers });
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.headers.getSetCookie(), [
    `carecart_ops=${token}; Path=/api/operations; HttpOnly`,
    `carecart_app=${token}; Path=/app; HttpOnly`,
  ]);
});
