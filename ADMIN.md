# Admin panel

An internal editor at **`/admin/`** on the live site. Sign in with a Velum
account, pick a page, edit the text in Spanish and English side by side, press
save. The change is committed to this repository and Netlify republishes within
a couple of minutes.

It only works on the deployed site. Opening `/admin/` locally shows the login
card and an error, because the login service and the save function both live on
Netlify.

---

## What it can and cannot do

**Can:** edit any text on the four public pages, in both languages at once.
There are 235 editable strings across the site: headlines, body copy, house
descriptions, button labels, the manifesto, footer links.

**Cannot:** change layout, colours, images, or add and remove sections. That is
deliberate. An editor that can rearrange the page is an editor that can break
it, and the whole point is that a non-designer can safely change wording without
being able to damage the design.

Every save is an ordinary git commit, so anything can be undone from the
repository history.

---

## One-time setup

Four steps. All on the Netlify side except the token.

### 1. Turn on Netlify Identity

Site configuration → **Identity** → Enable Identity.

Then under **Registration**, set it to **Invite only**. Do not leave it open,
or anyone could create an account.

If you want people to sign in with their Google Workspace account rather than a
separate password: Identity → External providers → enable **Google**.

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

### 4. Invite the editors

Identity → **Invite users** → enter their email addresses.

Then, for each person once they have accepted, open their user record and edit
**Roles**, adding:

```
editor
```

**This is required.** An Identity account with no `editor` role can sign in but
every load and save is refused. That is the second lock: losing control of an
account is not the same as losing control of the site.

---

## Using it

1. Go to `https://velumcorp.com/admin/`
2. Sign in
3. Pick the page from the dropdown at the top
4. Edit. Changed fields are marked in gold down the left edge
5. "Ver en la página" scrolls the preview to the text you are editing
6. Optionally write a one-line note of what you changed
7. **Guardar y publicar**

The preview shows your unsaved edits. The ES/EN buttons above it switch the
preview language so you can check both.

Leaving the page with unsaved changes asks for confirmation first.

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
