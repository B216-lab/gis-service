# Running Multiple Worktrees

Use the worktree helper from inside each worktree:

```sh
bun run dev:up
```

or:

```sh
./scripts/dev-worktree up
```

On first run, the helper creates `.env.dev` with:

- a stable Docker Compose project name derived from the worktree path
- free host ports for PostGIS, the backend API, and the frontend
- a per-worktree database id/name

Then it starts only that worktree's Compose stack.

Useful commands:

```sh
bun run dev:setup    # create .env.dev and print assigned URLs
bun run dev:up       # setup if needed, build, and start
bun run dev:status   # show containers
bun run dev:logs     # follow logs
bun run dev:down     # stop this worktree's stack
bun run dev:restart  # recreate this worktree's stack
bun run dev:env      # print generated settings
```

To create another worktree and start it without manual env edits:

```sh
git worktree add ../worktrees/gis-service-feature -b feature/my-change
cd ../worktrees/gis-service-feature
bun run dev:up
```

Each worktree gets separate containers, volumes, and host ports because the
helper runs Docker Compose with that worktree's generated `.env.dev`.
