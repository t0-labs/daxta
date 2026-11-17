# Changelog

## 1.2.0

- Added `daxta export` (Postman Collection v2.1 + Environment, OpenAPI JSON) and `daxta generate --postman` / `--ui`
- Upgraded CLI to interactive arrow-key `selectMenu` and `confirmPrompt` TUI across `install`, `tree`, `titles`, and `uninstall`
- Added `treeSubResourceMode` (`merge` / `root` / `nested`) and `treeResourceAliases` for cleaner sidebar & Postman folders
- Added `writeMode` (`on-complete` / `incremental`) for live docs updates during Jest runs
- Added `headerVariables` / `headerVariable` for custom Postman header variable mapping (e.g. `{{X_USER_ID}}`)
- Improved viewer UI: removed redundant `v1`/`v3` root folders in favor of version filter pills and inline `v1`/`v3` operation badges
- Added `fetch` recording and `authorization` header capture (`bearerAuth`)

## 1.0.0

- First stable public release of DAxTA (API test → API docs)
