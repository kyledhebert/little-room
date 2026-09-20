import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchContentJson } from "../src/lib/content-fetch.ts";

const url = new URL("https://example.test/xrpc/com.atproto.repo.listRecords");

test("retries a temporary server error and returns content", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return calls === 1
      ? new Response("Temporary failure", { status: 500 })
      : Response.json({ records: [{ uri: "at://example/post/1" }] });
  });
  assert.deepEqual(await fetchContentJson(url), { records: [{ uri: "at://example/post/1" }] });
  assert.equal(calls, 2);
});

test("retries network failures but stops after three attempts", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    throw new TypeError("fetch failed");
  });
  await assert.rejects(fetchContentJson(url), /failed after 3 attempts/);
  assert.equal(calls, 3);
});

test("persistent server errors include the endpoint, status, and response", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return new Response("Upstream unavailable", { status: 503 });
  });
  await assert.rejects(fetchContentJson(url), /example\.test.*HTTP 503.*attempt 3\/3.*Upstream unavailable/);
  assert.equal(calls, 3);
});

test("does not retry configuration errors", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return new Response("Repo not found", { status: 400 });
  });
  await assert.rejects(fetchContentJson(url), /HTTP 400.*Repo not found/);
  assert.equal(calls, 1);
});
