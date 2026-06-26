# CAD Agent Workspace

First runnable version of an AI CAD Agent Workspace. The app is a dense engineering UI rather than a landing page: project/revision navigation, ChatGPT-like agent thread, workstream timeline, CAD canvas, drawing preview, parameters, artifacts, validation report, and build123d source view.

## Stack

- Next.js 16 and React 19
- React Three Fiber and Three.js for the CAD preview canvas
- React Flow for the agent workflow view
- Monaco Editor for the build123d source panel
- Lucide icons and custom CSS for the product shell

## No Fallback Policy

This project must not synthesize fake agent or CAD results when real infrastructure is missing.

- `/api/agent/workstream` requires a real OpenAI-compatible model endpoint.
- The only allowed model fallback is a configured downgrade to another real model.
- `/api/cad/runs` requires `CAD_RUNNER_COMMAND`.
- Missing LLM or CAD runtime returns explicit `503` errors.

## Environment

Copy `.env.example` to `.env.local` and set real values:

```bash
CAD_AGENT_BASE_URL=https://api.example.com/v1
CAD_AGENT_API_KEY=replace-with-real-key
CAD_AGENT_PRIMARY_MODEL=primary-real-model
CAD_AGENT_DOWNGRADE_MODEL=secondary-real-model
CAD_RUNNER_COMMAND=python scripts/run_build123d.py
```

The CAD runner receives JSON on stdin. It should execute the real build123d pipeline and write a structured result to stdout. It should fail with a non-zero exit code when CAD generation fails.

## Commands

```bash
npm install
npm run dev
npm run lint
npm run typecheck
npm run build
```

Local development URL:

```text
http://127.0.0.1:3000
```

## Current Scope

Implemented:

- CAD Agent Workspace product shell
- Project, revision, artifact, and validation UI
- Interactive prompt composer
- Three.js mounting plate preview
- SVG drawing preview
- Parameter, measurement, workflow, and source panels
- Runtime readiness API
- Real LLM workstream API boundary
- Real CAD runner API boundary

Not yet wired:

- Auth and persistence
- Real artifact storage
- Production build123d runner implementation
- Streaming SSE event transport
- Version diff and approval persistence
