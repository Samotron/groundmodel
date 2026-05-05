import React, { useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { parse, stringify } from "yaml";
import "./styles.css";

type Severity = "error" | "warning";

type Diagnostic = {
  code: string;
  severity: Severity;
  path: string;
  message: string;
};

type SourceFormat = "groundmodel-yaml" | "agsi-json";

type BaseRef = "MODEL_BASE" | string | { mAOD: number };

type GroundModelDocument = {
  schema_version: string;
  project: {
    id: string;
    name: string;
    description?: string;
    vertical_datum: string;
    horizontal_crs?: string;
    units?: string;
  };
  materials?: Material[];
  ground_models?: GroundModel[];
};

type Material = {
  id: string;
  name: string;
  description?: string;
  color?: string;
  hatch?: string;
  parameter_sets?: Record<string, Record<string, number | ParameterRange>>;
};

type ParameterRange = {
  value?: number;
  min?: number;
  max?: number;
  char?: number;
};

type GroundModel = {
  id: string;
  name: string;
  type?: string;
  dimensionality?: string;
  applicability?: {
    description?: string;
    plan_polygon_wkt?: string;
    top_mAOD?: number;
    base_mAOD?: number;
  };
  groundwater_level?: {
    elevation_mAOD: number;
  };
  model_base: {
    elevation_mAOD: number;
    material_ref: string;
    condition: string;
  };
  units?: Array<{
    id: string;
    name?: string;
    material_ref: string;
    top_mAOD?: number;
    base: BaseRef;
    base_condition?: string;
    geometry_wkt?: string;
    top_surface_wkt?: string;
    volume_wkt?: string;
  }>;
  cases?: Array<{
    id: string;
    name: string;
    drainage: string;
  }>;
  section_line_wkt?: string;
};

type AgsiRoot = {
  agsSchema?: {
    name?: string;
    version?: string;
  };
  agsFile?: {
    name?: string;
    format?: string;
  };
  agsProject: {
    projectID: string;
    projectName: string;
    description?: string;
    verticalDatum?: string;
    horizontalCRS?: string;
  };
  agsiModel?: AgsiModel[];
};

type AgsiModel = {
  modelID: string;
  modelName: string;
  modelType?: string;
  dimensionality?: string;
  agsiModelBoundary?: {
    description?: string;
    planPolygonWKT?: string;
    top_mAOD?: number;
    base_mAOD?: number;
  };
  groundwaterLevel?: number;
  modelBase?: {
    elevation_mAOD?: number;
    materialRef?: string;
    condition?: string;
  };
  elements?: AgsiElement[];
};

type AgsiElement = {
  elementID: string;
  name?: string;
  materialRef: string;
  top_mAOD?: number;
  base?: BaseRef;
  baseCondition?: string;
  geometryWKT?: string;
  topSurfaceWKT?: string;
  volumeWKT?: string;
  agsiDataParameterValue?: AgsiParameter[];
};

type AgsiParameter = {
  codeID: string;
  caseID: string;
  drainage: string;
  value: number | ParameterRange;
};

const SAMPLE_YAML = `schema_version: "0.1.0"
project:
  id: "EXAMPLE-01"
  name: "Worked Orchard Example"
  vertical_datum: "mAOD"
  horizontal_crs: "EPSG:27700"
materials:
  - id: "MAT-CLAY"
    name: "London Clay"
    color: "#A87C4F"
    hatch: "clay"
    parameter_sets:
      undrained:
        gamma: 19
        cu: 75
      drained:
        gamma: 19
        phi_prime: 26
        c_prime: 5
ground_models:
  - id: "GM-01"
    name: "Site-wide Ground Model"
    type: "design"
    dimensionality: "1D"
    applicability:
      description: "Applies south of the river."
      plan_polygon_wkt: "POLYGON((535000 180000, 535500 180000, 535500 180500, 535000 180500, 535000 180000))"
      top_mAOD: 65.0
      base_mAOD: 20.0
    groundwater_level:
      elevation_mAOD: 58.5
    model_base:
      elevation_mAOD: 20.0
      material_ref: "MAT-CLAY"
      condition: "assumed"
    units:
      - id: "UNIT-CLAY"
        name: "London Clay"
        material_ref: "MAT-CLAY"
        top_mAOD: 60.2
        base: "MODEL_BASE"
        base_condition: "not_proven"
    cases:
      - id: "SLS-UND"
        name: "SLS - Undrained"
        drainage: "undrained"
`;

const CODE_MAP: Record<string, string> = {
  gamma: "UnitWeight",
  gamma_sat: "SaturatedUnitWeight",
  gamma_dry: "DryUnitWeight",
  cu: "UndrainedShearStrength",
  phi_prime: "EffectiveFrictionAngle",
  c_prime: "EffectiveCohesion",
  phi_cv: "CriticalStateFrictionAngle",
  e: "YoungsModulus",
  eu: "UndrainedYoungsModulus",
  g: "ShearModulus",
  g0: "SmallStrainShearModulus",
  nu: "PoissonsRatio",
  k: "Permeability",
  cv: "CoefficientOfConsolidation",
  mv: "CoefficientOfVolumeCompr",
  ocr: "OverconsolidationRatio",
  k0: "EarthPressureCoeffAtRest",
  vs: "ShearWaveVelocity",
  qc: "ConePenetrationResistance",
  n_spt: "SptN"
};

const REVERSE_CODE_MAP = Object.fromEntries(
  Object.entries(CODE_MAP).map(([key, value]) => [value, key])
);

const ALLOWED_DRAINAGE_KEYS = ["undrained", "drained", "total", "effective"];
const ALLOWED_PARAMETER_KEYS = Object.keys(CODE_MAP);

function appError(message: string): Diagnostic[] {
  return [{ code: "GMAPP", severity: "error", path: "$", message }];
}

function parseGroundModelText(input: string) {
  try {
    const document = parse(input) as GroundModelDocument;
    return {
      document,
      diagnostics: validateDocument(document)
    };
  } catch (error) {
    return {
      document: null,
      diagnostics: appError(
        error instanceof Error ? `YAML parse error: ${error.message}` : "YAML parse error"
      )
    };
  }
}

function parseAgsiText(input: string) {
  try {
    const agsi = JSON.parse(input) as AgsiRoot;
    const document = agsiToGroundModel(agsi);
    return {
      document,
      agsi,
      diagnostics: validateDocument(document)
    };
  } catch (error) {
    return {
      document: null,
      agsi: null,
      diagnostics: appError(
        error instanceof Error ? `AGSi parse error: ${error.message}` : "AGSi parse error"
      )
    };
  }
}

function validateDocument(doc: GroundModelDocument | null | undefined): Diagnostic[] {
  if (!doc || typeof doc !== "object") {
    return appError("Document must be an object.");
  }

  const diagnostics: Diagnostic[] = [];
  if (doc.schema_version !== "0.1.0") {
    diagnostics.push({
      code: "GM000",
      severity: "error",
      path: "schema_version",
      message: `unsupported schema_version \`${String(doc.schema_version)}\`; expected \`0.1.0\``
    });
  }

  const materials = Array.isArray(doc.materials) ? doc.materials : [];
  const materialIds = new Set(materials.map((material) => material.id));

  materials.forEach((material, materialIndex) => {
    Object.entries(material.parameter_sets ?? {}).forEach(([drainage, params]) => {
      if (!ALLOWED_DRAINAGE_KEYS.includes(drainage)) {
        diagnostics.push({
          code: "GM008",
          severity: "error",
          path: `materials[${materialIndex}].parameter_sets.${drainage}`,
          message: `unsupported drainage key \`${drainage}\``
        });
      }

      Object.keys(params ?? {}).forEach((key) => {
        if (!ALLOWED_PARAMETER_KEYS.includes(key)) {
          diagnostics.push({
            code: "GM009",
            severity: "error",
            path: `materials[${materialIndex}].parameter_sets.${drainage}.${key}`,
            message: `material \`${material.id}\` uses unsupported parameter key \`${key}\``
          });
        }
      });
    });
  });

  const groundModels = Array.isArray(doc.ground_models) ? doc.ground_models : [];
  groundModels.forEach((model, modelIndex) => {
    if (!materialIds.has(model.model_base?.material_ref)) {
      diagnostics.push({
        code: "GM001",
        severity: "error",
        path: `ground_models[${modelIndex}].model_base.material_ref`,
        message: `unknown material_ref \`${model.model_base?.material_ref ?? ""}\``
      });
    }

    const applicability = model.applicability;
    if (applicability?.plan_polygon_wkt && !looksLikeWkt(applicability.plan_polygon_wkt, "POLYGON")) {
      diagnostics.push({
        code: "GM006",
        severity: "error",
        path: `ground_models[${modelIndex}].applicability.plan_polygon_wkt`,
        message: "geometry must be a `POLYGON` WKT"
      });
    }

    if (model.section_line_wkt && !looksLikeWkt(model.section_line_wkt, "LINESTRING")) {
      diagnostics.push({
        code: "GM006",
        severity: "error",
        path: `ground_models[${modelIndex}].section_line_wkt`,
        message: "geometry must be a `LINESTRING` WKT"
      });
    }

    const units = Array.isArray(model.units) ? model.units : [];
    const unitIds = new Set(units.map((unit) => unit.id));
    if (unitIds.size !== units.length) {
      diagnostics.push({
        code: "GM007",
        severity: "error",
        path: `ground_models[${modelIndex}].units`,
        message: `ground model \`${model.id}\` contains duplicate unit ids`
      });
    }

    let previousTop: number | null = null;
    units.forEach((unit, unitIndex) => {
      const unitPath = `ground_models[${modelIndex}].units[${unitIndex}]`;
      if (!materialIds.has(unit.material_ref)) {
        diagnostics.push({
          code: "GM001",
          severity: "error",
          path: `${unitPath}.material_ref`,
          message: `unknown material_ref \`${unit.material_ref}\``
        });
      }

      if ((model.dimensionality ?? "1D") === "1D") {
        if (typeof unit.top_mAOD !== "number") {
          diagnostics.push({
            code: "GM002",
            severity: "error",
            path: `${unitPath}.top_mAOD`,
            message: "1D units must define top_mAOD"
          });
        } else {
          if (previousTop !== null && unit.top_mAOD >= previousTop) {
            diagnostics.push({
              code: "GM002",
              severity: "error",
              path: `${unitPath}.top_mAOD`,
              message: "unit top_mAOD must strictly decrease down the stack"
            });
          }
          if (
            typeof applicability?.top_mAOD === "number" &&
            unit.top_mAOD > applicability.top_mAOD
          ) {
            diagnostics.push({
              code: "GM002",
              severity: "error",
              path: `${unitPath}.top_mAOD`,
              message: "unit top_mAOD is above applicability.top_mAOD"
            });
          }
          if (unit.top_mAOD <= model.model_base.elevation_mAOD) {
            diagnostics.push({
              code: "GM002",
              severity: "error",
              path: `${unitPath}.top_mAOD`,
              message: "unit top_mAOD must be above model_base.elevation_mAOD"
            });
          }
          previousTop = unit.top_mAOD;
        }
      }

      if (
        typeof unit.base === "object" &&
        unit.base !== null &&
        "mAOD" in unit.base &&
        typeof unit.base.mAOD === "number"
      ) {
        if (typeof unit.top_mAOD === "number" && unit.base.mAOD >= unit.top_mAOD) {
          diagnostics.push({
            code: "GM003",
            severity: "error",
            path: `${unitPath}.base`,
            message: "unit base elevation must lie below top_mAOD"
          });
        }
        if (unit.base.mAOD < model.model_base.elevation_mAOD) {
          diagnostics.push({
            code: "GM003",
            severity: "error",
            path: `${unitPath}.base`,
            message: "unit base elevation must not be below model_base.elevation_mAOD"
          });
        }
      }

      if (typeof unit.base === "string" && unit.base !== "MODEL_BASE" && !unitIds.has(unit.base)) {
        diagnostics.push({
          code: "GM003",
          severity: "error",
          path: `${unitPath}.base`,
          message: `unknown unit base reference \`${unit.base}\``
        });
      }

      if (unit.geometry_wkt && !looksLikeWkt(unit.geometry_wkt, "POLYGON")) {
        diagnostics.push({
          code: "GM006",
          severity: "error",
          path: `${unitPath}.geometry_wkt`,
          message: "geometry must be a `POLYGON` WKT"
        });
      }
      if (unit.top_surface_wkt && !looksLikeWkt(unit.top_surface_wkt, "TIN")) {
        diagnostics.push({
          code: "GM006",
          severity: "error",
          path: `${unitPath}.top_surface_wkt`,
          message: "geometry must be a `TIN` WKT"
        });
      }
      if (unit.volume_wkt && !looksLikeWkt(unit.volume_wkt, "POLYHEDRALSURFACE")) {
        diagnostics.push({
          code: "GM006",
          severity: "error",
          path: `${unitPath}.volume_wkt`,
          message: "geometry must be a `POLYHEDRALSURFACE` WKT"
        });
      }
    });

    const cases = Array.isArray(model.cases) ? model.cases : [];
    cases.forEach((caseDefinition, caseIndex) => {
      units.forEach((unit) => {
        const material = materials.find((entry) => entry.id === unit.material_ref);
        if (material && !material.parameter_sets?.[caseDefinition.drainage]) {
          diagnostics.push({
            code: "GM004",
            severity: "error",
            path: `ground_models[${modelIndex}].cases[${caseIndex}].drainage`,
            message: `case drainage \`${caseDefinition.drainage}\` is missing from material \`${material.id}\``
          });
        }
      });
    });

    if (typeof model.groundwater_level?.elevation_mAOD === "number") {
      const modelTop = units.reduce((current, unit) => {
        return typeof unit.top_mAOD === "number" ? Math.max(current, unit.top_mAOD) : current;
      }, applicability?.top_mAOD ?? Number.NEGATIVE_INFINITY);
      const modelBottom = applicability?.base_mAOD ?? model.model_base.elevation_mAOD;
      if (
        model.groundwater_level.elevation_mAOD < modelBottom ||
        model.groundwater_level.elevation_mAOD > modelTop
      ) {
        diagnostics.push({
          code: "GM005",
          severity: "error",
          path: `ground_models[${modelIndex}].groundwater_level.elevation_mAOD`,
          message: "groundwater level must be within the model vertical extent"
        });
      }
    }
  });

  return diagnostics;
}

function looksLikeWkt(value: string, prefix: string) {
  return value.trim().toUpperCase().startsWith(prefix);
}

function parameterToJson(value: number | ParameterRange) {
  return value;
}

function groundModelToAgsi(document: GroundModelDocument): AgsiRoot {
  const materialsById = new Map((document.materials ?? []).map((material) => [material.id, material]));

  return {
    agsSchema: { name: "AGSi", version: "1.0.1" },
    agsFile: { name: document.project.name, format: "groundmodel" },
    agsProject: {
      projectID: document.project.id,
      projectName: document.project.name,
      description: document.project.description,
      verticalDatum: document.project.vertical_datum,
      horizontalCRS: document.project.horizontal_crs
    },
    agsiModel: (document.ground_models ?? []).map((model) => ({
      modelID: model.id,
      modelName: model.name,
      modelType: model.type ?? "design",
      dimensionality: model.dimensionality ?? "1D",
      agsiModelBoundary: model.applicability
        ? {
            description: model.applicability.description,
            planPolygonWKT: model.applicability.plan_polygon_wkt,
            top_mAOD: model.applicability.top_mAOD,
            base_mAOD: model.applicability.base_mAOD
          }
        : undefined,
      groundwaterLevel: model.groundwater_level?.elevation_mAOD,
      modelBase: {
        elevation_mAOD: model.model_base.elevation_mAOD,
        materialRef: model.model_base.material_ref,
        condition: model.model_base.condition
      },
      elements: (model.units ?? []).map((unit) => {
        const material = materialsById.get(unit.material_ref);
        const parameters =
          material && model.cases
            ? model.cases.flatMap((caseDefinition) => {
                const parameterSet = material.parameter_sets?.[caseDefinition.drainage] ?? {};
                return Object.entries(parameterSet)
                  .filter(([key]) => Boolean(CODE_MAP[key]))
                  .map(([key, value]) => ({
                    codeID: CODE_MAP[key],
                    caseID: caseDefinition.id,
                    drainage: caseDefinition.drainage,
                    value: parameterToJson(value)
                  }));
              })
            : [];

        return {
          elementID: unit.id,
          name: unit.name,
          materialRef: unit.material_ref,
          top_mAOD: unit.top_mAOD,
          base: unit.base,
          baseCondition: unit.base_condition,
          geometryWKT: unit.geometry_wkt,
          topSurfaceWKT: unit.top_surface_wkt,
          volumeWKT: unit.volume_wkt,
          agsiDataParameterValue: parameters
        };
      })
    }))
  };
}

function agsiToGroundModel(agsi: AgsiRoot): GroundModelDocument {
  const materials = new Map<string, Material>();

  const groundModels = (agsi.agsiModel ?? []).map((model) => {
    const cases = new Map<string, string>();
    const units = (model.elements ?? []).map((element) => {
      const material = materials.get(element.materialRef) ?? {
        id: element.materialRef,
        name: element.materialRef,
        parameter_sets: {}
      };

      for (const parameter of element.agsiDataParameterValue ?? []) {
        const key = REVERSE_CODE_MAP[parameter.codeID];
        if (!key) continue;

        const drainage = parameter.drainage || "undrained";
        material.parameter_sets ??= {};
        material.parameter_sets[drainage] ??= {};
        material.parameter_sets[drainage][key] = parameter.value;
        materials.set(material.id, material);
        cases.set(parameter.caseID, drainage);
      }

      if (!materials.has(material.id)) {
        materials.set(material.id, material);
      }

      return {
        id: element.elementID,
        name: element.name,
        material_ref: element.materialRef,
        top_mAOD: element.top_mAOD,
        base: element.base ?? "MODEL_BASE",
        base_condition: element.baseCondition,
        geometry_wkt: element.geometryWKT,
        top_surface_wkt: element.topSurfaceWKT,
        volume_wkt: element.volumeWKT
      };
    });

    return {
      id: model.modelID,
      name: model.modelName,
      type: model.modelType ?? "design",
      dimensionality: model.dimensionality ?? "1D",
      applicability: model.agsiModelBoundary
        ? {
            description: model.agsiModelBoundary.description,
            plan_polygon_wkt: model.agsiModelBoundary.planPolygonWKT,
            top_mAOD: model.agsiModelBoundary.top_mAOD,
            base_mAOD: model.agsiModelBoundary.base_mAOD
          }
        : undefined,
      groundwater_level:
        typeof model.groundwaterLevel === "number"
          ? { elevation_mAOD: model.groundwaterLevel }
          : undefined,
      model_base: {
        elevation_mAOD: model.modelBase?.elevation_mAOD ?? 0,
        material_ref: model.modelBase?.materialRef ?? units[0]?.material_ref ?? "UNKNOWN",
        condition: model.modelBase?.condition ?? "assumed"
      },
      units,
      cases: Array.from(cases.entries()).map(([id, drainage]) => ({
        id,
        name: id,
        drainage
      })),
      section_line_wkt: undefined
    };
  });

  return {
    schema_version: "0.1.0",
    project: {
      id: agsi.agsProject?.projectID ?? "UNKNOWN",
      name: agsi.agsProject?.projectName ?? "Untitled AGSi import",
      description: agsi.agsProject?.description,
      vertical_datum: agsi.agsProject?.verticalDatum ?? "mAOD",
      horizontal_crs: agsi.agsProject?.horizontalCRS,
      units: "SI"
    },
    materials: Array.from(materials.values()),
    ground_models: groundModels
  };
}

function formatGroundModel(document: GroundModelDocument) {
  return stringify(document, {
    indent: 2,
    lineWidth: 0
  });
}

function saveFile(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function metricLabel(label: string, value: React.ReactNode) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sourceFormat, setSourceFormat] = useState<SourceFormat>("groundmodel-yaml");
  const [sourceText, setSourceText] = useState(SAMPLE_YAML);

  const state = useMemo(() => {
    if (sourceFormat === "groundmodel-yaml") {
      const parsed = parseGroundModelText(sourceText);
      const converted = parsed.document ? JSON.stringify(groundModelToAgsi(parsed.document), null, 2) : "";
      return {
        document: parsed.document,
        diagnostics: parsed.diagnostics,
        conversionTitle: "AGSi JSON",
        convertedText: converted
      };
    }

    const parsed = parseAgsiText(sourceText);
    const converted = parsed.document ? formatGroundModel(parsed.document) : "";
    return {
      document: parsed.document,
      diagnostics: parsed.diagnostics,
      conversionTitle: "Groundmodel YAML",
      convertedText: converted
    };
  }, [sourceFormat, sourceText]);

  function replaceWithGroundModelSample() {
    setSourceFormat("groundmodel-yaml");
    setSourceText(SAMPLE_YAML);
  }

  function replaceWithAgsiSample() {
    const sample = JSON.stringify(
      groundModelToAgsi(parseGroundModelText(SAMPLE_YAML).document as GroundModelDocument),
      null,
      2
    );
    setSourceFormat("agsi-json");
    setSourceText(sample);
  }

  function formatSource() {
    if (sourceFormat === "groundmodel-yaml") {
      const parsed = parseGroundModelText(sourceText);
      if (parsed.document) {
        setSourceText(formatGroundModel(parsed.document));
      }
      return;
    }

    try {
      setSourceText(JSON.stringify(JSON.parse(sourceText), null, 2));
    } catch {
      return;
    }
  }

  function convertInPlace() {
    if (!state.convertedText) return;
    setSourceFormat(sourceFormat === "groundmodel-yaml" ? "agsi-json" : "groundmodel-yaml");
    setSourceText(state.convertedText);
  }

  async function importFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setSourceFormat(file.name.endsWith(".json") ? "agsi-json" : "groundmodel-yaml");
    setSourceText(text);
    event.target.value = "";
  }

  const materials = state.document?.materials ?? [];
  const models = state.document?.ground_models ?? [];
  const unitCount = models.reduce((count, model) => count + (model.units?.length ?? 0), 0);

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">groundmodel workbench</p>
          <h1>Viewer, editor, and converter for ground model experience files.</h1>
          <p className="lede">
            Edit source directly, inspect the document as structured geology metadata, validate it
            live, and convert between native YAML and AGSi JSON without leaving the browser.
          </p>
        </div>
        <div className="hero-metrics">
          {metricLabel("Format", sourceFormat === "groundmodel-yaml" ? "Groundmodel YAML" : "AGSi JSON")}
          {metricLabel("Diagnostics", state.diagnostics.length)}
          {metricLabel("Materials", materials.length)}
          {metricLabel("Units", unitCount)}
        </div>
      </section>

      <section className="toolbar">
        <div className="chip-group">
          <button
            className={sourceFormat === "groundmodel-yaml" ? "chip active" : "chip"}
            onClick={() => setSourceFormat("groundmodel-yaml")}
            type="button"
          >
            Groundmodel YAML
          </button>
          <button
            className={sourceFormat === "agsi-json" ? "chip active" : "chip"}
            onClick={() => setSourceFormat("agsi-json")}
            type="button"
          >
            AGSi JSON
          </button>
        </div>
        <div className="action-group">
          <button className="action" onClick={replaceWithGroundModelSample} type="button">
            Sample YAML
          </button>
          <button className="action" onClick={replaceWithAgsiSample} type="button">
            Sample AGSi
          </button>
          <button className="action" onClick={() => fileInputRef.current?.click()} type="button">
            Import
          </button>
          <button className="action" onClick={formatSource} type="button">
            Format
          </button>
          <button className="action accent" onClick={convertInPlace} type="button">
            Convert In Place
          </button>
          <button
            className="action"
            onClick={() =>
              saveFile(
                sourceFormat === "groundmodel-yaml" ? "groundmodel.yaml" : "agsi.json",
                sourceText,
                sourceFormat === "groundmodel-yaml" ? "text/yaml" : "application/json"
              )
            }
            type="button"
          >
            Export Source
          </button>
          <input
            accept=".yaml,.yml,.json"
            className="hidden-input"
            onChange={importFile}
            ref={fileInputRef}
            type="file"
          />
        </div>
      </section>

      <section className="workspace">
        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Editor</p>
              <h2>{sourceFormat === "groundmodel-yaml" ? "Groundmodel source" : "AGSi source"}</h2>
            </div>
            <span className="panel-badge">{sourceText.split("\n").length} lines</span>
          </div>
          <textarea
            className="editor"
            onChange={(event) => setSourceText(event.target.value)}
            spellCheck={false}
            value={sourceText}
          />
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Converter</p>
              <h2>{state.conversionTitle}</h2>
            </div>
            <button
              className="link-button"
              onClick={() =>
                saveFile(
                  sourceFormat === "groundmodel-yaml" ? "agsi.json" : "groundmodel.yaml",
                  state.convertedText,
                  sourceFormat === "groundmodel-yaml" ? "application/json" : "text/yaml"
                )
              }
              type="button"
            >
              Export Conversion
            </button>
          </div>
          <textarea className="editor output" readOnly spellCheck={false} value={state.convertedText} />
        </article>
      </section>

      <section className="inspector-grid">
        <article className="panel diagnostics-panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Validation</p>
              <h2>Diagnostics</h2>
            </div>
            <span className="panel-badge">{state.diagnostics.length}</span>
          </div>
          <div className="diagnostic-list">
            {state.diagnostics.length === 0 ? (
              <div className="empty-state">No validation errors. The document is structurally usable.</div>
            ) : (
              state.diagnostics.map((diagnostic, index) => (
                <div className={`diagnostic ${diagnostic.severity}`} key={`${diagnostic.code}-${index}`}>
                  <div className="diagnostic-topline">
                    <strong>{diagnostic.code}</strong>
                    <span>{diagnostic.path}</span>
                  </div>
                  <p>{diagnostic.message}</p>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="panel viewer-panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Viewer</p>
              <h2>Structured document</h2>
            </div>
            <span className="panel-badge">{models.length} models</span>
          </div>
          {!state.document ? (
            <div className="empty-state">Fix the source parse error to inspect the document.</div>
          ) : (
            <div className="viewer-stack">
              <section className="viewer-card">
                <h3>{state.document.project.name}</h3>
                <p>
                  {state.document.project.id} · {state.document.project.vertical_datum}
                  {state.document.project.horizontal_crs ? ` · ${state.document.project.horizontal_crs}` : ""}
                </p>
                {state.document.project.description ? <p>{state.document.project.description}</p> : null}
              </section>

              <section className="viewer-card">
                <div className="card-header">
                  <h3>Materials</h3>
                  <span>{materials.length}</span>
                </div>
                <div className="material-list">
                  {materials.map((material) => (
                    <div className="material-row" key={material.id}>
                      <div className="material-swatch" style={{ background: material.color ?? "#4e5d6c" }} />
                      <div>
                        <strong>{material.name}</strong>
                        <p>{material.id}</p>
                      </div>
                      <span>{Object.keys(material.parameter_sets ?? {}).length} drainage sets</span>
                    </div>
                  ))}
                </div>
              </section>

              {models.map((model) => (
                <section className="viewer-card" key={model.id}>
                  <div className="card-header">
                    <div>
                      <h3>{model.name}</h3>
                      <p>
                        {model.id} · {model.type ?? "design"} · {model.dimensionality ?? "1D"}
                      </p>
                    </div>
                    <span>{model.units?.length ?? 0} units</span>
                  </div>
                  <div className="detail-grid">
                    <div>
                      <strong>Model base</strong>
                      <p>
                        {model.model_base.material_ref} at {model.model_base.elevation_mAOD} mAOD
                      </p>
                    </div>
                    <div>
                      <strong>Groundwater</strong>
                      <p>
                        {typeof model.groundwater_level?.elevation_mAOD === "number"
                          ? `${model.groundwater_level.elevation_mAOD} mAOD`
                          : "Not set"}
                      </p>
                    </div>
                  </div>
                  <div className="unit-list">
                    {(model.units ?? []).map((unit) => (
                      <div className="unit-row" key={unit.id}>
                        <div>
                          <strong>{unit.name ?? unit.id}</strong>
                          <p>
                            {unit.id} · {unit.material_ref}
                          </p>
                        </div>
                        <span>
                          Top {typeof unit.top_mAOD === "number" ? `${unit.top_mAOD} mAOD` : "n/a"}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="case-list">
                    {(model.cases ?? []).map((caseDefinition) => (
                      <span className="case-pill" key={caseDefinition.id}>
                        {caseDefinition.name} · {caseDefinition.drainage}
                      </span>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </article>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
