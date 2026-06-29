# UI Product Spec

## Product Structure

- `/`: public product landing with sign-in CTA. It must not expose anonymous CAD generation.
- `/sign-in`: Clerk sign-in page when Clerk is configured.
- `/sign-up`: Clerk sign-up page when Clerk is configured.
- `/app`: SaaS dashboard.
- `/app/projects`: recent projects list sorted by update time.
- `/app/workspace`: CAD project workspace.
- `/admin`: admin-only internal operations dashboard.

## Dashboard

The `/app` dashboard includes:

- New CAD CTA
- Template cards for Mounting Plate and L Bracket
- Upload Sketch card marked Coming Soon
- Recent Projects
- Recent Artifacts
- Usage Summary
- Alpha health badge

## Workspace

The workspace keeps the existing three-column shape:

- Left rail: New CAD, revision timeline, recent projects
- Middle: agent thread
- Right: CAD canvas

Canvas expectations:

- Preview tab shows validation summary.
- Drawing tab includes a download drawing CTA.
- Parameters tab behaves as a properties panel.
- Files tab makes package.zip the primary download and keeps individual STEP/STL/SVG/source downloads.
- Error cards must be specific for unsupported templates, parameter conflicts, rate limits, and internal CAD/LLM failures.

## Template Limits

The supported template catalog is driven by `cad_templates.json` and currently contains 20 deterministic build123d templates. UI copy must not imply sketch upload or public arbitrary CAD is available.
