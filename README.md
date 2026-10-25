# SEO blog with lead forms and an admin panel

A fast blog built for search traffic. Every post ends with a lead form. You and your team publish from `/admin/` with a **username and password**. Nobody needs a GitHub account or access to the code.

**How it works:** the admin panel saves each post as a file in your GitHub repository. Netlify sees the change and rebuilds the site (about a minute). Your GitHub account is used behind the scenes by a secret token, so people sign in with their own username and password and never touch GitHub.

Everything below is free: GitHub, Netlify's free plan, and Resend's free plan for email alerts.

---

## Setup (about 20 minutes)

### 1. Put the files on GitHub
1. On github.com click **New repository**. Name it (for example `my-blog`). Private is fine.
2. Unzip this folder. In the new repository click **Add file > Upload files**, drag in everything from inside the folder, and click **Commit changes**.
   Check that `netlify.toml`, `site.config.json` and the `admin`, `content`, `netlify` and `scripts` folders are all there.

### 2. Connect Netlify
1. Sign up at netlify.com with your GitHub account.
2. **Add new project > Import an existing project > GitHub**, choose your repository, and click **Deploy**. The build settings come from `netlify.toml`, so leave them as they are.
3. The first deploy works but the admin cannot save yet. Do steps 3 and 4 next.

### 3. Create a GitHub token (lets the admin panel save posts)
1. On GitHub open **Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token**.
2. **Repository access:** Only select repositories, and pick your blog repository.
3. **Permissions > Repository permissions > Contents:** Read and write.
4. Generate the token and copy it. It starts with `github_pat_`. You will not see it again.
   Fine-grained tokens expire (at most 1 year). Put a reminder in your calendar to make a new one and replace `GITHUB_TOKEN`.

### 4. Add settings in Netlify
Open your site in Netlify: **Site configuration > Environment variables > Add a variable**.

| Name | Value | Required |
|---|---|---|
| `GITHUB_REPO` | `your-github-username/my-blog` | Yes |
| `GITHUB_TOKEN` | the token from step 3 | Yes |
| `ADMIN_USERNAME` | the owner's username, for example `al` | Yes |
| `ADMIN_PASSWORD` | a long password, 12 or more characters | Yes |
| `GITHUB_BRANCH` | only if your branch is not `main` | No |
| `SITE_URL` | `https://www.yourdomain.com` once you have a domain | Recommended |
| `RESEND_API_KEY` | key from resend.com (see step 6) | For email alerts |
| `LEAD_NOTIFY_EMAIL` | the email that gets each new lead (commas for several) | For email alerts |

Then go to **Deploys > Trigger deploy > Clear cache and deploy site**. Variables only apply to new deploys.

### 5. Sign in
Open `https://your-site.netlify.app/admin/` and sign in with `ADMIN_USERNAME` and `ADMIN_PASSWORD`. Delete the two sample posts and write your own.

### 6. Email alerts for new leads (optional, free)
1. Create a free account at resend.com and use **API Keys > Create API key**. Paste it into `RESEND_API_KEY`.
2. Set `LEAD_NOTIFY_EMAIL` to the email you used to sign up with Resend. With no domain verified, Resend only delivers to that address, which is what you need here.
3. To send from your own address later, verify your domain in Resend and add `LEAD_FROM_EMAIL` (for example `Leads <leads@yourdomain.com>`).

Leads are always saved in the admin **Leads** tab, even if email is not set up.

---

## Daily use

- **Write a post:** Admin > Posts > New post. Use **Save draft** while you work and **Publish** when ready. Upload images with the Image button. They are resized for you.
- **Search settings:** the sidebar shows how the post will look in Google. Keep the title under 60 characters and the description under 160.
- **Leads:** Admin > Leads. Mark each one new, contacted, won or lost, add notes, or download a CSV.
- **Settings (owner only):** site name, home headline, address, accent colour, and the wording of the lead form.
- **Team (owner only):** add an editor with their own username and password. Editors can write posts and see leads. Remove one and they are signed out straight away.
- **Your own password:** change `ADMIN_PASSWORD` in Netlify and redeploy. All owner sessions end.

Each save creates a GitHub commit and a Netlify build (about 20 seconds of the 300 free build minutes per month). Publishing several posts in a row is fine. You can undo any change from the repository's history on GitHub.

## After launch
1. Add your domain in Netlify (**Domain management**) and set `SITE_URL` to it.
2. In Google Search Console add your site and submit `https://yourdomain.com/sitemap.xml`.
3. Each post already has a title tag, description, canonical link, social preview tags, structured data, and an entry in the sitemap and RSS feed.

## Security notes
- Passwords are checked on the server. Sessions use a signed cookie that scripts cannot read. Repeated wrong passwords lock that connection for 15 minutes.
- Team passwords are stored hashed. The owner password lives in your Netlify settings only.
- Raw HTML inside posts is shown as text and unsafe links are removed, so an editor cannot add scripts to your site.
- The GitHub token can only touch this one repository. Never paste it into a post or message.
- Lead forms have spam protection (hidden field, timing check, and 5 submissions per hour per visitor).

## Developer notes
`npm install`, then `npm run build` creates `dist/`. `npm test` runs the checks on the build and the API. Posts live in `content/posts/*.md`, settings in `site.config.json`, uploaded images in `static/uploads/`. The admin API is `netlify/functions/api.mjs`. Leads and team accounts are stored in Netlify Blobs.
