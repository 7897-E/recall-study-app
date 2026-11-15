# Study app

A flashcard study app in the spirit of Quizlet: a library of decks, three study
modes (flashcards, multiple-choice learn and a timed match game), per-card
mastery with a light spaced-repetition schedule, streaks, a progress page, a
CRM-style notebook and a whiteboard studio.

It ships as a **static site** — `bun run build:pages` produces plain HTML, CSS
and JS that runs on GitHub Pages — and talks straight to Supabase for accounts,
data (Postgres) and card images (Storage). Row level security keeps every row
and every file scoped to the signed-in user, so no application server is needed.

The product name is `BRAND` in `src/shared/types.ts`; change it once.

## Run it

```sh
bun install
cp .env.example .env   # Supabase project URL + publishable key
bun run dev            # http://localhost:5173
```

Create the tables once by running [`supabase/schema.sql`](supabase/schema.sql)
in the Supabase SQL editor. It creates the seven tables, turns on row level
security, grants the signed-in role access, and creates the private
`card-images` bucket.

A new account is seeded with three sample decks, five notes, a studio board and
some history; Settings can restore or clear them.

## Deploy to GitHub Pages

1. **Settings → Secrets and variables → Actions → Variables:** add
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the publishable key is
   public by design — never put a secret key here).
2. **Settings → Pages → Source:** GitHub Actions.
3. Push to `main`. [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
   typechecks, builds and publishes to
   `https://<user>.github.io/<repo>/`.

The base path defaults to `/<repo>/`; set `VITE_BASE` to override it (for a user
site, `/`). Routing is hash based (`#/notes/:id`), so deep links work on a host
with no server-side fallback.

```sh
bun run build        # hosted build (keeps the Cloudflare worker)
bun run build:pages  # static build for GitHub Pages
bun run typecheck
bun test
```

## Supabase notes

- Sign-up uses email and password. If **Confirm email** is on, users must confirm
  before signing in; set Authentication → URL Configuration → Site URL to the
  deployed origin so confirmation links point somewhere real.
- Images are stored in the private `card-images` bucket under
  `<user id>/cards/<card id>/…` and served to the app as short-lived signed URLs.
- Keep the schema in `supabase/schema.sql` in sync with `src/shared/types.ts`.

## Where things are

- `src/app/lib/backend.ts` is the data layer: it implements the deck, card,
  session, note and board operations against Supabase (this used to be the
  Worker's job).
- `src/app/lib/seed.ts` is the first-run content, `supabase.ts` the client,
  `api.ts` the React Query hooks, `auth.tsx` the session provider.
- `src/app/pages/Flashcards.tsx`, `Learn.tsx` and `Match.tsx` are the study
  modes; each ends in `components/Summary.tsx`, which records the session once.
- `src/app/components/board/` is the whiteboard model and canvas renderer.
- `src/worker/` is the earlier Hono backend (D1 + R2 + token introspection). The
  app no longer calls it; it is kept as reference for the hosted variant.
- `src/styles.css` holds the design tokens.

## Security notes

Every table has RLS scoped to `auth.uid()`, and storage policies limit objects to
the caller's own folder. The publishable key is public and safe in the browser;
a secret key or the database password must never appear in this repository.
