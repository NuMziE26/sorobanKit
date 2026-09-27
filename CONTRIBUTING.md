# Contributing to Stellar Tags

Thank you for contributing! The guidelines below help keep the codebase
consistent, secure, and easy to review.

## Table of contents

- [Development setup](#development-setup)
- [Commit conventions](#commit-conventions)
- [Pull requests](#pull-requests)
- [Secret scanning policy](#secret-scanning-policy)
- [Tests](#tests)

---

## Development setup

See [README.md](README.md) for step-by-step instructions on running the
frontend, backend, and smart contract locally.

---

## Commit conventions

Use short, imperative-mood commit messages:

```
fix: reject multi-sig accounts with zero-weight signers
feat: add get_version() to PaymentRouter contract
```

---

## Pull requests

- Keep PRs focused — one logical change per PR.
- Update relevant tests. CI blocks merges when coverage drops below the
  configured floor.
- Rebase against `main` before requesting a review.

---

## Secret scanning policy

### How it works

Every push and pull request is scanned by
[TruffleHog](https://github.com/trufflesecurity/trufflehog) via the
`.github/workflows/secret-scan.yml` workflow. The scanner runs with
`--fail`, which means **the CI check fails and blocks the PR** if any
live credential is found in the diff.

The scan covers the incremental diff only (from the repository default
branch to `HEAD`), so it is fast and targeted regardless of history length.

### What gets flagged

TruffleHog recognises hundreds of credential patterns, including:

- API keys and tokens (Stripe, Twilio, GitHub, AWS, etc.)
- Private keys (PEM, SSH, Stellar secret seeds starting with `S`)
- Database connection strings containing passwords
- JWT secrets and signing keys

### What to do if the scan fails

1. **Do not force-push secrets into history** — remove the secret from the
   branch with `git rebase -i` or `git filter-repo` before the PR is merged.
2. **Rotate the credential immediately** — assume it has been compromised
   once it appears in a diff, even in a private repository.
3. **Add a `.env` entry** — secrets belong in environment variables, not
   source files. See `.env.example` for the required variables.

### Test fixtures and false positives

Deliberately invalidated credentials used in tests (e.g. randomly generated
strings that match a pattern but have never been issued) must be listed in
`.github/trufflehog-ignore.txt` with a comment explaining why each entry is
safe to exclude.

The ignore file already excludes paths that match `.*test.*`, `.*spec.*`,
`tests/.*`, and `__tests__/.*`. If you need to add a new exception:

1. Open `.github/trufflehog-ignore.txt`.
2. Add a regex that matches only the relevant path (not the whole repo).
3. Add a comment on the line above documenting what the entry covers and
   why the credential is invalid.
4. Include the change in the same PR as the test that requires it.

### Stellar secret seeds

Stellar secret seeds (strings starting with `S` and 56 characters long)
are particularly sensitive because they grant direct access to on-chain
funds. Never commit a real seed. Use the testnet faucet to generate
throwaway keypairs for tests:

```bash
stellar keys generate --network testnet test-key
```

---

## Tests

```bash
# Smart contract
cd payment_router && cargo test

# Server
cd stellar-payment-platform && npm test

# Frontend
cd payment-dashboard && npm test
```

CI runs the full suite on every push. See the README for coverage thresholds.
