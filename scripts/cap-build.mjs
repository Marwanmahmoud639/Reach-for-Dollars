// Generates a minimal dist/ folder for Capacitor.
// The native shell points at the production URL via capacitor.config.ts `server.url`,
// so dist/index.html is only a fallback splash shown if the remote URL is unreachable.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const dist = resolve(process.cwd(), "dist");
mkdirSync(dist, { recursive: true });

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
    <title>Dialing for Dollars</title>
    <style>
      html,body{margin:0;height:100%;background:#0F172A;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;text-align:center}
      .wrap{padding:24px}
      a{color:#3B82F6}
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>Dialing for Dollars</h1>
      <p>Loading…</p>
      <p><a href="https://leads.dialingfordollars.co">Open in browser</a></p>
    </div>
    <script>
      // Failsafe: if Capacitor server.url is unset, redirect to production.
      setTimeout(function(){
        if (!/leads\\.dialingfordollars\\.co/.test(location.host)) {
          location.href = "https://leads.dialingfordollars.co";
        }
      }, 1500);
    </script>
  </body>
</html>
`;

writeFileSync(resolve(dist, "index.html"), html);
console.log("[cap-build] wrote dist/index.html");
