## Overview

Geographic web collaboration analysis tool.

## Stack

All dockerized under docker compose

### Frontend

- Bun
- Typescript
- React
- Terra draw
- Biome.js - no eslint, prettier or anything like that
- Mantine
- Split pane Mantine extension (https://gfazioli.github.io/mantine-split-pane/)
- Docker
- Use minimal css, always leverage Mantine
- Deck.gl
- zustand
- recharts or Apache charts I'm not sure yet
- vite

### Backend

- Golang
- Postgres
- Docker
- framework for orm

# Instructions

- Always use `caveman` skill for talk, use ultra level
- Prefer caveman-family skills when task matches: `caveman-commit` for commits or commit messages, `caveman-review` for normal code review, `caveman-compress` for skill or memory summaries
- Use heavier review skills only when user asks for deep, security, performance, or framework-specific review
- Use global skill definitions as source of truth for when skills apply; do not treat this file as skill index
- Use only minimal relevant skill set. Do not load broad skills just in case
- After reading any skill, retain only a `caveman-compress` ultra-style summary for current turn; avoid re-reading full skill body unless task needs exact detail
- Use `hadolint` for Dockerfile linting
- When you do something, don't spam with some new readme, additional documentation or anything like that until I ask for it
- Use https://mantine.dev/llms.txt Mantine documentation to figure out how to use Mantine, though you can also use context7
