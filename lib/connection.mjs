/** Shared, dependency-free connection validation. No credentials are persisted. */
export const DEFAULT_CONNECTION = Object.freeze({
  host: "127.0.0.1",
  signalingPort: "49100",
  mediaPort: "47998",
  controlPort: "8211",
  token: "",
  quality: "1080",
  secure: false,
  signalingPath: "/",
  controlBase: "",
});

export function parseConnection(input) {
  const host = String(input.host ?? "").trim();
  // Deliberately restrict the local starter to IPv4 / DNS; no paths or credentials.
  if (
    !host ||
    host.length > 253 ||
    !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host)
  ) {
    throw new Error(
      "Enter an IPv4 address or hostname, without http://, a port, or a path.",
    );
  }
  if (host.includes("..")) throw new Error("Enter a valid hostname.");
  if (
    /^[0-9.]+$/.test(host) &&
    (host.split(".").length !== 4 ||
      host.split(".").some((part) => Number(part) > 255))
  ) {
    throw new Error("Enter a valid IPv4 address.");
  }
  const port = (value, label) => {
    if (!/^\d+$/.test(String(value)))
      throw new Error(`${label} must be a whole number.`);
    const parsed = Number(value);
    if (parsed < 1 || parsed > 65535)
      throw new Error(`${label} must be between 1 and 65535.`);
    return parsed;
  };
  const signalingPort = port(input.signalingPort, "Signaling port");
  const mediaPort = port(input.mediaPort, "Media port");
  const controlPort = port(input.controlPort, "Control port");
  if (signalingPort === controlPort)
    throw new Error("Signaling and control need different TCP ports.");
  const token = String(input.token ?? "").trim();
  if (!token) throw new Error("Enter the worker control token.");
  const secure = input.secure === true;
  const signalingPath = String(input.signalingPath || "/");
  if (!/^\/(?!\/)[^?#\s]*$/.test(signalingPath))
    throw new Error(
      "Signaling path must start with a single slash and contain no query or fragment.",
    );
  const control = new URL(
    input.controlBase ||
      `${secure ? "https" : "http"}://${host}:${controlPort}`,
  );
  if (
    !["http:", "https:"].includes(control.protocol) ||
    control.username ||
    control.password ||
    control.search ||
    control.hash
  ) {
    throw new Error(
      "Control URL must be HTTP or HTTPS without credentials, query, or fragment.",
    );
  }
  if (secure && control.protocol !== "https:")
    throw new Error("Secure connections require an HTTPS control URL.");
  return {
    host,
    signalingPort,
    mediaPort,
    controlPort,
    token,
    secure,
    signalingPath,
    width: input.quality === "720" ? 1280 : 1920,
    height: input.quality === "720" ? 720 : 1080,
    controlUrl: control.href.replace(/\/$/, ""),
  };
}

export function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const detail = error.info || error.message || error.data?.message;
    if (detail instanceof Error) return detail.message;
    if (typeof detail === "string") return detail;
  }
  return "The stream could not connect. Check Isaac Sim and the streaming ports.";
}
