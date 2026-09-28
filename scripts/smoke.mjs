// Browser smoke test of the built app. Run `npm run build` first.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const PORT = 4185;
const BASE = `http://localhost:${PORT}/`;
const SHOTS = "test-results/screenshots";
const executablePath = process.env.CHROMIUM_PATH || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
mkdirSync(SHOTS, { recursive: true });
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "pipe" });

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

let page;
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(BASE)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const browser = await chromium.launch({ executablePath });
  const errors = [];
  const watch = (p) => {
    p.on("pageerror", (e) => { errors.push(e.stack || e.message); console.log(`  ! ${e.stack || e.message}`); });
    p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    p.on("dialog", (d) => d.accept());
  };
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await emulatePromiseScroll(ctx);
  page = await ctx.newPage();
  watch(page);

  console.log("Customer booking");
  await page.goto(BASE);
  check((await page.locator(".vcard").count()) === 5, "5 car classes shown");
  await page.click("button:has-text('Find cars')");
  await page.waitForSelector(".result");
  const avail = await page.locator(".result:not(.sold-out)").count();
  check(avail > 0, `${avail} classes available for default dates`);
  await page.screenshot({ path: `${SHOTS}/search.png`, fullPage: true });
  const firstAvail = page.locator(".result:not(.sold-out)").first();
  const ecoPrice = await firstAvail.locator(".price").innerText();
  await firstAvail.locator("a:has-text('Select')").click();
  await page.waitForSelector("h1:has-text('Complete your booking')");
  await page.click("button:has-text('Book now')");
  check((await page.locator(".field-error").count()) >= 4, "empty driver form shows errors");
  await page.fill("label:has-text('Full name') input", "Young Tester");
  await page.fill("label:has-text('Email') input", "young@example.com");
  await page.fill("label:has-text('Mobile') input", "+1 555 222 3333");
  await page.fill("label:has-text('licence number') input", "DL998877");
  const dob = new Date(); dob.setFullYear(dob.getFullYear() - 22);
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
  check(/^RC-[A-Z0-9]{6}$/.test(ref), `booking reference ${ref}`);
  check(ecoPrice !== (await page.locator(".totals .grand").nth(1).innerText()), "final price includes extras and fees");

  console.log("Manage booking");
  await page.goto(`${BASE}#/manage`);
  await page.fill("label:has-text('Booking reference') input", ref.replace("RC-", "").toLowerCase());
  await page.fill("label:has-text('Email') input", "wrong@example.com");
  await page.click("button:has-text('Find booking')");
  check(await page.locator("text=couldn't find a booking").isVisible(), "wrong email rejected");
  await page.fill("label:has-text('Email') input", "YOUNG@example.com");
  await page.click("button:has-text('Find booking')");
  await page.waitForSelector(`h1:has-text('${ref}')`);
  check(true, "found with reference (no prefix, any case) + email");
  await page.click("button:has-text('Cancel booking')");
  check(await page.locator("text=late-cancellation fee").isVisible(), "cancelling within 48 h charges a day");

  console.log("Staff: dashboard & calendar");
  await page.goto(`${BASE}#/admin`);
  await page.waitForSelector(".recharts-surface");
  const k = (await page.locator(".kpi-value").allTextContents()).join(" | ");
  check(!/NaN|undefined|Infinity/.test(k), `KPIs: ${k}`);
  await page.screenshot({ path: `${SHOTS}/dashboard.png`, fullPage: true });
  await page.goto(`${BASE}#/admin/calendar`);
  await page.waitForSelector(".cal-bar");
  const bars = await page.locator(".cal-bar.st-reserved, .cal-bar.st-active, .cal-bar.st-returned").count();
  check(bars > 30, `calendar shows ${bars} rentals`);
  await page.screenshot({ path: `${SHOTS}/calendar.png` });
  await page.locator(".cal-bar.st-active").first().click();
  await page.waitForSelector("h2:has-text('Return the car')");
  check(true, "clicking a bar opens the booking");

  console.log("Staff: check-out and check-in");
  const back = page.url();
  // Book a car for right now at the counter, then hand it over and take it back.
  await page.goto(BASE);
  const soon = new Date(Date.now() + 60 * 60_000);
  const later = new Date(Date.now() + 3 * 86_400_000);
  const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  await page.fill("label:has-text('Pick-up') >> input[type=datetime-local]", local(soon));
  await page.fill("label:has-text('Return') >> input[type=datetime-local]", local(later));
  await page.click("button:has-text('Find cars')");
  await page.locator(".result:not(.sold-out) a:has-text('Select')").first().click();
  await page.fill("label:has-text('Full name') input", "Counter Customer");
  await page.fill("label:has-text('Email') input", "counter@example.com");
  await page.fill("label:has-text('Mobile') input", "+1 555 444 5555");
  await page.fill("label:has-text('licence number') input", "DL123456");
  await page.fill("label:has-text('Date of birth') input", "1985-06-15");
  await page.locator("label.check:has-text('I accept') input").check();
  await page.click("button:has-text('Book now')");
  await page.waitForSelector("text=You're booked!");
  const ref2 = (await page.locator("h1").first().innerText()).trim();
  await page.goto(`${BASE}#/admin/bookings`);
  await page.fill("input[type=search]", ref2);
  await page.click(`a:has-text('${ref2}')`);
  await page.waitForSelector("h2:has-text('Hand over the car')");
  const odoOut = Number(await page.locator("label:has-text('Odometer') input").inputValue());
  await page.fill("label:has-text('Odometer') input", String(odoOut - 5));
  await page.click("button:has-text('Check out')");
  check(await page.locator("text=can't be below").isVisible(), "odometer can't go backwards");
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

  console.log("Staff: fleet & prices");
  await page.goto(`${BASE}#/admin/fleet`);
  await page.click("button:has-text('+ Add car')");
  const existingPlate = (await page.locator("tbody tr").first().locator("td").first().innerText()).trim();
  await page.locator("form >> label:has-text('Plate') input").fill(existingPlate.toLowerCase());
  await page.locator("form >> label:has-text('Make') input").fill("Kia");
  await page.locator("form >> label:has-text('Model') input").fill("Picanto");
  await page.click("button:has-text('Save car')");
  check(await page.locator("text=already in the fleet").isVisible(), "duplicate plate rejected");
  await page.click("button:has-text('Cancel')");
  await page.goto(`${BASE}#/admin/settings`);
  await page.fill("input[aria-label='Economy daily rate']", "45.00");
  await page.click("button:has-text('Save prices')");
  await page.waitForSelector("text=Saved.");
  await page.goto(`${BASE}#/`);
  check(await page.locator(".vcard:has-text('Economy') >> text=$45.00").isVisible(), "new rate shows on the booking site");
  await page.reload();
  check(await page.locator(".vcard:has-text('Economy') >> text=$45.00").isVisible(), "prices persist after reload");
  void back;

  console.log("Phone + dark");
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  await emulatePromiseScroll(mobile);
  const m = await mobile.newPage();
  watch(m);
  for (const r of ["", "#/search", "#/manage", "#/admin", "#/admin/calendar", "#/admin/bookings"]) {
    await m.goto(`${BASE}${r}`);
    await m.waitForTimeout(400);
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (r === "#/search") {
      const left = await m.evaluate(() => document.querySelector(".result")?.getBoundingClientRect().left ?? -1);
      check(left >= 12, `content keeps a side margin on phone (${left}px)`);
    }
    check(overflow <= 0, `no page-level horizontal scroll on phone at "${r || "/"}" (${overflow}px)`);
  }
  await m.goto(BASE);
  await m.screenshot({ path: `${SHOTS}/mobile-dark.png` });
  await m.goto(`${BASE}#/search`);
  await m.waitForSelector(".result");
  await m.screenshot({ path: `${SHOTS}/mobile-search-dark.png`, fullPage: true });

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

