# Study app

A flashcard study app in the spirit of Quizlet: a library of decks, three study
modes (flashcards, multiple-choice learn and a timed match game), per-card
mastery with a light spaced-repetition schedule, streaks, and a progress page
with an activity heatmap and accuracy history. Cards can carry an image. It
runs on Freebuff Sites with Sign in with Freebuff, D1 for data and R2 for
images, and everything is scoped to the signed-in user.

The product name is `BRAND` in `src/shared/types.ts`; change it once.

## Run it

```sh
bun install
bun run dev        # http://localhost:5173 with local D1 and R2 (Miniflare)
bun run build      # dist/client (assets) + dist/study/index.js (Worker)
```

On localhost without `SUPABASE_URL` and `SUPABASE_ANON_KEY`, the app signs you
in as a loopback-only development user so everything works before auth is
configured. A new account is seeded with three sample decks, notes, a studio
board and some history; Settings can restore or clear them.

## Connect it to Supabase

1. Create a project at supabase.com, then copy the Project URL and anon
   (publishable) key from Project Settings -> API.
2. Put them in `.dev.vars` (see `.dev.vars.example`) for local development.
   Email/password sign-up works out of the box; if you keep email confirmation
   on, confirm the account from the Supabase dashboard before signing in.
3. The browser receives the URL and anon key from `GET /api/auth/status`, and
   the Worker verifies every `Authorization: Bearer` token against
   `/auth/v1/user` (cached per isolate).

## Connect it to Freebuff Sites

1. `sites_create`, then `sites_add_storage` for D1 named `DB` and R2 named `FILES`.
2. Save `SUPABASE_URL` and `SUPABASE_ANON_KEY` as project secrets.
3. `bun run build`, then `sites_deploy` with `deploy.json`.

## Where things are

- `src/worker/` is the Hono API. `db.ts` owns the schema (created on first
  request) and the streak maths, `seed.ts` the sample decks, `auth.ts` the
  Freebuff integration and the loopback-only development user,
  `routes/decks.ts` decks, cards, images and session recording (where mastery
  and due dates are updated), `routes/account.ts` the profile and stats.
- `src/app/` is the React app. `pages/Flashcards.tsx`, `Learn.tsx` and
  `Match.tsx` are the study modes; each ends in `components/Summary.tsx`,
  which records the session once. `components/ui.tsx` holds the primitives.
- `src/styles.css` holds the design tokens. Everything rounded is a squircle
  via `corner-shape`; true circles use the `round` class.

## Security notes

Every `/api/*` route requires a valid Supabase access token and scopes queries
by `owner_sub` (the Supabase user id). Mutations must be same-origin. Images are
addressed by card row, never by R2 key. Personalised responses are
`Cache-Control: private, no-store`.
