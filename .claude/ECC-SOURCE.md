# Source of the agents and skills in this folder

- Repository: https://github.com/affaan-m/ECC (MIT license, copy in ECC-LICENSE)
- Version: 2.2.3, commit 90606c8315ee09cafc303515c5f33024db6b9882
- Installed: 2026-10-22, by copying files only.

Installed: all 71 files from agents/ and 51 skills from skills/ (the list is in docs/TEAM.md).
NOT installed on purpose: hooks/ (they run shell commands on tool events), install.sh and the npm installer, scripts/,
commands/ and legacy-command-shims/, rules/, mcp-configs/ and any skill that ships scripts or hooks
(docs-governance, operator-approval-loop, delivery-gate, frontend-design-direction).

PBOS product rules always win over anything written in these files (see docs/TEAM.md).
To update: re-copy from a newer commit after reading the diff; do not run the upstream installer here.
