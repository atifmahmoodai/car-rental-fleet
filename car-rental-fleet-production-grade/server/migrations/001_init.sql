-- Rental schema. Money is integer cents; times are timestamptz.

-- Needed so an exclusion constraint can combine "same car" (=) with "overlapping time" (&&).
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE users (
  id            text PRIMARY KEY,
  email         text NOT NULL,
  name          text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'agent')),
  password_hash text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  failed_logins integer NOT NULL DEFAULT 0,
  locked_until  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE sessions (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip           text,
  user_agent   text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE locations (
  id      text PRIMARY KEY,
  name    text NOT NULL,
  address text NOT NULL
);

CREATE TABLE car_classes (
  id               text PRIMARY KEY,
  name             text NOT NULL,
  example          text NOT NULL,
  seats            integer NOT NULL CHECK (seats BETWEEN 1 AND 20),
  bags             integer NOT NULL CHECK (bags BETWEEN 0 AND 20),
  transmission     text NOT NULL,
  body_type        text NOT NULL,
  daily_rate_cents integer NOT NULL CHECK (daily_rate_cents > 0),
  deposit_cents    integer NOT NULL CHECK (deposit_cents >= 0),
  color_hex        text NOT NULL,
  position         integer NOT NULL DEFAULT 0
);

CREATE TABLE extras (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  per_day_cents integer NOT NULL CHECK (per_day_cents >= 0),
  max_cents     integer CHECK (max_cents >= 0),
  position      integer NOT NULL DEFAULT 0
);

CREATE TABLE cars (
  id               text PRIMARY KEY,
  plate            text NOT NULL,
  make             text NOT NULL,
  model            text NOT NULL,
  year             integer NOT NULL CHECK (year BETWEEN 1990 AND 2100),
  class_id         text NOT NULL REFERENCES car_classes(id),
  home_location_id text NOT NULL REFERENCES locations(id),
  odometer         integer NOT NULL CHECK (odometer >= 0),
  active           boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX cars_plate_key ON cars (upper(regexp_replace(plate, '\s', '', 'g')));
CREATE INDEX cars_class_idx ON cars (class_id);

CREATE TABLE bookings (
  id                     text PRIMARY KEY,
  ref                    text NOT NULL UNIQUE,
  car_id                 text NOT NULL REFERENCES cars(id),
  class_id               text NOT NULL REFERENCES car_classes(id),
  pickup_location_id     text NOT NULL REFERENCES locations(id),
  return_location_id     text NOT NULL REFERENCES locations(id),
  pickup_at              timestamptz NOT NULL,
  return_at              timestamptz NOT NULL CHECK (return_at > pickup_at),
  driver                 jsonb NOT NULL,
  driver_email           text NOT NULL,
  extras                 text[] NOT NULL DEFAULT '{}',
  quote                  jsonb NOT NULL,
  status                 text NOT NULL CHECK (status IN ('Reserved', 'Active', 'Returned', 'Cancelled', 'No-show')),
  source                 text NOT NULL CHECK (source IN ('Web', 'Counter')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  cancelled_at           timestamptz,
  cancellation_fee_cents integer,
  checkout               jsonb,
  checkin                jsonb,
  -- The time the car is taken, including the cleaning buffer after it comes back. NULL when the
  -- booking no longer holds a car (cancelled, no-show).
  occupied               tstzrange,
  version                integer NOT NULL DEFAULT 1,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  -- The database itself refuses two bookings of one car at overlapping times, whatever the app does.
  CONSTRAINT no_double_booking EXCLUDE USING gist (car_id WITH =, occupied WITH &&) WHERE (occupied IS NOT NULL)
);
CREATE INDEX bookings_car_time_idx ON bookings (car_id, pickup_at);
CREATE INDEX bookings_pickup_idx ON bookings (pickup_at);
CREATE INDEX bookings_status_idx ON bookings (status);
CREATE INDEX bookings_email_idx ON bookings (driver_email);

CREATE TABLE maintenance (
  id      text PRIMARY KEY,
  car_id  text NOT NULL REFERENCES cars(id),
  from_at timestamptz NOT NULL,
  to_at   timestamptz NOT NULL CHECK (to_at > from_at),
  reason  text NOT NULL DEFAULT ''
);
CREATE INDEX maintenance_car_idx ON maintenance (car_id, from_at);

CREATE TABLE audit_log (
  id        bigserial PRIMARY KEY,
  at        timestamptz NOT NULL DEFAULT now(),
  user_id   text REFERENCES users(id) ON DELETE SET NULL,
  action    text NOT NULL,
  entity    text NOT NULL,
  entity_id text,
  details   jsonb NOT NULL DEFAULT '{}',
  ip        text
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
