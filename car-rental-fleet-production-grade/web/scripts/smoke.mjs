// End-to-end smoke test of the whole production stack: a fresh PostgreSQL database with
// demo data, the built API server serving the built web app, driven in Chromium.
//   npm run build && npm run smoke        (from the project root)
// Uses SMOKE_DATABASE_URL (default postgres://postgres:postgres@localhost:5432/rental_smoke).
// The desks run in New York time while the browser runs in Karachi time, to prove every time
// shown and entered is the desk's local time, whatever the visitor's computer is set to.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { chromium } from "playwright-core";

const PORT = 4185;
const BASE = `http://localhost:${PORT}/`;
const SHOTS = "test-results/screenshots";
const DESK_TZ = "America/New_York";
const BROWSER_TZ = "Asia/Karachi";
const DB_URL = process.env.SMOKE_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/rental_smoke";
const executablePath = process.env.CHROMIUM_PATH || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
mkdirSync(SHOTS, { recursive: true });
if (!existsSync("../server/dist/server.js") || !existsSync("dist/index.html")) throw new Error("Build first: npm run build (from the project root)");

{
  const name = new URL(DB_URL).pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name) || !name.includes("smoke")) throw new Error("SMOKE_DATABASE_URL must name a database containing 'smoke'");
  const adminUrl = new URL(DB_URL);
  adminUrl.pathname = "/postgres";
  const c = new pg.Client({ connectionString: adminUrl.toString() });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await c.query(`CREATE DATABASE ${name}`);
  await c.end();
}
const env = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_URL: DB_URL,
  PORT: String(PORT),
  PUBLIC_URL: BASE,
  COOKIE_SECURE: "false",
  TIMEZONE: DESK_TZ,
  WEB_DIST: join(process.cwd(), "dist"),
  LOG_LEVEL: "warn",
  ALLOW_DEMO_SEED: "1",
};
const seeded = spawnSync("node", ["../server/dist/cli/seed-demo.js"], { env, encoding: "utf8" });
if (seeded.status !== 0) throw new Error(`demo seed failed: ${seeded.stderr}`);
const server = spawn("node", ["../server/dist/server.js"], { env, stdio: ["ignore", "inherit", "inherit"] });

let failures = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) failures++;
};
// Newer Chromium returns a Promise from scrollTo(); emulate it so effect bugs show up everywhere.
const emulatePromiseScroll = (ctx) =>
  ctx.addInitScript(() => {
    const o = window.scrollTo.bind(window);
    window.scrollTo = (...a) => (o(...a), Promise.resolve());
  });
const signIn = async (p, email, password = "demo-password-1") => {
  await p.goto(`${BASE}admin/login`);
  await p.fill("input[type=email]", email);
  await p.fill("input[type=password]", password);
  await p.click("button:has-text('Sign in')");
  await p.waitForSelector(".admin-side");
};
// "YYYY-MM-DDTHH:mm" as a desk clock shows it, for a datetime-local input.
const deskInput = (ms) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: DESK_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};
const deskClock = (ms) => new Date(ms).toLocaleString("en-US", { timeZone: DESK_TZ, hour: "numeric", minute: "2-digit" });

let page;
try {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}readyz`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const browser = await chromium.launch({ executablePath });
  const errors = [];
  const watch = (p) => {
    p.on("pageerror", (e) => {
      errors.push(e.stack || e.message);
      console.log(`  ! ${e.stack || e.message}`);
    });
    // 4xx answers are expected here (signed-out checks, rejected input); any 5xx or script error is a failure.
    p.on("console", (m) => m.type() === "error" && !/status of 4\d\d/.test(m.text()) && errors.push(`${p.url()}: ${m.text()}`));
    p.on("dialog", (d) => d.accept());
  };
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, timezoneId: BROWSER_TZ });
  await emulatePromiseScroll(ctx);
  page = await ctx.newPage();
  watch(page);

  console.log("Customer booking");
  await page.goto(BASE);
  await page.waitForSelector(".vcard");
  check((await page.locator(".vcard").count()) === 5, "5 car classes shown");
  await page.click("button:has-text('Find cars')");
  await page.waitForSelector(".result");
  const avail = await page.locator(".result:not(.sold-out)").count();
  check(avail > 0, `${avail} classes available for default dates`);
  await page.screenshot({ path: `${SHOTS}/search.png`, fullPage: true });
  const firstAvail = page.locator(".result:not(.sold-out)").first();
  const basePrice = await firstAvail.locator(".price").innerText();
  await firstAvail.locator("a:has-text('Select')").click();
  await page.waitForSelector("h1:has-text('Complete your booking')");
  await page.click("button:has-text('Book now')");
  check((await page.locator(".field-error").count()) >= 4, "empty driver form shows errors");
  await page.fill("label:has-text('Full name') input", "Young Tester");
  await page.fill("label:has-text('Email') input", "young@example.com");
  await page.fill("label:has-text('Mobile') input", "+1 555 222 3333");
  await page.fill("label:has-text('licence number') input", "DL998877");
  const dob = new Date();
  dob.setFullYear(dob.getFullYear() - 22);
  await page.fill("label:has-text('Date of birth') input", dob.toISOString().slice(0, 10));
  check(await page.locator(".totals >> text=Young driver fee").isVisible(), "young-driver fee added for a 22-year-old");
  await page.locator("label.check:has-text('Sat nav') input").check();
  check(await page.locator(".totals >> text=Extras").isVisible(), "extras priced");
  await page.click("button:has-text('Book now')");
  check(await page.locator("text=Please accept the rental terms").isVisible(), "terms must be accepted");
  await page.locator("label.check:has-text('I accept') input").check();
  await page.click("button:has-text('Book now')");
  await page.waitForSelector("text=You're booked!");
  const ref = (await page.locator("h1").first().innerText()).trim();
  check(/^RC-[A-Z0-9]{6}$/.test(ref), `booking reference ${ref} (saved in the database)`);
  check(basePrice !== (await page.locator(".totals .grand").last().innerText()), "final price includes extras and fees");

  console.log("Manage booking");
  await page.goto(`${BASE}manage`);
  await page.fill("label:has-text('Booking reference') input", ref.replace("RC-", "").toLowerCase());
  await page.fill("label:has-text('Email') input", "wrong@example.com");
  await page.click("button:has-text('Find booking')");
  await page.waitForSelector("text=couldn't find a booking");
  check(true, "wrong email rejected (same answer as a wrong reference)");
  await page.fill("label:has-text('Email') input", "YOUNG@example.com");
  await page.click("button:has-text('Find booking')");
  await page.waitForSelector(`h1:has-text('${ref}')`);
  check(true, "found with reference (no prefix, any case) + email");
  await page.click("button:has-text('Cancel booking')");
  await page.waitForSelector(".notice >> text=Cancelled");
  check(await page.locator("text=late-cancellation fee").isVisible(), "cancelling within 48 h charges a day");
  await page.goto(`${BASE}booking/${ref}`);
  check(await page.locator("button:has-text('Show booking')").isVisible(), "booking link asks for the email (no data without it)");

  console.log("Staff access control");
  await page.goto(`${BASE}admin`);
  await page.waitForURL(/\/admin\/login/);
  check(true, "staff pages redirect to sign-in");
  check((await fetch(`${BASE}api/staff/fleet`)).status === 401, "staff API refuses anonymous requests (401)");
  await page.fill("input[type=email]", "agent@demo.local");
  await page.fill("input[type=password]", "wrong-password-1");
  await page.click("button:has-text('Sign in')");
  await page.waitForSelector("[role=alert]");
  check(true, "wrong password rejected");
  await signIn(page, "agent@demo.local");
  check(!(await page.locator(".admin-side >> text=Prices, settings").isVisible()), "agents don't see prices, settings & users");
  const usersStatus = await page.evaluate(async () => (await fetch("/api/staff/users")).status);
  check(usersStatus === 403, `agents can't list users via the API (${usersStatus})`);

  console.log("Staff: dashboard & calendar");
  await page.goto(`${BASE}admin`);
  await page.waitForSelector(".recharts-surface");
  const k = (await page.locator(".kpi-value").allTextContents()).join(" | ");
  check(!/NaN|undefined|Infinity/.test(k), `KPIs: ${k}`);
  await page.screenshot({ path: `${SHOTS}/dashboard.png`, fullPage: true });
  await page.goto(`${BASE}admin/calendar`);
  await page.waitForSelector(".cal-bar");
  const bars = await page.locator(".cal-bar.st-reserved, .cal-bar.st-active, .cal-bar.st-returned").count();
  check(bars > 30, `calendar shows ${bars} rentals`);
  await page.screenshot({ path: `${SHOTS}/calendar.png` });
  await page.locator(".cal-bar.st-active").first().click();
  await page.waitForSelector("h2:has-text('Return the car')");
  check(true, "clicking a bar opens the booking");

  console.log("Staff: counter booking, check-out and check-in");
  // Book from the next half hour after an hour from now (desk time), then hand it over and take it back.
  const soon = Math.ceil((Date.now() + 60 * 60_000) / 1_800_000) * 1_800_000;
  const later = soon + 3 * 86_400_000;
  await page.goto(BASE);
  await page.fill("label:has-text('Pick-up') >> input[type=datetime-local]", deskInput(soon));
  await page.fill("label:has-text('Return') >> input[type=datetime-local]", deskInput(later));
  await page.click("button:has-text('Find cars')");
  await page.waitForSelector(".result");
  check(await page.locator(`text=${deskClock(soon)}`).first().isVisible(), `search shows pick-up at ${deskClock(soon)} desk time (browser is in ${BROWSER_TZ})`);
  await page.locator(".result:not(.sold-out) a:has-text('Select')").first().click();
  await page.waitForSelector("text=Signed in as staff");
  await page.fill("label:has-text('Full name') input", "Counter Customer");
  await page.fill("label:has-text('Email') input", "counter@example.com");
  await page.fill("label:has-text('Mobile') input", "+1 555 444 5555");
  await page.fill("label:has-text('licence number') input", "DL123456");
  await page.fill("label:has-text('Date of birth') input", "1985-06-15");
  await page.click("button:has-text('Book now')");
  await page.waitForSelector("h2:has-text('Hand over the car')");
  const ref2 = (await page.locator(".page-head h1").innerText()).match(/RC-[A-Z0-9]{6}/)?.[0] ?? "";
  check(!!ref2, `counter booking ${ref2} opens in the staff view`);
  check(await page.locator(`text=${deskClock(soon)}`).first().isVisible(), "staff view shows the same desk time");
  await page.goto(`${BASE}admin/bookings`);
  await page.fill("input[type=search]", ref2);
  await page.click(`a:has-text('${ref2}')`);
  await page.waitForSelector("h2:has-text('Hand over the car')");
  check(true, "found by reference in the bookings list");
  const odoOut = Number(await page.locator("label:has-text('Odometer') input").inputValue());
  await page.fill("label:has-text('Odometer') input", String(odoOut - 5));
  await page.click("button:has-text('Check out')");
  await page.waitForSelector("text=can't be below");
  check(true, "odometer can't go backwards");
  await page.fill("label:has-text('Odometer') input", String(odoOut));
  await page.click("button:has-text('Check out')");
  await page.waitForSelector("h2:has-text('Return the car')");
  check(await page.locator(".page-head >> text=On rent").isVisible(), "status is On rent");
  await page.fill("label:has-text('Odometer') input", String(odoOut + 240));
  await page.fill("label:has-text('Fuel') input", "6");
  check(await page.locator(".totals >> text=Fuel (2/8 missing)").isVisible(), "fuel shortfall previewed");
  await page.click("button:has-text('Check in')");
  await page.waitForSelector("text=Car returned.");
  check(await page.locator(".page-head >> text=Returned").isVisible(), "status is Returned");
  check(await page.locator(".totals >> text=Fuel charge").isVisible(), "fuel charge on final bill");
  await page.reload();
  await page.waitForSelector(".page-head >> text=Returned");
  check(true, "return saved on the server (survives reload)");
  await page.click("button:has-text('Sign out')");
  await page.waitForURL(/\/admin\/login/);

  console.log("Admin: fleet, prices & users");
  await signIn(page, "admin@demo.local");
  await page.goto(`${BASE}admin/fleet`);
  await page.waitForSelector("tbody tr");
  const existingPlate = (await page.locator("tbody tr").first().locator("td").first().innerText()).trim();
  await page.click("button:has-text('+ Add car')");
  await page.locator("form >> label:has-text('Plate') input").fill(existingPlate.toLowerCase());
  await page.locator("form >> label:has-text('Make') input").fill("Kia");
  await page.locator("form >> label:has-text('Model') input").fill("Picanto");
  await page.click("button:has-text('Save car')");
  check(await page.locator("text=already in the fleet").isVisible(), "duplicate plate rejected");
  await page.click("button:has-text('Cancel')");
  await page.goto(`${BASE}admin/settings`);
  await page.fill("input[aria-label='Economy daily rate']", "45.00");
  await page.click("button:has-text('Save prices')");
  await page.waitForSelector("text=Saved.");
  check(true, "prices saved");
  await page.click("button:has-text('+ Add user')");
  await page.fill(".modal label:has-text('Name') input", "New Agent");
  await page.fill(".modal label:has-text('Email') input", "new.agent@example.com");
  await page.fill(".modal label:has-text('Password') input", "short");
  await page.click(".modal button:has-text('Save')");
  await page.waitForSelector(".modal .field-error");
  check(true, "weak password rejected");
  await page.fill(".modal label:has-text('Password') input", "a-strong-pass-42");
  await page.click(".modal button:has-text('Save')");
  await page.waitForSelector("text=new.agent@example.com");
  check(true, "new staff login created");
  const other = await browser.newContext({ timezoneId: BROWSER_TZ });
  const op = await other.newPage();
  watch(op);
  await signIn(op, "new.agent@example.com", "a-strong-pass-42");
  check(true, "new user can sign in");
  await other.close();
  await page.goto(`${BASE}admin/audit`);
  await page.waitForSelector("tbody tr");
  check((await page.locator("tbody tr").count()) > 3, "activity log records staff actions");

  const anon = await browser.newContext({ timezoneId: BROWSER_TZ });
  const ap = await anon.newPage();
  watch(ap);
  await ap.goto(BASE);
  await ap.waitForSelector(".vcard");
  check(await ap.locator(".vcard:has-text('Economy') >> text=$45.00").isVisible(), "new rate shows on the booking site for customers");
  await anon.close();

  console.log("Phone + dark");
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", timezoneId: BROWSER_TZ });
  await emulatePromiseScroll(mobile);
  const m = await mobile.newPage();
  watch(m);
  await signIn(m, "admin@demo.local");
  for (const r of ["", "search", "manage", "admin", "admin/calendar", "admin/bookings", "admin/fleet", "admin/settings"]) {
    await m.goto(`${BASE}${r}`);
    await m.waitForTimeout(500);
    if (r === "search") {
      await m.waitForSelector(".result");
      const left = await m.evaluate(() => document.querySelector(".result")?.getBoundingClientRect().left ?? -1);
      check(left >= 12, `content keeps a side margin on phone (${left}px)`);
    }
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 0, `no page-level horizontal scroll on phone at "/${r}" (${overflow}px)`);
  }
  await m.goto(BASE);
  await m.screenshot({ path: `${SHOTS}/mobile-dark.png` });

  console.log("Server");
  const res = await fetch(`${BASE}admin/calendar`);
  check(res.ok && (await res.text()).includes('id="root"'), "deep links serve the app");
  check(!!res.headers.get("content-security-policy"), "security headers set");
  const api404 = await fetch(`${BASE}api/nope`);
  check(api404.status === 404 && (api404.headers.get("content-type") ?? "").includes("json"), "unknown API paths are JSON 404s");

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
  await browser.close();
} catch (e) {
  failures++;
  console.error(e);
  if (page) {
    console.error("URL at failure:", page.url());
    await page.screenshot({ path: `${SHOTS}/failure.png`, fullPage: true }).catch(() => {});
  }
} finally {
  server.kill("SIGTERM");
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll smoke checks passed");
process.exit(failures ? 1 : 0);
