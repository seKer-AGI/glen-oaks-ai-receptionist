# Glen Oaks Dental Professionals: AI Dental Receptionist

A voice-only AI receptionist for [Glen Oaks Dental Professionals](https://www.glenoaksdentalprofessionals.com/). A patient opens the web app, clicks **Start Call**, and talks to a receptionist that answers from a knowledge base built from the practice website and collects **appointment requests** (not confirmed bookings) into a database. Staff review them in an admin dashboard.

## 1. What it does

- Real-time spoken conversation in the browser: mic → speech-to-text → LLM → text-to-speech.
- Answers about services, locations, doctors, insurance, payment, sedation, Invisalign and implants using retrieval over `knowledge/`.
- Replies are **at most 20 words**, enforced in code, not only in the prompt.
- Appointment-request workflow: asks one question at a time for exactly five items (full name, address, phone, preferred date, reason), saves the request, then says *"Thank you. We'll reach out to you shortly."* It never claims confirmation.
- Live transcript, live appointment panel, call status, graceful errors.
- Admin dashboard: search, filter by status, view, update status, delete, view stored call transcript.

## 2. Architecture

```
Browser                                   Next.js server (Node runtime)
-------                                   ------------------------------
mic → AudioWorklet → VAD (end of speech)
   → 16 kHz WAV ──POST /api/voice/turn──▶ STT (OpenAI gpt-4o-mini-transcribe)
                                           ↓
                                          knowledge retrieval (BM25 over knowledge/*.md)
                                           ↓
                                          LLM (OpenAI chat + update_appointment tool)
                                           ↓
                                          validation → save appointment_requests (PostgreSQL)
                                           ↓
                                          word-count check → regenerate → shorten (≤ 20 words)
   ◀── NDJSON stream: transcript, reply,  ↓
       audio (mp3, base64)  ◀──────────── TTS (OpenAI gpt-4o-mini-tts, voice "coral")
plays audio; barge-in stops playback
```

Key design choices:

- **One provider (OpenAI), three server-side calls.** One API key, no WebRTC/media server to run. Simplest reliable architecture.
- **Why not the OpenAI Realtime speech-to-speech API?** It speaks before any code can check the text, so the mandatory 20-word limit could not be enforced programmatically. This pipeline checks every reply before it is spoken.
- **Voice activity detection runs in the browser** (adaptive energy threshold, ~0.7 s end-of-speech). It supports interruptions (barge-in), "wait", "hello?", unclear speech, and silence prompts after 12 s.
- **Retrieval, not a giant prompt.** `knowledge/*.md` is chunked by `##` heading and ranked with BM25 plus a small synonym map. The top 3 chunks are injected per turn. If nothing matches, the LLM is told to say *"I can have our team provide that information."*
- **The server owns the appointment state.** The LLM only calls `update_appointment`; the server validates each field and saves once all five are valid. The final sentence is produced by code, so it cannot drift.
- **Emergency language** (severe pain, knocked-out tooth, swelling, bleeding, trauma, urgent) gets a fixed answer based on the website's statement that emergency appointments are offered: *"We offer emergency appointments. Please call us directly, Glen Oaks at 718-343-7700."* No diagnosis or procedures.

## 3. Technologies

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS 3 · OpenAI API (STT, chat, TTS) · PostgreSQL (`pg`) · Zod · Vitest

## 4. Installation

Requires Node.js 20+ (developed on 22), a running PostgreSQL server with an (empty) database such as `dentistDB`, and an OpenAI API key.

```bash
npm install
cp .env.example .env.local      # then edit .env.local and set OPENAI_API_KEY
npm run dev
```

Open http://localhost:3000. On Windows PowerShell use `Copy-Item .env.example .env.local`.

## 5. Environment variables

All secrets are server-side only. Nothing is exposed to the browser (`NEXT_PUBLIC_APP_URL` is non-secret).

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `OPENAI_API_KEY` | yes | none | STT, LLM, TTS |
| `OPENAI_CHAT_MODEL` | no | `gpt-4.1-mini` | Receptionist LLM |
| `OPENAI_STT_MODEL` | no | `gpt-4o-mini-transcribe` | Speech-to-text |
| `OPENAI_TTS_MODEL` | no | `gpt-4o-mini-tts` | Text-to-speech |
| `OPENAI_TTS_VOICE` | no | `coral` | Voice (e.g. `nova`, `shimmer`, `sage`) |
| `PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD` / `PGDATABASE` | yes (or `DATABASE_URL`) | `localhost` / `5432` / OS user / none / OS user | PostgreSQL connection (e.g. database `dentistDB`) |
| `DATABASE_URL` | no | none | Alternative to the `PG*` variables (e.g. Neon, Supabase, Railway) |
| `ADMIN_PASSWORD` | prod | `admin` in dev only | Admin login |
| `SESSION_SECRET` | prod | random per process in dev | Signs the admin cookie |
| `NEXT_PUBLIC_APP_URL` | no | none | Public URL |

## 6. Database setup

The app uses **PostgreSQL**. Create an empty database (for example `dentistDB`), then put the connection details in `.env.local` (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, or one `DATABASE_URL`). The tables are created automatically on first use. To create them and check the connection explicitly:

```bash
npm run db:init
```

Tables: `appointment_requests` (`id, full_name, address, phone, preferred_date, reason, location, status, created_at, updated_at`; status is `new | contacted | completed | cancelled`) and `call_transcripts` (the conversation, linked to the requests it produced). The schema is in `lib/db.ts` and is idempotent (`CREATE TABLE IF NOT EXISTS`).

Note: PostgreSQL lowercases unquoted database names. If you created it as `"dentistDB"` (quoted, e.g. in pgAdmin) keep `PGDATABASE=dentistDB` exactly. If you created it unquoted, the real name is `dentistdb`.

## 7. Knowledge base setup

Source of truth: `knowledge/*.md`, written from the official website pages (home, offices, doctors, contact, services, Invisalign, implants, sedation, orthodontics, Teeth In A Day, pediatrics, gum treatment, TMJ, dentures, patient education and others). To update it, edit the Markdown. Each `## Heading` becomes one retrievable chunk and the server reloads on restart.

```bash
npm run kb:check                       # chunk count + sample retrieval
npm run kb:check -- "Do you do braces?"
```

Facts the website does **not** state were left out on purpose: specific insurers, after-hours emergency procedures, a child's first-visit age, which doctor works at which office. The receptionist says the team can provide those.

Note: the website lists office hours inconsistently (contact page: Mon–Fri 10:30–6:30, Sat 9–3:30; offices page: last weekday appointment 6 pm, weekends 9–1). `knowledge/locations.md` records both and tells callers to confirm with the office.

## 8. Running locally

```bash
npm run dev                  # development
npm run build && npm start   # production build
```

- Receptionist: http://localhost:3000
- Admin: http://localhost:3000/admin (dev password `admin` unless `ADMIN_PASSWORD` is set)

## 9. Voice API setup

1. Create an API key at https://platform.openai.com/api-keys (billing enabled).
2. Put it in `.env.local` as `OPENAI_API_KEY`.
3. Use **Chrome or Edge** (the tested target), allow the microphone, and wear headphones if possible to avoid speaker echo.

Cost is low: each turn is one short transcription, one short chat completion and one short TTS clip.

## 10. Testing

```bash
npm test          # unit tests (vitest)
npm run lint      # TypeScript type check
```

Covered: appointment creation and required fields, field validation, the appointment workflow (five-question flow, corrections, invalid phone, save failure), knowledge retrieval, the 20-word limit (validation, regeneration, shortening fallback), emergency and "wait"/"hello?" handling, location handling.

**End-to-end over real HTTP without an OpenAI key** (a test mock stands in for OpenAI's endpoints; the database is your real PostgreSQL, and the test deletes the request it creates):

```bash
node tests/e2e/mock-openai.mjs &
ADMIN_PASSWORD=pw SESSION_SECRET=s OPENAI_API_KEY=test OPENAI_BASE_URL=http://localhost:4010/v1 npm start -- -p 3100 &
ADMIN_PASSWORD=pw BASE=http://localhost:3100 node tests/e2e/run.mjs
```

**Live test with your real OpenAI key and database** (a synthetic patient voice is generated with OpenAI TTS and sent through the real endpoints; it creates and leaves one test request in the database):

```bash
npm run dev -- -p 3200
node --env-file=.env.local tests/e2e/live.mjs
```

### Demo script

1. Open the site → **Start Call** → allow the mic.
2. "Hi, what services do you offer?" → "Do you offer Invisalign?" → "Where are you located?"
3. "I'd like to book an appointment." → give name, address, phone, date, reason.
4. The receptionist says *"Thank you. We'll reach out to you shortly."* The right-hand panel shows the request saved.
5. Open `/admin`, sign in, and see the request. Open it to view the call transcript. Change status. **End Call.**

## 11. Production deployment

The app needs a **long-lived Node server** because call sessions are held in memory. Not a serverless-only host. The database can be any hosted PostgreSQL (Neon, Supabase, Railway, RDS).

- **Recommended: Railway, Render or Fly.io** as a single web service. Set `DATABASE_URL` to your hosted Postgres, set `OPENAI_API_KEY`, `ADMIN_PASSWORD`, `SESSION_SECRET`, and run `npm run build` then `npm start`. Run a **single instance** (sessions live in memory).
- **Vercel** is possible only if call sessions are moved from memory into the database (a call's turns can land on different serverless instances).
- HTTPS is required for microphone access outside `localhost`; all of the above provide it.
- The admin cookie is `HttpOnly`, `SameSite=Strict`, and `Secure` in production. In production the server refuses admin login unless `ADMIN_PASSWORD` and `SESSION_SECRET` are set. For real use, put the admin behind your SSO or IP allow-list.

## 12. Troubleshooting

| Symptom | Fix |
|---|---|
| "The receptionist is not configured yet" | `OPENAI_API_KEY` missing in `.env.local`. Restart `npm run dev`. |
| "Please allow microphone access to start." | Allow the mic in the browser's site settings. Use `localhost` or HTTPS. |
| "I'm having trouble connecting" | OpenAI call failed: check the key, billing, model names, and server console. |
| Receptionist never replies | Speak a little louder or closer; the browser detects speech by volume. Check the right mic is selected. |
| Receptionist cuts in on itself | Use headphones. Speaker echo can trigger barge-in. |
| `password authentication failed` | Wrong `PGPASSWORD`/`PGUSER` in `.env.local`. Restart `npm run dev` after editing. |
| `database "dentistDB" does not exist` | Check the exact name/case in pgAdmin (see section 6). |
| `ECONNREFUSED 5432` | PostgreSQL is not running or uses another host/port. |
| Admin says "not configured" in production | Set `ADMIN_PASSWORD` and `SESSION_SECRET`. |
| Model not found | Set `OPENAI_CHAT_MODEL` / `OPENAI_STT_MODEL` / `OPENAI_TTS_MODEL` to models your account can use. |

## Project structure

```
app/                  Next.js pages + API routes
  api/voice/{start,turn,end}   voice session endpoints
  api/admin/...                login, logout, requests CRUD
  admin/                       dashboard page
components/           CallInterface, TranscriptPanel, AppointmentPanel, AdminDashboard
hooks/useVoiceCall.ts mic capture, VAD, streaming playback, barge-in
lib/                  receptionist engine, knowledge/BM25, validation, 20-word enforcement,
                      OpenAI wrapper, DB, appointments, admin auth, rate limiting
knowledge/            website-derived knowledge base (Markdown)
public/pcm-worklet.js AudioWorklet for mic capture
scripts/              init-db, kb-check
tests/                unit tests + e2e harness
```

## Limitations

- Measured with live OpenAI APIs from a local machine: the first syllable of the reply arrives about 2 to 3 seconds after the patient stops talking (speech-to-text ~1 s, LLM ~0.7 s, text-to-speech start ~1 s), plus the 0.7 s end-of-speech wait in the browser. Replies are validated whole before TTS (required for the 20-word rule), so the LLM output is not streamed into TTS, but the audio itself is streamed to the browser.
- Browser-side VAD is energy-based, so very noisy rooms may need a headset.
- Call sessions are in memory (single instance); transcripts are persisted.
- Unit tests run against an in-memory PostgreSQL emulator (`pg-mem`), so run `npm run db:init` once to verify your real database.
- The appointment is a **request**; there is no scheduling-system integration.
- Names, addresses and phone numbers are stored in plain PostgreSQL columns. Use disk encryption, TLS to the database and restricted access for real patient data, and review HIPAA obligations before production use. Server logs never contain call content.
