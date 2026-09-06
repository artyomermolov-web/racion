# Racion

Automatic meal planner (уровня Eat This Much): генерация рационов под целевые КБЖУ с учётом предпочтений, ограничений и бюджета.

## Фундамент расчётов

`docs/kbju-master.md` — единый опорный документ по всем расчётам КБЖУ и правилам рациона (коэффициенты энергии, формулы BMR/TDEE/цели/макросов, нормы ВОЗ, ограничения для генератора, источники). Все числовые значения в `/core/nutrition` (и позже в `/core/generator`, `/core/shopping`) берутся оттуда; при конфликте с более ранними research-заметками мастер-документ первичен.

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
