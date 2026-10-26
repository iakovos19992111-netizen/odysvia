# ODESVIA

Premium visitor platform for handpicked stays and experiences in Crete.

## Local development

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. Run `npm run lint` and `npm run build` before changes are merged.

## Booking inquiries

The request endpoint performs server-side validation and writes development requests to `/tmp/odesvia-booking-requests.ndjson`. This is intentionally a local adapter: before production, connect the endpoint to durable storage and a transactional email provider using environment variables. A request is always presented as an inquiry and never as a confirmed booking.

All property names, descriptions, prices, and imagery in this initial build are clearly seeded editorial content for design and product development. Availability, ratings, and reviews are not fabricated or shown.
