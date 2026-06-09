# Choir Tour Meals

A small mobile-friendly web app for pre-ordering meals on the choir Cape tour.

- **Members** sign in with their **name + member code + password**, can toggle **Show password** while typing, see two tabs (**Menu** / **My order**), pick **one meal and one drink** per restaurant, and lock it in with a double confirmation. They can only see their own orders, and they do not see prices.
- **You (the organiser)** sign in with a **username (or email) + password**, set up the restaurants and their food/drink options, and see **everyone's** orders with a per-kitchen summary you can read to each venue.

It's a plain static site (HTML/CSS/JS, no build step) backed by **Supabase** (Postgres + Auth + Row Level Security).

---

## Why Supabase (and not "local")

Local storage (`localStorage`/IndexedDB) only lives on each person's own phone, so the organiser could never collect 53 members' orders into one place. A shared database is required.

Supabase gives you that **plus security enforced in the database itself**, not just hidden in the screen:

| Rule | How it's enforced |
|---|---|
| Members read/write only their own orders | RLS policy `member_uid = auth.uid()` |
| Organiser reads every order | RLS policy `... or is_admin()` |
| Members read/edit only their own profile row | RLS policy `uid = auth.uid()` on `member_profiles` |
| An order can never be changed after saving | `orders` table has **no** update/delete policy |
| One order per member per restaurant | `unique (member_uid, rest_id)` constraint |
| Only the organiser can edit the menu | RLS policy `is_admin()` on `restaurants` |

The Supabase **anon/public key** in `supabase-client.js` is safe to ship in the browser — the RLS policies are what protect the data.

---

## Project layout

```
choir-tour-meals/
├─ public/
│  ├─ index.html
│  ├─ manifest.webmanifest
│  ├─ css/styles.css
│  └─ js/
│     ├─ supabase-client.js   ← paste your project URL + anon key here
│     ├─ data.js              ← all Supabase calls (auth + data)
│     └─ app.js               ← the UI
├─ supabase/
│  └─ schema.sql              ← run once in the Supabase SQL editor
├─ package.json
└─ README.md
```

---

## Setup (about 10 minutes)

### 1. Create the database
1. Make a free project at **supabase.com**.
2. Open **SQL Editor → New query**, paste all of `supabase/schema.sql`, and click **Run**.

If you already set this project up before, run the latest `supabase/schema.sql` again to add new helper functions (including member password reset).

### 2. Turn on member sign-in
**Authentication → Providers → Email → enable.**

For instant first-time member signup in the app, disable **Confirm email**.

### 3. Create your organiser account
1. **Authentication → Users → Add user.** Enter the organiser account email + a password and tick **Auto Confirm User**.
   For username-style login, use `username@example.com` and sign in with `username` in the app.
2. Copy the new user's **UID**.
3. Back in **SQL Editor**, run (paste your UID):
   ```sql
   insert into public.admins (uid) values ('PASTE-ORGANISER-UID');
   ```

### 4. Connect the app to your project
In **Project Settings → API**, copy the **Project URL** and the **anon public** key, then paste both into `public/js/supabase-client.js`.

---

## Run it locally (VS Code)

Open the folder in VS Code, then in the terminal:

```bash
npm run dev
```

That serves the `public/` folder (it uses `serve`). Open the printed URL.
Alternatively use the **Live Server** VS Code extension on `public/index.html`, or:

```bash
cd public && python3 -m http.server 5173
```

> It must be served over `http://` (not opened as a `file://` path), because it loads ES modules.

---

## Put it online for the choir

Any static host works. The repo now includes a GitHub Pages deployment workflow for the `public` folder.

### GitHub Pages (recommended)

1. Push this project to a GitHub repository.
2. In GitHub: **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Push to `main` (or `master`) and wait for the **Deploy To GitHub Pages** workflow to finish.
5. Open your site URL:
   - Repo site: `https://<your-username>.github.io/<repo-name>/`
   - User site (repo named `<your-username>.github.io`): `https://<your-username>.github.io/`

### Other static hosts

- **Netlify / Vercel / Cloudflare Pages:** drag-drop the `public` folder, or connect the repo and set the publish directory to `public`.

Then share the one link with all members. On a phone they can **Add to Home Screen** and it behaves like an app.

---

## How members and the organiser sign in

- **Member:** opens the link → enters name + unique member code + password. First time, tap **Create account** once; after that, use **Log in** with the same member code + password.
- **Organiser:** opens the link → **I'm the organiser — sign in** → username (or full email) + password from step 3.
- **Forgot member password:** organiser signs in, then clicks **Reset member password** in the admin top bar, enters the member code and a new password, and the member can log in immediately with the new password.

## Day-to-day

- **Menu setup:** add each restaurant (name, area, date, optional note) with its food and drink options. Each option can have an optional price and an optional ingredients/description line.
- **All orders:** every member's pick grouped by restaurant, a kitchen summary (e.g. *23 × Margherita*), an overall value, and a **Download summary** button for a plain-text file to send the venue.

---

## Notes & ideas

- To add another organiser, just insert their UID into `public.admins`.
- "Switch user" on a member's phone signs out and returns to login; members can sign back in later with the same member code + password to view their own orders.
- Possible next steps: live updates with Supabase Realtime, an order **deadline** after which the menu locks, dietary tags (veg / halal), or a per-member payment total.
