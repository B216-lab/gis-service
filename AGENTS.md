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
- recharts
- vite

### Backend

- Golang
- Postgres
- Docker
- framework for orm

## Instructions

- Always use `caveman` skill for talk
- Always use `caveman-commit` for commit messages
- Always use `caveman-review` for review
- Use https://mantine.dev/llms.txt Mantine documentation to figure out how to use Mantine, though you can also use context7
- Always use `coding-standarts` skill to write any code
- Always use `docker-patterns` skill to write dockerfiles or docker compose files
- Always use `frontend-patterns`, `vercel-react-best-practices`, `web-design-guidelines`, `frontend-design` skills to write frontend code
- Always use `api-design` skill to reason about API before writing it
- Use `hadolint` for Dockerfile linting
- Use golang related skills always to write decent, maintainable golang code
- When you do something, don't spam with some new readme, additional documentation or anything like that until I ask for it
