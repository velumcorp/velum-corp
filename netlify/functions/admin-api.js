/* ==========================================================================
   VELUM ENTERPRISE - admin backend
   One function, two jobs: hand the editor a page's current source, and commit
   an edited page back to GitHub. Netlify redeploys on the commit.

   WHY THIS EXISTS AT ALL
   ----------------------
   The obvious route (Netlify Identity + Git Gateway) is not available for new
   sites: Git Gateway is deprecated and only receives security fixes. So the
   write path is this function instead. It holds the GitHub token server-side
   and never exposes it to the browser, which is also the safer arrangement.

   SECURITY MODEL
   --------------
   Netlify populates context.clientContext.user when a request carries a valid
   Netlify Identity JWT. That check is done by Netlify, not by us, so a forged
   token cannot reach the write path. On top of that we require the user to
   carry the "editor" role, so an Identity account alone is not enough.

   ENVIRONMENT (Site configuration > Environment variables)
   -------------------------------------------------------
     GITHUB_TOKEN   fine-grained PAT, "Contents: read and write" on the repos
                    listed in SITES below, nothing else
     GITHUB_OWNER   e.g. velumcorp
   ========================================================================== */

'use strict';

const OWNER = process.env.GITHUB_OWNER || 'velumcorp';
const TOKEN = process.env.GITHUB_TOKEN;

/* Every site this tool may edit. Adding a subdomain later means adding a row
   here and giving the token access to that repo. Paths are an allow-list: the
   editor cannot reach a file that is not named by one of these prefixes. */
const SITES = {
  'velumcorp.com': {
    repo: 'velum-corp',
    branch: 'main',
    root: 'site/',
    pages: [
      { path: 'site/index.html',   label: 'Inicio / Home' },
      { path: 'site/houses.html',  label: 'Las casas / Houses' },
      { path: 'site/about.html',   label: 'El grupo / The group' },
      { path: 'site/contact.html', label: 'Contacto / Contact' }
    ]
  }
  /* Example of a future subdomain:
  'travel.velumcorp.com': {
    repo: 'velum-travel', branch: 'main', root: 'site/',
    pages: [{ path: 'site/index.html', label: 'Home' }]
  }
  */
};

/* GitHub's errors are unhelpful for the mistakes people actually make with
   fine-grained tokens. Most importantly it answers 404, not 403, when the token
   simply cannot see the repository, which reads as "the file is missing" and
   sends you looking in entirely the wrong place. Translate before surfacing. */
function explain(status, repo, path) {
  if (status === 401) {
    return 'GitHub rejected the token. It is wrong, revoked, or expired. ' +
           'Generate a new one and update GITHUB_TOKEN in Netlify.';
  }
  if (status === 403) {
    return 'The token reached GitHub but is not allowed to do this. Check it ' +
           'has Repository permissions > Contents: Read and write.';
  }
  if (status === 404) {
    return 'GitHub cannot see ' + repo + '/' + path + '. Almost always this ' +
           'means the token was not granted access to that repository: edit ' +
           'the token, set Repository access to "Only select repositories" ' +
           'and pick ' + repo + '. (GitHub reports this as 404, not 403.)';
  }
  if (status === 409) {
    return 'Someone else saved this page while you were editing. Reload to get ' +
           'their version, then reapply your change.';
  }
  return 'GitHub returned ' + status + '.';
}

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body)
});

function gh(path, options = {}) {
  return fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'velum-admin',
      ...(options.headers || {})
    }
  });
}

/* A page is editable only if it is named in SITES. Never trust a client path. */
function resolve(siteKey, pagePath) {
  const site = SITES[siteKey];
  if (!site) return { error: `unknown site: ${siteKey}` };
  const page = site.pages.find((p) => p.path === pagePath);
  if (!page) return { error: `page not editable: ${pagePath}` };
  return { site, page };
}

exports.handler = async (event, context) => {
  if (!TOKEN) {
    return json(500, {
      error: 'GITHUB_TOKEN is not set on this site. Add it under Site ' +
             'configuration > Environment variables, then trigger a redeploy: ' +
             'functions only pick up new variables at deploy time.'
    });
  }

  /* Netlify verifies the Identity JWT before we ever see the request. */
  const user = context.clientContext && context.clientContext.user;
  if (!user) {
    return json(401, { error: 'Sign in to continue.' });
  }
  const roles = (user.app_metadata && user.app_metadata.roles) || [];
  if (!roles.includes('editor')) {
    return json(403, {
      error: 'This account does not have the "editor" role. ' +
             'Ask an administrator to add it in Netlify > Identity.'
    });
  }

  /* ---------------------------------------------------------- list sites */
  if (event.httpMethod === 'GET' && !event.queryStringParameters.path) {
    return json(200, {
      user: user.email,
      sites: Object.entries(SITES).map(([key, s]) => ({
        key, pages: s.pages
      }))
    });
  }

  /* ------------------------------------------------------------ load page */
  if (event.httpMethod === 'GET') {
    const { site: siteKey, path } = event.queryStringParameters;
    const r = resolve(siteKey, path);
    if (r.error) return json(400, { error: r.error });

    const res = await gh(
      `/repos/${OWNER}/${r.site.repo}/contents/${encodeURIComponent(path)}?ref=${r.site.branch}`
    );
    if (!res.ok) {
      return json(res.status, { error: explain(res.status, `${OWNER}/${r.site.repo}`, path) });
    }
    const data = await res.json();
    return json(200, {
      path,
      sha: data.sha,                                   /* needed to write back */
      html: Buffer.from(data.content, 'base64').toString('utf8')
    });
  }

  /* ------------------------------------------------------------ save page */
  if (event.httpMethod === 'PUT') {
    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return json(400, { error: 'Body is not valid JSON.' });
    }
    const { site: siteKey, path, html, sha, summary } = payload;

    const r = resolve(siteKey, path);
    if (r.error) return json(400, { error: r.error });
    if (typeof html !== 'string' || !html.trim()) {
      return json(400, { error: 'Nothing to save.' });
    }
    if (!sha) {
      return json(400, { error: 'Missing sha. Reload the page and try again.' });
    }
    /* A page that lost its <html> tag means something went wrong upstream.
       Refuse rather than commit a broken file. */
    if (!/<\/html>\s*$/i.test(html.trim())) {
      return json(400, { error: 'That does not look like a complete page. Not saved.' });
    }

    const message =
      `Edit ${path.split('/').pop()}${summary ? `: ${summary}` : ''}\n\n` +
      `Edited via the Velum admin by ${user.email}.`;

    const res = await gh(
      `/repos/${OWNER}/${r.site.repo}/contents/${encodeURIComponent(path)}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          message,
          content: Buffer.from(html, 'utf8').toString('base64'),
          sha,
          branch: r.site.branch
        })
      }
    );

    if (!res.ok) {
      return json(res.status, { error: explain(res.status, `${OWNER}/${r.site.repo}`, path) });
    }

    const out = await res.json();
    return json(200, {
      ok: true,
      sha: out.content && out.content.sha,
      commit: out.commit && out.commit.html_url
    });
  }

  return json(405, { error: `${event.httpMethod} not allowed.` });
};
