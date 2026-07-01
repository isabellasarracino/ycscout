# ycscout-web

A website version of the Activant YC Scout: a dashboard to check for new YC
batches and process them, and an Ask page for questions — all hosted for free
on Vercel, using the free Groq AI service and a free Neon Postgres database.

## What's different from the desktop version

This is a full rewrite in TypeScript/Next.js (the language Vercel websites run
in), not the Python command-line tool from before. Two things had to change
for a hosted website:

- **Storage**: a website has no local disk to save files to, so this uses a
  small free online database (Postgres, via Vercel's Neon integration)
  instead of the SQLite file the desktop version used.
- **Batch processing**: free hosting limits how long a single web request can
  run (about 10 seconds). Evaluating 150+ companies can't happen in one
  request, so the dashboard evaluates **one company at a time**, showing a
  progress bar, pausing briefly between each to respect Groq's free-tier rate
  limit. This also means processing is resumable — if you close the tab
  partway through, reopening and clicking "Process" again picks up where it
  left off instead of starting over.
- **Ask page**: instead of a fully autonomous multi-step agent (like the
  desktop CLI), this uses a simpler, more reliable approach: it looks for a
  batch name or company name in your question, pulls the relevant data from
  the database, and answers in a single step. This keeps every request fast
  and avoids timeouts, at the cost of being less flexible than the desktop
  version's tool-calling agent.

## Local development

```bash
npm install
cp .env.local.example .env.local   # fill in GROQ_API_KEY and DATABASE_URL
npm run dev
```

Visit http://localhost:3000.

## Deploying

See the deployment walkthrough provided separately — in short: push this to
GitHub, import it in Vercel, add a Postgres database from the Storage tab
(this sets `DATABASE_URL` automatically), add `GROQ_API_KEY` as an environment
variable, and deploy.

## Project layout

```
app/
  page.tsx                        dashboard (thesis, batch list, processing)
  ask/page.tsx                    Q&A chat page
  report/[key]/page.tsx           batch report view
  api/
    batches/route.ts              list/check batches
    batches/[key]/load/route.ts   load a batch's companies
    companies/[slug]/evaluate/route.ts   evaluate one company
    report/[key]/route.ts         assemble a batch's report
    thesis/route.ts               get/build the Activant thesis
    ask/route.ts                  answer a question
lib/
  db.ts          Postgres (Neon) access
  groq.ts        Groq API wrapper with retry/backoff
  yc.ts          YC directory fetching, founder parsing, batch diffing
  activant.ts    Activant research scraping + thesis building
  evaluate.ts    two-criteria company evaluation
  ask.ts         Q&A context retrieval + answering
```
