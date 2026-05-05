# groundmodel

Initial implementation of the `groundmodel` v0.1 spec:

- Rust workspace with a shared `groundmodel-core`
- CLI for validation, schema generation, and AGSi conversion
- Python bindings scaffold with PyO3 + maturin
- wasm wrapper for web consumption
- Example YAML document matching the spec

## CLI

```bash
cargo run -p groundmodel-cli -- validate examples/worked-orchard.yaml
cargo run -p groundmodel-cli -- schema > schema/groundmodel-0.1.0.json
```

## Deployment

GitHub Actions now includes:

- `CI`: runs Rust format/check/test plus the web build on pull requests and pushes to `main`
- `Deploy Pages`: builds `web/`, deploys to GitHub Pages from `main`, and creates a CalVer tag and GitHub Release such as `2026.05.05` or `2026.05.05.1`

The Vite app is configured for a GitHub Pages base path of `/groundmodel/`. If the repository name changes, update [web/vite.config.ts](/home/samotron/dev/groundmodel/web/vite.config.ts:1).
