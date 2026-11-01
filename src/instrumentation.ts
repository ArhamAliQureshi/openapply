// Starts the hourly autopilot check when the server boots. The work itself runs in a route
// handler (server modules there can use "server-only"); this just pings it once an hour.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const token = crypto.randomUUID();
  (globalThis as { __autopilotToken?: string }).__autopilotToken = token;
  const port = process.env.PORT ?? "3000";
  const tick = () =>
    fetch(`http://127.0.0.1:${port}/api/autopilot/tick`, { method: "POST", headers: { "x-autopilot-token": token } }).catch(
      () => {}, // server not ready yet or restarting; next tick retries
    );
  setTimeout(tick, 60_000);
  setInterval(tick, 60 * 60 * 1000);
}
