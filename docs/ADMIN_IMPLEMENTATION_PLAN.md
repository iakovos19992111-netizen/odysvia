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

Vercel must receive the five variables above through encrypted project settings. The remote database schema is initialized by the application idempotently. Preview and production must use separate databases and secrets. No email, payment or paid service is required for this phase.

## Delivery stages

1. Database schema, Admin authentication, protected shell and dashboard.
2. Persist visitor inquiries; approve/reject and create confirmed reservations.
3. Reservation CRUD, guests and notifications.
4. Property management and connect public listings to published database records.
5. Calendar and availability blocks with overlap enforcement.
6. Settings, audit hardening, full workflow tests and preview deployment.
