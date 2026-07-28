import WebSocket from "ws";
const url = "wss://ca-quoridor-spike.salmonpond-6baa554d.japaneast.azurecontainerapps.io";
const t0 = Date.now();
const ws = new WebSocket(url, { origin: "https://zealous-rock-0e6198c00.7.azurestaticapps.net" });
ws.on("open", () => console.log(`open after ${Date.now() - t0} ms`));
ws.on("message", (d) => {
  const msg = JSON.parse(d.toString());
  console.log(`first message after ${Date.now() - t0} ms:`, JSON.stringify(msg));
  ws.close();
  process.exit(0);
});
ws.on("error", (e) => { console.error("error:", e.message); process.exit(1); });
setTimeout(() => { console.error("timeout"); process.exit(1); }, 60000);
