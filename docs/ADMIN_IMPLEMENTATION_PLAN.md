# ODESVIA Admin implementation plan

## Existing platform

The repository contains a Next.js 16 App Router visitor site. Properties and experiences are currently TypeScript seed data. Booking inquiries are validated on the server but stored in an ephemeral file. There is no authentication, database, authorization or Admin interface yet.

## Architecture

- **Single role:** Admin.
- **Authentication:** one Admin identity configured through environment variables; bcrypt password verification; signed, HTTP-only, same-site session cookie; server-side authorization on every Admin route and action.
- **Database:** libSQL. Development uses a persistent local SQLite file. Vercel uses a remote libSQL-compatible database with the same schema and client.
- **Validation:** Zod at server boundaries plus database constraints and overlap triggers.
- **Mutations:** server actions and route handlers, always followed by cache revalidation.

## Data model

- `properties`: listing content, publication state, guest/bed/bath capacity, price, amenities, images and location.
- `guests`: contact information and notes.
- `booking_requests`: visitor inquiries with pending, approved or rejected status.
- `reservations`: draft, confirmed or cancelled reservations linked to a property and guest.
- `availability_blocks`: manual date blocks per property.
- `notifications`: Admin events and read state.
- `settings`: platform name, timezone, currency and booking defaults.

Confirmed reservation and availability ranges use `[check_in, check_out)` semantics. Database triggers reject overlapping confirmed reservations and manual blocks.

## Admin routes

- `/admin/login`
- `/admin`
- `/admin/booking-requests`
- `/admin/reservations`
- `/admin/properties`
- `/admin/calendar`
- `/admin/availability`
- `/admin/guests`
- `/admin/notifications`
- `/admin/settings`

## Environment variables

| Name | Purpose |
| --- | --- |
| `ODESVIA_DATABASE_URL` | `file:.data/odesvia.db` locally or the production database URL |
| `ODESVIA_DATABASE_AUTH_TOKEN` | Remote database token; omitted for local SQLite |
| `ODESVIA_ADMIN_EMAIL` | Private Admin login email |
| `ODESVIA_ADMIN_PASSWORD_HASH` | bcrypt hash; never store a plaintext password |
| `ODESVIA_SESSION_SECRET` | Random value of at least 32 characters used to sign sessions |

## Deployment requirements

Local SQLite is suitable for development, but it is not durable on Vercel's ephemeral filesystem. Vercel must use a remote libSQL-compatible database and receive the five variables above through encrypted project settings. The application refuses to use a `file:` database when `VERCEL` is present.

Preview and production must use separate databases, tokens and session secrets. After configuring the database variables, initialize or update the schema with:

```bash
npm run db:migrate
```

Schema creation is idempotent. Back up production data before future destructive migrations. Current migrations only create missing tables, triggers and columns. No database, email, payment or storage service is provisioned automatically.

Uploaded preview images are limited to 2 MB each and stored as data URLs in the database. This is functional for a small private catalogue. Before storing a large image library, connect approved object storage and retain only its HTTPS URLs in `properties.images`.

### Safe Preview migration from a trusted workstation

Run these commands only from `develop/visitor-platform`. Vercel CLI writes the encrypted Preview variables into `.env.local`, which is ignored by Git. The verification command reports only validation outcomes and never prints variable values.

```bash
git switch develop/visitor-platform
git pull --ff-only
npm ci
npx vercel link
npx vercel env pull .env.local --environment=preview --git-branch=develop/visitor-platform
git check-ignore .env.local
npm run db:migrate
npm run db:verify
npx vercel pull --yes --environment=preview --git-branch=develop/visitor-platform
npx vercel build
npx vercel deploy --prebuilt
```

`git check-ignore .env.local` must print `.env.local`. Stop if it does not. The final command creates a Preview deployment because it omits `--prod`. Never add `--prod` during Preview testing. Remove the local secret file after validation if it is no longer needed.

## Delivery stages

1. Database schema, Admin authentication, protected shell and dashboard.
2. Persist visitor inquiries; approve/reject and create confirmed reservations.
3. Reservation CRUD, guests and notifications.
4. Property management and connect public listings to published database records.
5. Calendar and availability blocks with overlap enforcement.
6. Settings, audit hardening, full workflow tests and preview deployment.
