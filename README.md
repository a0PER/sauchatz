# Sauchatz

A chat website where people sign in with an email and password, build a profile with pictures and a description, browse everyone's profiles, message anyone privately, and create and chat in groups.

Built with React, TypeScript, Tailwind CSS and Supabase (login, Postgres database, picture storage and realtime messaging).

## Features

- **Sign in with email and password only.** Email confirmation, forgot password and password reset are included.
- **Profiles.** Profile picture, name, description, and a photo gallery with captions. Anyone signed in can open a profile, scroll through the photos in a full screen viewer and read the description.
- **People directory** with search, online people listed first.
- **Direct messages** with anyone (unless they turned off new messages or blocked you).
- **Groups.** Anyone can create one. Owners and admins can rename it, change its picture and description, add and remove people, and promote admins. Members can leave; owners can delete.
- **Live chat.** Messages appear instantly, typing indicators, online status, unread counts, read receipts ("Seen" and "Seen by everyone"), edit and delete your own messages, send photos (attach, paste or drag and drop), links become clickable.
- **Details panel** for every chat: profile card or member list, mute, shared photos, block and report, leave or delete group.
- **Settings:** change email, change password, delete account, status (Active, Away, Do not disturb), desktop notifications and sound, who can message you, read receipts, blocked people, light or dark theme, Enter to send.
- **Safety:** block, report (stored for moderators), and database security rules so people can only ever read conversations they belong to.
- Works on phones, tablets and desktop.

## Setup (about 10 minutes)

### 1. Create the Supabase project

1. Sign up at [supabase.com](https://supabase.com) and create a new project (the free tier is fine).
2. Open **SQL Editor**, click **New query**, paste the whole contents of `supabase/schema.sql`, and click **Run**. It creates the tables, the security rules, the storage buckets for pictures and turns on realtime.
3. Open **Authentication > URL Configuration**:
   - **Site URL:** your website address (use `http://localhost:5173` while testing).
   - **Redirect URLs:** add both `http://localhost:5173/**` and your live address followed by `/**`.
4. Optional: **Authentication > Emails** lets you customize the confirmation and reset emails. For a real launch, set up custom SMTP there, because Supabase's built in email sender is limited to a few emails per hour.

### 2. Run it on your computer

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
cp .env.example .env
```

Open `.env` and paste the values from Supabase **Project Settings > API**: the Project URL and the `anon` public key. Then:

```bash
npm install
npm run dev
```

Open http://localhost:5173, create two accounts (use two browsers or a private window) and message yourself.

### 3. Put it online (Cloudflare Pages, free)

1. Push this folder to the GitHub repository `sauchatz`.
2. In Cloudflare, go to **Workers & Pages > Create > Pages > Connect to Git** and pick the repository.
3. Build settings: framework preset **React (Vite)**, build command `npm run build`, output directory `dist`.
4. Under **Environment variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. Deploy. The site will be at `https://sauchatz.pages.dev` (or similar). Add that address to the Supabase Site URL and Redirect URLs.

Every push to GitHub redeploys the site automatically. Page links such as `/u/123` work without extra setup.

GitHub Pages alternative: run `npm run build:pages`, which builds for `a0per.github.io/sauchatz/`.

## GIFs (optional)

GIF search uses GIPHY. Get a free API key at developers.giphy.com (Create an App, choose API), then add it to your hosting settings as `VITE_GIPHY_KEY` and redeploy. Without a key the GIF button is hidden; people can still upload GIF files as photos.

## Changing things

- **Name of the site:** `src/config.ts` (`APP_NAME`) and the `<title>` in `index.html`.
- **Colors:** the variables at the top of `src/index.css`. `--accent` is the main brand color; there is a light and a dark set.
- **Logo:** the `Logo` component in `src/components/ui.tsx` and `public/favicon.svg`.
- **Profiles visible to signed out visitors:** profiles are currently visible only to signed in users. Ask before changing this, since it needs both a database rule and a public profile page.

## Moderation

Reports are saved in the `reports` table. Review them in Supabase **Table Editor > reports**. To remove someone, delete them in **Authentication > Users**; everything they own is removed with them.

## Project layout

```
supabase/schema.sql          Database, security rules, storage, realtime
supabase/test/               Automated security tests for the schema (npm run test:db)
src/contexts/                Sign in state, online presence, conversation list, toasts
src/pages/                   Sign in pages, app layout, chat, profile, people, settings
src/components/chat/         Message, composer and details panel
src/components/ui.tsx        Buttons, inputs, avatars, menus, dialogs
src/lib/                     Supabase client, image upload, formatting
```

## Tests

`npm run test:db` loads `schema.sql` into an in-memory Postgres and checks 48 security rules, for example that outsiders cannot read a direct message, that blocked people cannot send messages, that only admins can manage a group, and that people can only upload into their own picture folders.
