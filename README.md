# ODESVIA

Premium visitor platform for handpicked stays and experiences in Crete.

## Local development

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. Run `npm run lint` and `npm run build` before changes are merged.

## Admin operations

The private Admin workspace is available at `/admin/login`. Copy `.env.example` to `.env.local`, provide an Admin email, a bcrypt password hash, and a random session secret of at least 32 characters. Development data is persisted in `.data/odesvia.db`; this directory is ignored by Git.

Booking inquiries are server-validated and stored in the database. Admin approval creates a confirmed reservation, while database triggers reject overlaps with confirmed reservations or manually blocked dates. Email and payment integrations remain disabled.

See `docs/ADMIN_IMPLEMENTATION_PLAN.md` for the schema, route map, environment variables, delivery stages and Vercel requirements.

All property names, descriptions, prices, and imagery in this initial build are clearly seeded editorial content for design and product development. Availability, ratings, and reviews are not fabricated or shown.
