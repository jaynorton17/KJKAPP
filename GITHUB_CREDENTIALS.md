# GitHub Credentials For Pushes

Do not put real GitHub tokens in this repo.

The current remote is:

```bash
https://github.com/jaynorton17/KJKAPP.git
```

## Recommended Option

Use the GitHub CLI so credentials are stored by the system credential manager:

```bash
gh auth login
```

Choose:

- GitHub.com
- HTTPS
- Authenticate with browser or paste a token

After login, test with:

```bash
git push origin main
```

## Token File Option

If you want Git's simple credential store, put the real credential in:

```text
~/.git-credentials
```

The file should contain one line like this:

```text
https://YOUR_GITHUB_USERNAME:YOUR_GITHUB_PERSONAL_ACCESS_TOKEN@github.com
```

For this repo, the username is probably:

```text
jaynorton17
```

So the real file would look like:

```text
https://jaynorton17:PASTE_TOKEN_HERE@github.com
```

Then run:

```bash
git config --global credential.helper store
chmod 600 ~/.git-credentials
git push origin main
```

## Token Requirements

GitHub account passwords do not work for HTTPS pushes. Use a Personal Access Token.

For a fine-grained token, allow access to `jaynorton17/KJKAPP` and give it `Contents: Read and write`.

For a classic token, the usual scope is `repo`.

