# Admin panel

An internal editor at **`/admin/`** on the live site. Sign in with a Velum
account, pick a page, edit the text in Spanish and English side by side, press
save. The change is committed to this repository and Netlify republishes within
a couple of minutes.

It only works on the deployed site. Opening `/admin/` locally shows the login
card and an error, because the login service and the save function both live on
Netlify.

While the site still has Netlify's password protection switched on, you will be
asked for the site password first and the Velum login second. Two prompts, both
expected. Turning the site password off at launch leaves only the second.

---

## What it can and cannot do

**Text.** Every string on the four public pages, Spanish and English edited as a
pair. 235 of them: headlines, body copy, house descriptions, button labels, the
manifesto, footer links.

**Images.** Swap any photograph for another from the site's library. The whole
family changes at once (the 900px and 1600px files, plus the width and height on
the tag) so the page stays consistent.

**Sections.** Reorder them, or hide one without deleting it. Reordering is
refused on a page that has content sitting between its sections, because moving
a section across that would drag unrelated content with it: `houses.html` is
like this, so there you can hide but not move.

**Cannot:** change colours, type, spacing or the design itself, add or delete
sections, or edit anything outside the four listed pages. That boundary is the
point. Someone should be able to change the site without being able to break how
it looks.

Every save is an ordinary git commit, so anything can be undone from the
repository history.

---

## How it is laid out

Two surfaces, borrowed from Template Forge and cut down: the page itself, and an
inspector for whatever is selected.

**Tap anything in the page to edit it.** A headline opens its text, an image
opens the picker, anywhere else opens the section list. The dock along the bottom
browses the same three things when you would rather work through a list.

On a phone the inspector is a sheet over the page. On a desktop it is a column
beside it. The dock is fixed to the bottom of the screen in both, so saving is
always one reach away. It was built phone first, because that is where it will
mostly be used.

---

## One-time setup

Four steps. All on the Netlify side except the token.

### 1. Turn on Netlify Identity, and use Google to sign in

Site configuration → **Identity** → Enable Identity.

**Do the next steps in this order.** Registration set to "Invite only" rejects a
Google sign-in from someone who has never been invited, which lands you back on
the broken invitation emails. So open the door, walk through it, then close it:

1. Identity → **Registration** → set to **Open** for now
2. Add the Google provider (below)
3. Sign in at `/admin/` with Google. This creates your account.
4. Identity → Users → your record → add the `editor` role
5. Identity → Registration → set back to **Invite only**
6. Sign out and back in, so your session carries the role

The open window is safe: the site is still behind Netlify's password, and an
account without the `editor` role can do nothing but see a refusal message.

Now the provider itself. The setting is not
directly under Identity; it is on the **Registration** tab inside it:

**Identity → Registration → External providers → Add provider → Google**

Direct link for this site:
`https://app.netlify.com/projects/velum-corp/identity?tab=registration#external-providers`

Google, GitHub, GitLab and Bitbucket providers are included on every Netlify
plan, free tier included. Only custom email templates and audit logs need a paid
plan, and neither is used here.

**Sign in with Google, not with email and password.** Netlify Identity's
invitation and confirmation emails are known to be unreliable and frequently
never arrive, which blocks the email flow completely with no error to show for
it. Google sign-in sends no email at all, so it cannot fail that way. It also
means access follows the Workspace account: revoke someone's Workspace login and
their access to this panel goes with it.

The account is created on the person's first Google sign-in. There is nothing to
invite and nothing to confirm.

> Netlify Identity itself is current and supported. Its old companion, **Git
> Gateway, is deprecated** and is not used here. This panel writes through its
> own function instead, which is why there is a token to create in step 2.

### 2. Create a GitHub token

On GitHub: Settings → Developer settings → **Fine-grained personal access
tokens** → Generate new token.

| Setting | Value |
|---|---|
| Repository access | Only select repositories → `velumcorp/velum-corp` |
| Permissions | **Contents: Read and write**. Nothing else. |
| Expiration | Set a date and diarise the renewal |

Copy the token once; GitHub will not show it again.

### 3. Give the token to Netlify

Site configuration → Environment variables → add two:

| Key | Value |
|---|---|
| `GITHUB_TOKEN` | the token from step 2 |
| `GITHUB_OWNER` | `velumcorp` |

The token stays on Netlify's servers. It is never sent to the browser, which is
why the panel needs a function at all rather than talking to GitHub directly.

### 4. Give each person the editor role

For everyone after you, registration is back on "Invite only", so invite them
first (Identity → Invite users). If the invitation email does not arrive, which
is likely, flip Registration to **Open** for the minute it takes them to sign in
with Google, then set it back.

Either way they end up at a message saying the account has no editor role. That
is expected: the sign-in created their user record, which is what you needed.

Now go to Identity → Users → their record → **Roles**, and add:

```
editor
```

**Then have them sign out and sign in again.** Roles are written into the
session token at the moment it is issued, so a session started before the role
was added still will not have it. This is the single most common "I added the
role and it still does not work" — the fix is always a fresh sign-in.

The role is required. An account without it can sign in but every load and save
is refused: losing control of an account is not the same as losing control of
the site.

> Prefer not to hand out roles one by one? The alternative is to drop Identity
> and verify a Google ID token directly in the function, allowing any
> `@velumcorp.com` address. That removes invitations and roles entirely, at the
> cost of rewriting the auth path. Worth doing if the editor list grows.

---

## Using it

1. Go to `https://velumcorp.com/admin/`
2. Sign in
3. Pick the page from the menu at the top left
4. Tap what you want to change, or browse from the dock
5. Edit. Anything changed is marked in gold down its left edge
6. **Guardar** shows what will be published, then **Publicar**

The page you are looking at is live: it shows your unsaved edits as you make
them. The ES/EN buttons in the top bar switch its language so you can check
both without saving.

Leaving with unsaved changes asks for confirmation first.

### Working offline

`python tools/dev-server.py` then `http://localhost:8899/admin/` runs the whole
panel against the files on disk, with no login and no Netlify. Saves go to your
working tree rather than to git, so `git diff` shows them and `git checkout .`
throws them away. Useful for trying something out before doing it for real.

### If two people edit at once

The save is rejected with a message asking you to reload. Nothing is lost and
nothing is overwritten: whoever saves second is told to reload and reapply.

---

## Adding another site or subdomain

Open [`netlify/functions/admin-api.js`](netlify/functions/admin-api.js) and add
a row to `SITES`:

```js
'travel.velumcorp.com': {
  repo: 'velum-travel',
  branch: 'main',
  root: 'site/',
  pages: [
    { path: 'site/index.html', label: 'Home' }
  ]
}
```

Then give the GitHub token access to that repository as well. The new site
appears in the panel's dropdown.

`SITES` is an allow-list, not a convenience. The panel can only read and write
files named there, so a bug or a tampered request cannot reach any other file
in the repository.

---

## How it edits the HTML

Worth knowing if you ever review one of these commits.

Editable text is found by looking for the **`data-en` attribute**, which already
exists on every translatable string on the site. So the list of editable text
and the list of translated text are the same list, and Spanish and English are
always updated together. A generic click-to-edit tool would change the visible
Spanish and silently leave the English attribute stale.

Saves splice strings rather than parsing and re-serialising the page. A
round trip through a DOM parser would reformat the whole file and make every
commit unreadable. Instead each edit rewrites only its own characters, so
changing one headline produces a diff of about sixty characters.

The function refuses to save anything that does not still end in `</html>`, as a
cheap guard against writing a truncated file.

---

## Rotating the token

When the GitHub token expires or someone leaves:

1. Generate a new token (step 2)
2. Update `GITHUB_TOKEN` in Netlify (step 3)
3. Redeploy, or trigger any deploy, so functions pick up the new value
4. Revoke the old token on GitHub

To remove a person's access: Identity → their user → remove the `editor` role,
or delete the user.
