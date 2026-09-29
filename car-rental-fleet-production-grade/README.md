# Car rental: production version

The production build of the car rental app in the parent folder. The demo keeps everything in one browser. This version runs on a server with a PostgreSQL database, so customers can book online while the desk works the same fleet, and a car can never be sold twice.

| | Demo (parent folder) | Production (this folder) |
|---|---|---|
| Data | Browser `localStorage`, one device | PostgreSQL, shared by the booking site and every desk |
| Double booking | Checked in the browser | Checked on the server with the class's cars locked, **and** refused by a database exclusion constraint, so two customers booking the last car at the same moment can't both get it |
| Customers | Could see every booking in the browser | See only their own booking, found by reference **and** email. A wrong reference or email gets the same answer, so bookings can't be probed |
| Times | The visitor's device time zone | The desks' time zone (`TIMEZONE`), for everyone. A customer abroad sees and enters the desk's local time; days follow the desk calendar, correct across daylight-saving changes |
| Staff | Anyone who opens `/admin` | Logins with roles: **agent** (bookings, check-out/in, fleet, calendar) and **admin** (also prices, settings, cars, users, activity log) |
| Emails | — | Booking confirmation and cancellation to the customer, optional new-booking alert to the desk (SMTP) |
| Abuse | — | Rate limits on booking and lookup, a honeypot for bots, input validation on the server |
| Lists | Everything loaded into the browser | Server-side search and paging of bookings |
| Deployment | Static files | Docker image, `docker-compose.yml`, health checks, CI with a real database |

## Run it with Docker

```bash
cp .env.example .env              # set POSTGRES_PASSWORD, PUBLIC_URL, TIMEZONE (and SMTP_URL for emails)
docker compose up -d --build
docker compose exec app node dist/cli/create-admin.js --email owner@yourrentals.com --name "Owner Name"
```

Open http://localhost:8080 for the booking site and http://localhost:8080/admin for the desk. Under **Prices, settings & users**, set your business details, daily rates and rules, and add staff logins.

Demo data (fleet, locations, past and upcoming rentals) is optional:

```bash
docker compose exec -e ALLOW_DEMO_SEED=1 app node dist/cli/seed-demo.js
# Logins: admin@demo.local, agent@demo.local … password: demo-password-1
```

## Development

Requirements: Node 22+ and PostgreSQL 14+ (with the standard `btree_gist` extension, included in every normal PostgreSQL install).

```bash
npm install
cp .env.example .env    # set DATABASE_URL, NODE_ENV=development, COOKIE_SECURE=false
npm run migrate
npm run seed:demo       # optional
npm run dev             # API on :8080, app with hot reload on :5173
```

## Tests

```bash
npm run typecheck
npm test                        # shared rules, API integration tests on a real PostgreSQL, API client
npm run build && npm run smoke  # whole stack in Chromium: fresh database, real server, real browser
```

`TEST_DATABASE_URL` (default `…/rental_test`) and `SMOKE_DATABASE_URL` (default `…/rental_smoke`) are **dropped and recreated** on each run. The tests refuse to run unless the database name contains `test` or `smoke`.

What the tests prove:

- **No double booking:**
  - A rush of simultaneous bookings for one class: exactly as many succeed as there are free cars; the rest get a clear "just booked" answer, and no two stored bookings of a car overlap.
  - Even writing to the database directly, an overlapping booking is refused.
  - A booking can't be moved onto a busy car, and a car with upcoming bookings can't be retired or moved to another class.
- **Customers:** booking sends a confirmation email; lookup and cancellation need the right reference *and* email; late cancellation charges a day; bots filling the hidden field are ignored; under-age drivers and missing terms are refused.
- **Desk:** a counter booking runs through check-out (odometer can't go backwards) and a late return with fuel and extra charges; dashboard, calendar and search work on live data.
- **Access:** staff pages need a session and a CSRF token; agents can't change prices, settings or users; accounts lock after repeated wrong passwords and unlock on a reset; disabling a user signs them out; there is always an active admin.
- **Admin:** price changes reach the public site and new quotes (existing bookings keep their price); settings are validated; duplicate plates are refused whatever the spacing or case; every change is in the activity log.
- **Time zones:** the smoke test runs the desk in New York and the browser in Karachi, and checks the times entered and shown are desk time. Unit tests cover the daylight-saving changes.

## Security

Same foundation as the other production versions:
- **Passwords:** scrypt hashes, with account lockout after repeated failures.
- **Sessions:** `httpOnly` / `SameSite` / `Secure` cookies. Only a hash of each session token is stored.
- **Cross-site attacks:** a CSRF token on every staff change, plus an `Origin` check.
- **Headers:** Helmet sets strict headers, including a Content-Security-Policy.
- **Input and database:** zod validation on every input, and parameterised SQL.
- **Rate limits:** a global limit, plus tighter limits on login, booking (5 per 10 minutes per IP) and lookup.
- **Emails:** plain text only, so nothing a customer types becomes HTML.
- **Audit log:** records who did what and when, including online bookings and cancellations.

## Operations

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for deployment, https, email, backups, monitoring and upgrades.

## Known limits

- **Payments:** nothing is charged online; customers pay and leave the deposit at the counter. There's no card or payment-gateway integration.
- **Opening hours:** the footer shows 08:00–19:00 for every desk, and bookings outside those hours aren't blocked.
- **Prices and settings** are saved as separate requests (settings, then each changed class). If one fails, the page says so and the others are already saved; saving again finishes the job.
- **Rate limits are per server:** they are counted in memory, per app instance.
