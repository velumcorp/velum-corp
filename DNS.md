# DNS - Velum Enterprise

Where the domain points, and what to change if it moves.

Source for the Netlify values: [Bring a domain to Netlify](https://docs.netlify.com/manage/domains/configure-domains/bring-a-domain-to-netlify/)
and [Configure external DNS](https://docs.netlify.com/manage/domains/configure-domains/configure-external-dns).

---

## Read this first

**The apex domain can point at Squarespace or at Netlify. It cannot point at both.**

The A records and the HTTPS record below are what send visitors to Squarespace. If you add
Netlify's records without removing them, the domain will resolve to whichever record set the
resolver happens to pick, the certificate will fail to issue on one side or the other, and the
site will be intermittently broken. Pick one option below and follow it all the way through.

This repository ships both targets on purpose, so the decision stays reversible:

| | Served by | Content lives in |
|---|---|---|
| Option A | Squarespace | `squarespace/` (code injection bundle) |
| Option B | Netlify | `site/` (published directly) |
| Option C | Both, on different hostnames | both |

---

## Current records (Squarespace)

This is what the zone holds today.

| Host | Type | Priority | TTL | Data |
|---|---|---|---|---|
| `@` | A | 0 | 4 hrs | `198.185.159.144` |
| `@` | A | 0 | 4 hrs | `198.185.159.145` |
| `@` | A | 0 | 4 hrs | `198.49.23.144` |
| `@` | A | 0 | 4 hrs | `198.49.23.145` |
| `www` | CNAME | 0 | 4 hrs | `ext-sq.squarespace.com` |
| `@` | HTTPS | 0 | 4 hrs | `1 . alpn="h2,http/1.1" ipv4hint="198.185.159.144,198.185.159.145,198.49.23.144,198.49.23.145"` |

The four A records are Squarespace's load balancers. The `HTTPS` record (an SVCB-family record)
advertises HTTP/2 support and repeats those same four IPs as hints. **It is Squarespace-specific.
If you move to Netlify it must be deleted**, not just left in place, because its `ipv4hint` will
keep steering clients that honour it back to Squarespace.

Squarespace may also have added a `verify.squarespace.com` CNAME during domain verification. It is
harmless to keep and harmless to remove once the domain is verified.

---

## Option A - stay on Squarespace

Change nothing in DNS. Deploy the design through the code injection bundle:

1. Build it, pointing at whatever host will serve the images, fonts and CSS:
   ```bash
   python build-squarespace.py --base https://velum-corp.netlify.app
   ```
2. Follow `squarespace/README.md`.

Squarespace cannot serve the `assets/` directory, so something else has to. The simplest
arrangement is to let Netlify host the assets on its own `*.netlify.app` address (no custom
domain, no DNS change at all) while Squarespace serves the pages. That is what the default
`--base` does.

---

## Option B - move the domain to Netlify

### 1. Add the domain in Netlify

Netlify dashboard: **Domain management → Add a domain → "Add a domain you already own"**, enter
the domain, verify. Netlify adds **both** the apex and `www` automatically, so both records below
are needed.

### 2. Remove the Squarespace records

Delete all six records in the table above:

- the four `@` A records
- the `www` CNAME to `ext-sq.squarespace.com`
- **the `@` HTTPS record** (this one is easy to miss)

### 3. Add the Netlify records

**Apex.** Netlify prefers an ALIAS, ANAME or flattened CNAME, because it follows the load
balancer if the IP changes:

| Host | Type | Data |
|---|---|---|
| `@` | ALIAS / ANAME / flattened CNAME | `apex-loadbalancer.netlify.com` |

If the registrar does not offer any of those at the apex (many do not, since CNAME at the apex is
not valid DNS), use the A record instead:

| Host | Type | Data |
|---|---|---|
| `@` | A | `75.2.60.5` |

**www.** Always a CNAME, pointing at this site's own Netlify subdomain:

| Host | Type | Data |
|---|---|---|
| `www` | CNAME | `<your-site-name>.netlify.app` |

Replace `<your-site-name>` with the real value from the Netlify site dashboard, for example
`velum-corp.netlify.app`. It is not a generic target; it is specific to the site.

> If the site is ever put on Netlify's High-Performance Edge, the load balancer values differ.
> The **Pending DNS verification** panel in the Netlify domain dashboard always shows the exact
> records for your site. When it disagrees with this file, believe the dashboard.

### 4. Wait, then check

DNS changes take up to 24 hours to propagate, occasionally 48. TTL on the current records is
4 hours, so allow at least that before concluding anything is wrong.

```bash
dig +short velum.enterprise
dig +short www.velum.enterprise
dig +short velum.enterprise HTTPS
```

The apex should return `75.2.60.5` (or resolve through `apex-loadbalancer.netlify.com`), `www`
should resolve through `<your-site-name>.netlify.app`, and the HTTPS query should return nothing.
If it still returns the Squarespace `ipv4hint` string, that record was not deleted.

### 5. Certificate

Netlify provisions a Let's Encrypt certificate automatically once DNS resolves to it. It will not
issue while the old records are still answering, which is the usual reason a move appears to hang.
If it has not issued an hour after DNS is clean, use **Domain management → HTTPS → Renew
certificate**.

---

## Option C - run both

Useful while migrating, or if Squarespace is kept for something it is genuinely better at.

| Host | Type | Data | Serves |
|---|---|---|---|
| `@` | A ×4 | Squarespace IPs (unchanged) | Squarespace |
| `www` | CNAME | `ext-sq.squarespace.com` | Squarespace |
| `@` | HTTPS | unchanged | Squarespace |
| `new` | CNAME | `<your-site-name>.netlify.app` | Netlify |

`new.velum.enterprise` then serves the Netlify site while the apex stays on Squarespace. Add the
subdomain in Netlify's domain management so it provisions a certificate for it. Put a `noindex`
on the staging hostname so it does not compete with the live site in search results.

---

## Alternative: delegate the whole zone to Netlify DNS

Instead of managing records at the registrar, the nameservers can be pointed at Netlify and Netlify
runs the zone. Netlify assigns **four nameservers specific to your account**, shown when you choose
"Set up Netlify DNS" for the domain. They are not a fixed global set, so they are deliberately not
listed here.

Before delegating, copy every existing record out of the current zone, especially **MX and TXT
records for email**. Delegating moves the whole zone, and any record not recreated in Netlify DNS
stops resolving. Mail breaking is the common and expensive mistake here.

---

## Things to confirm before any of this

- **The actual domain name.** This repository still uses `velum.enterprise` as a placeholder in
  `canonical` tags, `sitemap.xml`, `robots.txt` and the JSON-LD block. The support address is on
  `velumcorp.com` and the git remote is `github.com/velumcorp/velum-corp`, so that is very likely
  the real domain, but it has not been confirmed, so nothing was changed. Once it is settled,
  search and replace `velum.enterprise` everywhere.
- **Mail must keep working.** The site sends people to `support@velumcorp.com`, so whatever
  change is made above, that domain's MX records have to keep resolving. This matters most for
  the "delegate the whole zone" route, where records not recreated in Netlify DNS simply stop.
