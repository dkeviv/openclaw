# Copilot Instructions (OpenClaw / Mindfly)

Follow `AGENTS.md` (repo-wide guidelines). In addition, treat the following as **critical**:

- **Code quality:** prefer small, composable changes; avoid `any`; keep typing strict; follow existing patterns.
- **Refactoring (safe):** continuously look for low-risk refactors adjacent to your changes that reduce duplication/complexity **without** behavior changes. Do not do large churn refactors; track them separately.
- **Verification:** for non-trivial changes, run `pnpm lint && pnpm build && pnpm test` before concluding.
- **UX bar:** Mindfly UI must feel as polished as Claude.ai / Claude cowork (modern, minimal, fast, accessible), but with **distinct** branding.
- **Theme:** use a Mindfly theme with an accent color derived from the Mindfly **butterfly** icon (do not reuse Claude colors). If brand tokens are missing, ask for the canonical hex values or add a placeholder token and thread it through.
