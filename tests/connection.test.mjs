import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CONNECTION,
  parseConnection,
  errorMessage,
} from "../lib/connection.mjs";

test("builds independent video and control endpoints", () => {
  const config = parseConnection({
    ...DEFAULT_CONNECTION,
    host: " 192.168.1.50 ",
    token: " example-token ",
    quality: "720",
  });
  assert.equal(config.host, "192.168.1.50");
  assert.equal(config.controlUrl, "http://192.168.1.50:8211");
  assert.equal(config.signalingPort, 49100);
  assert.equal(config.mediaPort, 47998);
  assert.equal(config.token, "example-token");
  assert.deepEqual([config.width, config.height], [1280, 720]);
});
test("accepts LAN DNS names and rejects URLs, credentials, paths, malformed IPs", () => {
  assert.equal(
    parseConnection({
      ...DEFAULT_CONNECTION,
      host: "gpu-workstation.local",
      token: "unit-test-token",
    }).host,
    "gpu-workstation.local",
  );
  for (const host of [
    "",
    "http://localhost",
    "user:pass@host",
    "host/path",
    "host:49100",
    "256.1.2.3",
    "127.0.0",
    "a..b",
    "127.0.0.1?x=1",
  ]) {
    assert.throws(
      () => parseConnection({ ...DEFAULT_CONNECTION, host }),
      undefined,
      host,
    );
  }
});
test("rejects invalid ports and TCP endpoint collisions", () => {
  for (const name of ["signalingPort", "mediaPort", "controlPort"]) {
    for (const value of ["0", "65536", "-1", "NaN", "", "1.5", "12x"]) {
      assert.throws(() =>
        parseConnection({ ...DEFAULT_CONNECTION, [name]: value }),
      );
    }
  }
  assert.throws(() =>
    parseConnection({ ...DEFAULT_CONNECTION, controlPort: "49100" }),
  );
});
test("normalizes errors from both JavaScript and NVIDIA SDK events to strings", () => {
  assert.equal(errorMessage(new Error("Network error")), "Network error");
  assert.equal(
    errorMessage({ info: new Error("Signaling failed") }),
    "Signaling failed",
  );
  assert.equal(
    errorMessage({ info: "Connection timed out" }),
    "Connection timed out",
  );
  assert.equal(typeof errorMessage({ info: {} }), "string");
});

test("preserves secure connection settings and requires a control token", () => {
  assert.throws(() => parseConnection(DEFAULT_CONNECTION), /token/);
  const secure = parseConnection({
    ...DEFAULT_CONNECTION,
    host: "gpu.example.com",
    token: "test-token",
    secure: true,
    signalingPort: "443",
    signalingPath: "/stream",
    controlBase: "https://gpu.example.com/api",
  });
  assert.equal(secure.secure, true);
  assert.equal(secure.signalingPath, "/stream");
  assert.equal(secure.controlUrl, "https://gpu.example.com/api");
  assert.throws(
    () =>
      parseConnection({
        ...DEFAULT_CONNECTION,
        token: "test-token",
        secure: true,
        controlBase: "http://localhost:8211",
      }),
    /HTTPS/,
  );
});
