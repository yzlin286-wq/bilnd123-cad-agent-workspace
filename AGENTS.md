# AGENTS.md

## Project Instructions

- Do not use fallback strategies for real agent work.
- In particular, do not replace a failed real agent/CAD execution with direct local code generation.
- The only acceptable fallback is downgrading to another configured real large model, and that fallback must still execute against the real model endpoint.
