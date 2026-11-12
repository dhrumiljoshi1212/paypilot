import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");
const BASE = process.argv[2];
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ["--hide-scrollbars","--force-prefers-reduced-motion=reduce"] });
const p = await b.newPage();
await p.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
for (const path of (process.argv[3] ?? "/dashboard,/invoices,/agent,/activity,/settings").split(",")) {
  const t = Date.now();
  await p.goto(BASE + path, { waitUntil: "networkidle0", timeout: 90000 });
  await new Promise(r => setTimeout(r, 1500));
  const name = path.replace(/\W/g, "_") || "root";
  await p.screenshot({ path: `shots/${name}.png` });
  await p.screenshot({ path: `shots/${name}_full.png`, fullPage: true });
  console.log(path, Date.now() - t, "ms", await p.evaluate(() => document.body.scrollHeight));
}
await b.close();
