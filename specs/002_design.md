# groundmodel — design spec (v0.1)

Supersedes nothing; expands on [001_initial.md](./001_initial.md).
License: **MIT**.

## 1. Goals

A toolkit for authoring, validating, converting and visualising **geotechnical
ground models** in a simple, human-friendly YAML format, with shared logic
across CLI, Python and a web app.

Non-goals (for now):
- No geotechnical calculations (bearing, settlement, slope, etc.).
- No factual data management (use AGS 4.x for that).
- No geometric processing (meshing, kriging, implicit modelling). We *reference*
  geometry, we don't compute it. Same approach as AGSi.

## 2. Workspace layout

Cargo workspace + a Python crate + a web app, all driven by the same Rust core:

```
groundmodel/
├── Cargo.toml                     # workspace
├── crates/
│   ├── groundmodel-core/          # schema, validation, AGSi conversion, render data
│   ├── groundmodel-cli/           # `groundmodel` binary
│   └── groundmodel-wasm/          # wasm-bindgen wrapper, consumed by web/
├── bindings/
│   └── python/                    # PyO3 + maturin → `groundmodel` on PyPI
├── web/                           # React + Vite + TS app, hosted on GitHub Pages
├── schema/                        # JSON Schema (generated from Rust types)
├── examples/                      # example YAML + AGSi files
└── specs/
```

The Rust core is the **single source of truth** for schema, validation rules,
AGSi conversion, and the data structures fed into the strip-log renderer.
Python and React are thin wrappers.

## 3. Schema (groundmodel YAML)

`schema_version: "0.1.0"`. The JSON Schema is generated from the Rust types
(via `schemars`) and published in `schema/groundmodel-0.1.0.json`.

### 3.1 Top level

```yaml
schema_version: "0.1.0"
project: { ... }
materials: [ ... ]
ground_models: [ ... ]
```

### 3.2 Project

```yaml
project:
  id: "EXAMPLE-01"
  name: "Worked Orchard Example"
  description: "..."             # optional
  vertical_datum: "mAOD"         # enum, see §3.6
  horizontal_crs: "EPSG:27700"   # optional, EPSG code
  units: "SI"                    # enum: SI (default) | imperial — affects parameter units
```

### 3.3 Materials

Materials are reusable parameter bundles, separated from where they appear in
the ground (units). Parameter sets are keyed by **drainage condition** so a
single material can carry both drained and undrained values.

```yaml
materials:
  - id: "MAT-CLAY"
    name: "London Clay"
    description: "Stiff fissured CLAY"   # optional
    color: "#A87C4F"                     # optional, hex; defaults derived from id hash
    hatch: "clay"                        # optional, see §6 (BS 5930 set)
    parameter_sets:
      undrained:
        gamma: 19         # kN/m³  (Unit Weight)
        cu: 75            # kPa    (Undrained Shear Strength)
      drained:
        gamma: 19
        phi_prime: 26     # °
        c_prime: 5        # kPa
```

**Drainage keys (v0.1, fixed):** `undrained`, `drained`, `total`, `effective`.
Anything else is rejected by validation (extensible later via a registry).

**Parameter keys (v0.1, fixed canonical set):** chosen to match AGSi codeIDs so
conversion is lossless. Each has a fixed unit (SI default).

| YAML key       | AGSi codeID                  | Unit    | Notes                          |
|----------------|------------------------------|---------|--------------------------------|
| `gamma`        | `UnitWeight`                 | kN/m³   | bulk unit weight               |
| `gamma_sat`    | `SaturatedUnitWeight`        | kN/m³   |                                |
| `gamma_dry`    | `DryUnitWeight`              | kN/m³   |                                |
| `cu`           | `UndrainedShearStrength`     | kPa     |                                |
| `phi_prime`    | `EffectiveFrictionAngle`     | °       |                                |
| `c_prime`      | `EffectiveCohesion`          | kPa     |                                |
| `phi_cv`       | `CriticalStateFrictionAngle` | °       |                                |
| `e`            | `YoungsModulus`              | MPa     | drained                        |
| `eu`           | `UndrainedYoungsModulus`     | MPa     |                                |
| `g`            | `ShearModulus`               | MPa     |                                |
| `g0`           | `SmallStrainShearModulus`    | MPa     |                                |
| `nu`           | `PoissonsRatio`              | —       |                                |
| `k`            | `Permeability`               | m/s     |                                |
| `cv`           | `CoefficientOfConsolidation` | m²/yr   |                                |
| `mv`           | `CoefficientOfVolumeCompr`   | m²/MN   |                                |
| `ocr`          | `OverconsolidationRatio`     | —       |                                |
| `k0`           | `EarthPressureCoeffAtRest`   | —       |                                |
| `vs`           | `ShearWaveVelocity`          | m/s     |                                |
| `qc`           | `ConePenetrationResistance`  | MPa     |                                |
| `n_spt`        | `SptN`                       | —       |                                |

A scalar value or `{value, min, max, char}` object is accepted (the latter for
characteristic / range-based selection). v0.1 rejects unknown keys; a future
`extra:` map will allow user-defined parameters once a registry mechanism
exists.

### 3.4 Ground models

```yaml
ground_models:
  - id: "GM-01"
    name: "Site-wide Ground Model"
    type: "design"                    # enum: observational | design | hydrogeological
    dimensionality: "1D"              # enum: 1D | 2D | 3D — see §3.7
    applicability:                    # NEW — see §3.5
      description: "Applies south of the river, away from the fault zone."
      plan_polygon_wkt: "POLYGON((535000 180000, 535500 180000, 535500 180500, 535000 180500, 535000 180000))"
      top_mAOD: 65.0                  # optional
      base_mAOD: 20.0                 # optional
    groundwater_level:
      elevation_mAOD: 58.5
    model_base:
      elevation_mAOD: 20.0
      material_ref: "MAT-CLAY"
      condition: "assumed"            # see §3.6
    units:
      - id: "UNIT-CLAY"
        name: "London Clay"
        material_ref: "MAT-CLAY"
        top_mAOD: 60.2
        base: "MODEL_BASE"            # see §3.6
        base_condition: "not_proven"
    cases:
      - id: "SLS-UND"
        name: "SLS - Undrained"
        drainage: "undrained"         # must match a key in referenced materials
```

### 3.5 Area of applicability

Mirrors AGSi `agsiModelBoundary`. Optional but strongly recommended. Allows
multiple 1D models on one site, each scoped to a polygon.

Geometry is **inline WKT** (Well-Known Text, OGC 06-103r4) so the file stays
single-file and human-readable. The horizontal CRS is taken from
`project.horizontal_crs`.

```yaml
applicability:
  description: "..."                              # free text
  plan_polygon_wkt: "POLYGON((535000 180000, 535500 180000, 535500 180500, 535000 180500, 535000 180000))"
  top_mAOD: 65.0
  base_mAOD: 20.0
```

Validation will (in a future version) check that two models with overlapping
polygons don't disagree at the overlap.

### 3.6 Enums

- `vertical_datum`: `mAOD` | `mOD` | `mASL` | `mBGL` | `local`
- `condition` (model base, unit base): `proven` | `not_proven` | `assumed` | `inferred`
- `unit.base`: either the literal `"MODEL_BASE"`, an elevation `{ mAOD: number }`, or another unit's `id` (string)

### 3.7 1D / 2D / 3D models (research outcome)

AGSi's approach is the right one: **don't invent another geometry format**.
We use **inline WKT** (OGC 06-103r4) so a ground model stays a single
self-contained YAML file. Coordinates are in `project.horizontal_crs`;
elevations are in `project.vertical_datum` (and Z values in WKT use the
same datum).

- **1D** (`dimensionality: "1D"`, default) — the original YAML structure.
  A stack of units defined by elevations. Optionally scoped by
  `applicability.plan_polygon_wkt`.
- **2D** (`dimensionality: "2D"`) — a section. The ground model carries the
  section line, and each unit carries a 2D polygon in **section-local
  coordinates** `(distance_along_section_m, elevation_in_datum)` so the
  section can be drawn directly without re-projection:
  ```yaml
  ground_models:
    - id: "GM-02"
      dimensionality: "2D"
      section_line_wkt: "LINESTRING(535000 180000, 535800 180600)"
      units:
        - id: "UNIT-CLAY"
          material_ref: "MAT-CLAY"
          geometry_wkt: "POLYGON((0 60.2, 800 58.0, 800 20.0, 0 20.0, 0 60.2))"
  ```
- **3D** (`dimensionality: "3D"`) — each unit carries either a top surface
  or a closed volume as 3D WKT:
  ```yaml
  units:
    - id: "UNIT-CLAY"
      material_ref: "MAT-CLAY"
      top_surface_wkt: "TIN Z (((535000 180000 60.2, 535500 180000 59.8, 535500 180500 60.0)), ...)"
      # OR a closed solid:
      volume_wkt: "POLYHEDRALSURFACE Z (((...)), ((...)))"
  ```
  Supported WKT geometry types: `POINT`, `LINESTRING`, `POLYGON`,
  `MULTIPOLYGON` (2D), `LINESTRING Z`, `POLYGON Z`, `TIN Z`,
  `POLYHEDRALSURFACE Z`, `MULTIPOLYGON Z` (3D). For very large meshes
  users can fall back to an external reference (`geometry_ref:` is reserved
  for v0.2) — but the v0.1 baseline is single-file inline WKT.

Validation parses every WKT string with the `wkt` crate and rejects malformed
geometry. No topological / containment checks in v0.1.

## 4. Validation rules (semantic, beyond JSON Schema)

1. All `material_ref` values resolve to a `materials[*].id`.
2. Within a ground model, unit `top_mAOD` strictly decreases down the stack,
   and is below `applicability.top_mAOD` (if set) and above `model_base.elevation_mAOD`.
3. Each unit's `base` resolves to `MODEL_BASE`, an elevation, or another unit
   id that lies below it.
4. Every `case.drainage` exists as a key in every referenced material's
   `parameter_sets`.
5. `groundwater_level.elevation_mAOD`, if present, is within the model's
   vertical extent.
6. All WKT strings (`plan_polygon_wkt`, `section_line_wkt`, `geometry_wkt`,
   `top_surface_wkt`, `volume_wkt`) parse cleanly and have a geometry type
   appropriate for their slot.
7. No two units in the same model share the same `id`.

Violations are reported with file path, YAML line/col (via `serde_yaml`'s
spans where possible), severity (`error` | `warning`), and a stable code
(`GM001`, `GM002`, …) for tooling.

## 5. AGSi conversion

Target: **AGSi v1.0.1**, JSON.

- **groundmodel → AGSi**: emit `agsSchema`, `agsFile`, `agsProject`,
  `agsiModel[]`. Each ground model becomes one `agsiModel`. Each unit becomes
  an `agsiModelElement`. Each parameter becomes an `agsiDataParameterValue`
  on the element, using the `codeID` from §3.3. `cases` become AGSi
  `caseID` references on the parameter values. `applicability` populates
  `agsiModelBoundary`.
- **AGSi → groundmodel**: best-effort inverse. Models that use complex
  geometry (3D meshes referenced by file) round-trip via `geometry_ref`.
  Models that use AGSi parameter codes outside our canonical set in §3.3
  produce a validation warning and are dropped (until the extensible
  registry lands in v0.2).

Tested against the official AGSi example files
(e.g. Silvertown tunnel) pulled into `examples/agsi/` as fixtures.

## 6. Strip log rendering

Primary deliverable is an **interactive React component**
(`<StripLog model={...} unitId="GM-01" />`) that:

- Renders a vertical bar with units stacked by `top_mAOD` / `base`.
- Colours each unit by `material.color` (defaulting to a deterministic colour
  derived from the material id hash).
- Applies a hatch pattern from `material.hatch`. v0.1 ships a small set
  loosely based on BS 5930 conventions: `clay`, `silt`, `sand`, `gravel`,
  `chalk`, `rock`, `fill`, `peat`, `made_ground`. SVG `<pattern>` definitions.
- Shows tooltips with material name and parameter table on hover.
- Lets the user toggle a `case` (drainage) to switch which parameters are
  displayed.
- Marks `groundwater_level` with a water symbol and dashed line.
- Marks unit base condition (`proven` / `not_proven` / `assumed` / `inferred`)
  with line style (solid / dashed / dotted / wavy).

The CLI exposes the same renderer headlessly via the WASM build to emit
**SVG** — no separate Rust SVG implementation. (Reuses one renderer, which
matches the "single source of truth" rule.)

## 7. CLI surface

```
groundmodel new [--out FILE]                 scaffold a starter YAML
groundmodel validate <file>...               schema + semantic checks
groundmodel fmt <file>... [--check]          canonical YAML formatting
groundmodel convert --to agsi <file> [-o]    YAML → AGSi JSON
groundmodel convert --from agsi <file> [-o]  AGSi JSON → YAML
groundmodel render strip-log <file> --gm GM-01 [--case SLS-UND] -o out.svg
groundmodel schema [--version 0.1.0]         emit JSON Schema to stdout
```

Exit codes: `0` ok, `1` validation errors, `2` usage error, `3` IO error.
`--format json` switches diagnostics to machine-readable output.

## 8. Python bindings

Minimal surface, mirrors the Rust API:

```python
import groundmodel as gm

model = gm.load("site.yml")             # returns GroundModelFile
report = gm.validate("site.yml")        # list[Diagnostic]
agsi = gm.to_agsi(model)                # dict
gm.from_agsi(agsi).save("site.yml")
svg = gm.render_strip_log(model, gm_id="GM-01", case="SLS-UND")
```

Built with **PyO3 + maturin**, published to PyPI as `groundmodel`. Wheels
built in CI for Linux / macOS / Windows × CPython 3.10–3.13.

## 9. Web app (GitHub Pages)

React + Vite + TypeScript. Loads the WASM module from
`crates/groundmodel-wasm`. Routes:

- `/` — landing + drag-and-drop a YAML/AGSi file.
- `/edit` — Monaco YAML editor with live validation against the JSON Schema
  (yaml-language-server hover/completion driven by the schema we publish).
- `/view` — interactive `<StripLog>` plus a parameter table per case.
- `/convert` — buttons to download as AGSi JSON or YAML.

Deployed via `gh-pages` workflow on push to `main`.

## 10. Repo conventions

- Rust 2024 edition, MSRV 1.82.
- `cargo fmt`, `cargo clippy -D warnings`, `cargo test` enforced in CI.
- Conventional Commits.
- All public Rust types derive `serde::{Serialize,Deserialize}`,
  `schemars::JsonSchema`, and have doc comments.
- The JSON Schema is regenerated and committed; CI fails if drifted.

## 11. Milestones

1. **M1 — Core + CLI v0.1**: schema (1D), validation, `new`/`validate`/`fmt`,
   JSON Schema generation, golden tests.
2. **M2 — AGSi round-trip**: `convert --to/--from agsi`, tested against
   official example files.
3. **M3 — Strip log**: WASM renderer + React component + CLI SVG export.
4. **M4 — Python bindings + PyPI release**.
5. **M5 — Web app on GitHub Pages**.
6. **M6 — 2D/3D dimensionality + applicability polygons**.

## 12. Locked-in decisions

- **Single file**: geometry is inline **WKT** (OGC 06-103r4); no external
  geometry references in v0.1. A ground model is one self-contained YAML.
- **Repo / crate name**: `groundmodel`.
- **AGSi `caseID`**: synthesised from our `case.id` at conversion time
  (option a). Parameters stay on materials in the YAML.
- **YAML library**: `serde_yml` (maintained `serde_yaml` fork). Comments
  are dropped on `fmt` — accepted trade-off.
- **Strip-log hatching**: house-styled set, BS 5930-inspired but not
  pixel-identical (avoids IP issues, ships in v0.1).
- **Web app**: zero telemetry, pure static GitHub Pages deployment.
- **MCP server**: not in scope.

Implementation starts at **M1**.
