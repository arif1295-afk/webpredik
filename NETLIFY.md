Netlify automatic deploy instructions

Use the included helper scripts to create/link a Netlify site and perform an initial deploy.

Prerequisites:
- Install Netlify CLI: `npm install -g netlify-cli`
- Login: `netlify login`

PowerShell (Windows):

```powershell
cd C:\Users\LENOVO\Music\webgabut
.\scripts\netlify_deploy.ps1 -SiteName webpredik -RepoUrl https://github.com/arif1295-afk/webpredik -Prod
```

Bash (Linux/macOS/Git Bash on Windows):

```bash
./scripts/netlify_link.sh webpredik https://github.com/arif1295-afk/webpredik
netlify deploy --dir=. --prod
```

Notes:
- The CLI helps create/link and perform preview or production deploys, but connecting the GitHub repository for continuous deploys may require completing steps in the Netlify dashboard (granting GitHub access and selecting the repository).
- After GitHub is connected, Netlify will build/publish automatically on pushes to `main`.
