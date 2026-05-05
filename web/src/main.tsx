import Editor, { loader } from "@monaco-editor/react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import schema from "../../schema/groundmodel-0.1.0.json";
import { configureMonacoYaml } from "monaco-yaml";
import { parse, stringify } from "yaml";
import "./styles.css";

type Condition = "proven" | "not_proven" | "assumed" | "inferred";
type Drainage = "undrained" | "drained" | "total" | "effective";
type VerticalDatum = "mAOD" | "mOD" | "mASL" | "mBGL" | "local";
type GroundModelType = "observational" | "design" | "hydrogeological";
type Dimensionality = "1D" | "2D" | "3D";
type UnitSystem = "SI" | "imperial";

type ParameterRange = {
  value?: number;
  min?: number;
  max?: number;
  char?: number;
};

type ParameterValue = number | ParameterRange;

type BaseRef = "MODEL_BASE" | string | { mAOD: number };

type Project = {
  id: string;
  name: string;
  description?: string;
  vertical_datum: VerticalDatum;
  horizontal_crs?: string;
  units?: UnitSystem;
};

type Material = {
  id: string;
  name: string;
  description?: string;
  color?: string;
  hatch?: string;
  parameter_sets?: Record<string, Record<string, ParameterValue>>;
};

type Applicability = {
  description?: string;
  plan_polygon_wkt?: string;
  top_mAOD?: number;
  base_mAOD?: number;
};

type GroundwaterLevel = {
  elevation_mAOD: number;
};

type ModelBase = {
  elevation_mAOD: number;
  material_ref: string;
  condition: Condition;
};

type ModelUnit = {
  id: string;
  name?: string;
  material_ref: string;
  top_mAOD?: number;
  base: BaseRef;
  base_condition?: Condition;
  geometry_wkt?: string;
  top_surface_wkt?: string;
  volume_wkt?: string;
};

type ModelCase = {
  id: string;
  name: string;
  drainage: Drainage;
};

type GroundModel = {
  id: string;
  name: string;
  type?: GroundModelType;
  dimensionality?: Dimensionality;
  applicability?: Applicability;
  groundwater_level?: GroundwaterLevel;
  model_base: ModelBase;
  units?: ModelUnit[];
  cases?: ModelCase[];
  section_line_wkt?: string;
};

type GroundModelDocument = {
  schema_version: string;
  project: Project;
  materials?: Material[];
  ground_models?: GroundModel[];
};

type Diagnostic = {
  code: string;
  path: string;
  message: string;
};

type AgsiParameter = {
  codeID: string;
  caseID: string;
  drainage: string;
  value: ParameterValue;
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

const DRAINAGES: Drainage[] = ["undrained", "drained", "total", "effective"];
const CONDITIONS: Condition[] = ["proven", "not_proven", "assumed", "inferred"];
const VERTICAL_DATUMS: VerticalDatum[] = ["mAOD", "mOD", "mASL", "mBGL", "local"];
const MODEL_TYPES: GroundModelType[] = ["design", "observational", "hydrogeological"];
const DIMENSIONALITIES: Dimensionality[] = ["1D", "2D", "3D"];
const UNIT_SYSTEMS: UnitSystem[] = ["SI", "imperial"];
const PARAMETER_KEYS = [
  "gamma",
  "gamma_sat",
  "gamma_dry",
  "cu",
  "phi_prime",
  "c_prime",
  "phi_cv",
  "e",
  "eu",
  "g",
  "g0",
  "nu",
  "k",
  "cv",
  "mv",
  "ocr",
  "k0",
  "vs",
  "qc",
  "n_spt"
] as const;

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

type WorkspaceTab = "setup" | "materials" | "models" | "review" | "yaml";
type ModelWorkspaceTab = "overview" | "geometry" | "hydro" | "cases" | "units";

const WORKSPACE_TABS: { id: WorkspaceTab; label: string; description: string }[] = [
  { id: "setup", label: "Setup", description: "Project details and workflow entry point." },
  { id: "materials", label: "Materials", description: "Build the material library once." },
  { id: "models", label: "Models", description: "Assemble ground models, units, and cases." },
  { id: "review", label: "Review", description: "Validation, YAML preview, and AGSi output." },
  { id: "yaml", label: "YAML", description: "Advanced editing with schema-aware autocomplete." }
];

const YAML_SCHEMA_URI = "https://groundmodel.dev/schema/groundmodel-0.1.0.json";
const MODEL_WORKSPACE_TABS: { id: ModelWorkspaceTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "geometry", label: "Geometry" },
  { id: "hydro", label: "Hydro" },
  { id: "cases", label: "Cases" },
  { id: "units", label: "Units" }
];

let monacoYamlConfigured = false;

function ensureMonacoYaml() {
  if (monacoYamlConfigured) return;

  loader.init().then((monaco) => {
    if (monacoYamlConfigured) return;
    configureMonacoYaml(monaco, {
      enableSchemaRequest: false,
      validate: true,
      hover: true,
      completion: true,
      format: true,
      schemas: [
        {
          uri: YAML_SCHEMA_URI,
          fileMatch: ["*", "*.yaml", "*.yml"],
          schema: schema as Record<string, unknown>
        }
      ]
    });
    monacoYamlConfigured = true;
  });
}

const SAMPLE_YAML = `schema_version: "0.1.0"
project:
  id: "EXAMPLE-01"
  name: "Worked Orchard Example"
  description: "Example project for editor testing."
  vertical_datum: "mAOD"
  horizontal_crs: "EPSG:27700"
  units: "SI"
materials:
  - id: "MAT-CLAY"
    name: "London Clay"
    description: "Stiff fissured clay"
    color: "#A87C4F"
    hatch: "clay"
    parameter_sets:
      undrained:
        gamma: 19
        cu:
          value: 75
          min: 55
          max: 95
      drained:
        phi_prime: 26
ground_models:
  - id: "GM-01"
    name: "Site-wide Ground Model"
    type: "design"
    dimensionality: "1D"
    applicability:
      description: "Applies south of the river."
      plan_polygon_wkt: "POLYGON((535000 180000, 535500 180000, 535500 180500, 535000 180500, 535000 180000))"
      top_mAOD: 65
      base_mAOD: 20
    groundwater_level:
      elevation_mAOD: 58.5
    model_base:
      elevation_mAOD: 20
      material_ref: "MAT-CLAY"
      condition: "assumed"
    units:
      - id: "UNIT-CLAY"
        name: "London Clay"
        material_ref: "MAT-CLAY"
        top_mAOD: 60.2
        base: "MODEL_BASE"
        base_condition: "not_proven"
        geometry_wkt: "POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))"
    cases:
      - id: "SLS-UND"
        name: "SLS - Undrained"
        drainage: "undrained"
    section_line_wkt: "LINESTRING(0 0, 10 0)"
`;

function parseYamlDocument(input: string): GroundModelDocument {
  return parse(input) as GroundModelDocument;
}

function newId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function blankDocument(): GroundModelDocument {
  return {
    schema_version: "0.1.0",
    project: {
      id: "",
      name: "",
      description: "",
      vertical_datum: "mAOD",
      horizontal_crs: "",
      units: "SI"
    },
    materials: [],
    ground_models: []
  };
}

function defaultMaterial(): Material {
  return {
    id: newId("MAT"),
    name: "New Material",
    description: "",
    color: "",
    hatch: "",
    parameter_sets: {}
  };
}

function defaultModel(materialRef = ""): GroundModel {
  return {
    id: newId("GM"),
    name: "New Ground Model",
    type: "design",
    dimensionality: "1D",
    applicability: undefined,
    groundwater_level: undefined,
    model_base: {
      elevation_mAOD: 0,
      material_ref: materialRef,
      condition: "assumed"
    },
    units: [],
    cases: [],
    section_line_wkt: ""
  };
}

function defaultUnit(materialRef = ""): ModelUnit {
  return {
    id: newId("UNIT"),
    name: "",
    material_ref: materialRef,
    top_mAOD: undefined,
    base: "MODEL_BASE",
    base_condition: undefined,
    geometry_wkt: "",
    top_surface_wkt: "",
    volume_wkt: ""
  };
}

function defaultCase(): ModelCase {
  return {
    id: newId("CASE"),
    name: "New Case",
    drainage: "undrained"
  };
}

function defaultRange(): ParameterRange {
  return {
    value: undefined,
    min: undefined,
    max: undefined,
    char: undefined
  };
}

function isRangeValue(value: ParameterValue | undefined): value is ParameterRange {
  return typeof value === "object" && value !== null;
}

function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseRequiredNumber(value: string, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function looksLikeWkt(value: string, prefix: string) {
  return value.trim().toUpperCase().startsWith(prefix);
}

function cleanString(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function cleanParameterValue(value: ParameterValue | undefined): ParameterValue | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  const next: ParameterRange = {
    value: value.value,
    min: value.min,
    max: value.max,
    char: value.char
  };

  if (
    next.value === undefined &&
    next.min === undefined &&
    next.max === undefined &&
    next.char === undefined
  ) {
    return undefined;
  }

  return next;
}

function cleanBaseRef(base: BaseRef): BaseRef {
  if (typeof base === "string") {
    return base.trim() || "MODEL_BASE";
  }
  return typeof base.mAOD === "number" ? { mAOD: base.mAOD } : "MODEL_BASE";
}

function cleanDocument(doc: GroundModelDocument): GroundModelDocument {
  return {
    schema_version: doc.schema_version || "0.1.0",
    project: {
      id: doc.project.id,
      name: doc.project.name,
      description: cleanString(doc.project.description),
      vertical_datum: doc.project.vertical_datum,
      horizontal_crs: cleanString(doc.project.horizontal_crs),
      units: doc.project.units ?? "SI"
    },
    materials: (doc.materials ?? []).map((material) => {
      const parameterSets = Object.fromEntries(
        Object.entries(material.parameter_sets ?? {})
          .map(([drainage, params]) => [
            drainage,
            Object.fromEntries(
              Object.entries(params)
                .map(([key, value]) => [key, cleanParameterValue(value)])
                .filter(([, value]) => value !== undefined)
            )
          ])
          .filter(([, params]) => Object.keys(params).length > 0)
      );

      return {
        id: material.id,
        name: material.name,
        description: cleanString(material.description),
        color: cleanString(material.color),
        hatch: cleanString(material.hatch),
        parameter_sets: parameterSets
      };
    }),
    ground_models: (doc.ground_models ?? []).map((model) => ({
      id: model.id,
      name: model.name,
      type: model.type ?? "design",
      dimensionality: model.dimensionality ?? "1D",
      applicability: model.applicability
        ? {
            description: cleanString(model.applicability.description),
            plan_polygon_wkt: cleanString(model.applicability.plan_polygon_wkt),
            top_mAOD: model.applicability.top_mAOD,
            base_mAOD: model.applicability.base_mAOD
          }
        : undefined,
      groundwater_level:
        model.groundwater_level?.elevation_mAOD === undefined
          ? undefined
          : { elevation_mAOD: model.groundwater_level.elevation_mAOD },
      model_base: {
        elevation_mAOD: model.model_base.elevation_mAOD,
        material_ref: model.model_base.material_ref,
        condition: model.model_base.condition
      },
      units: (model.units ?? []).map((unit) => ({
        id: unit.id,
        name: cleanString(unit.name),
        material_ref: unit.material_ref,
        top_mAOD: unit.top_mAOD,
        base: cleanBaseRef(unit.base),
        base_condition: unit.base_condition,
        geometry_wkt: cleanString(unit.geometry_wkt),
        top_surface_wkt: cleanString(unit.top_surface_wkt),
        volume_wkt: cleanString(unit.volume_wkt)
      })),
      cases: (model.cases ?? []).map((caseItem) => ({
        id: caseItem.id,
        name: caseItem.name,
        drainage: caseItem.drainage
      })),
      section_line_wkt: cleanString(model.section_line_wkt)
    }))
  };
}

function validateDocument(doc: GroundModelDocument): Diagnostic[] {
  const clean = cleanDocument(doc);
  const diagnostics: Diagnostic[] = [];

  if (clean.schema_version !== "0.1.0") {
    diagnostics.push({
      code: "GM000",
      path: "schema_version",
      message: `unsupported schema_version \`${clean.schema_version}\`; expected \`0.1.0\``
    });
  }

  if (!clean.project.id) {
    diagnostics.push({ code: "REQ", path: "project.id", message: "Project id is required." });
  }
  if (!clean.project.name) {
    diagnostics.push({ code: "REQ", path: "project.name", message: "Project name is required." });
  }

  const materials = clean.materials ?? [];
  const models = clean.ground_models ?? [];
  const materialIds = new Set(materials.map((material) => material.id));

  materials.forEach((material, materialIndex) => {
    Object.entries(material.parameter_sets ?? {}).forEach(([drainage, params]) => {
      if (!DRAINAGES.includes(drainage as Drainage)) {
        diagnostics.push({
          code: "GM008",
          path: `materials[${materialIndex}].parameter_sets.${drainage}`,
          message: `unsupported drainage key \`${drainage}\``
        });
      }
      Object.keys(params).forEach((key) => {
        if (!(PARAMETER_KEYS as readonly string[]).includes(key)) {
          diagnostics.push({
            code: "GM009",
            path: `materials[${materialIndex}].parameter_sets.${drainage}.${key}`,
            message: `material \`${material.id}\` uses unsupported parameter key \`${key}\``
          });
        }
      });
    });
  });

  models.forEach((model, modelIndex) => {
    if (!materialIds.has(model.model_base.material_ref)) {
      diagnostics.push({
        code: "GM001",
        path: `ground_models[${modelIndex}].model_base.material_ref`,
        message: `unknown material_ref \`${model.model_base.material_ref}\``
      });
    }

    if (model.applicability?.plan_polygon_wkt && !looksLikeWkt(model.applicability.plan_polygon_wkt, "POLYGON")) {
      diagnostics.push({
        code: "GM006",
        path: `ground_models[${modelIndex}].applicability.plan_polygon_wkt`,
        message: "geometry must be a `POLYGON` WKT"
      });
    }

    if (model.section_line_wkt && !looksLikeWkt(model.section_line_wkt, "LINESTRING")) {
      diagnostics.push({
        code: "GM006",
        path: `ground_models[${modelIndex}].section_line_wkt`,
        message: "geometry must be a `LINESTRING` WKT"
      });
    }

    const units = model.units ?? [];
    const unitIds = new Set(units.map((unit) => unit.id));
    if (unitIds.size !== units.length) {
      diagnostics.push({
        code: "GM007",
        path: `ground_models[${modelIndex}].units`,
        message: `ground model \`${model.id}\` contains duplicate unit ids`
      });
    }

    let previousTop: number | null = null;
    const appTop = model.applicability?.top_mAOD;
    const appBase = model.applicability?.base_mAOD;

    units.forEach((unit, unitIndex) => {
      const unitPath = `ground_models[${modelIndex}].units[${unitIndex}]`;
      if (!materialIds.has(unit.material_ref)) {
        diagnostics.push({
          code: "GM001",
          path: `${unitPath}.material_ref`,
          message: `unknown material_ref \`${unit.material_ref}\``
        });
      }

      if ((model.dimensionality ?? "1D") === "1D") {
        if (unit.top_mAOD === undefined) {
          diagnostics.push({
            code: "GM002",
            path: `${unitPath}.top_mAOD`,
            message: "1D units must define top_mAOD"
          });
        } else {
          if (previousTop !== null && unit.top_mAOD >= previousTop) {
            diagnostics.push({
              code: "GM002",
              path: `${unitPath}.top_mAOD`,
              message: "unit top_mAOD must strictly decrease down the stack"
            });
          }
          if (appTop !== undefined && unit.top_mAOD > appTop) {
            diagnostics.push({
              code: "GM002",
              path: `${unitPath}.top_mAOD`,
              message: "unit top_mAOD is above applicability.top_mAOD"
            });
          }
          if (unit.top_mAOD <= model.model_base.elevation_mAOD) {
            diagnostics.push({
              code: "GM002",
              path: `${unitPath}.top_mAOD`,
              message: "unit top_mAOD must be above model_base.elevation_mAOD"
            });
          }
          previousTop = unit.top_mAOD;
        }
      }

      if (typeof unit.base === "object" && unit.base !== null && "mAOD" in unit.base) {
        const baseElevation = unit.base.mAOD;
        if (unit.top_mAOD !== undefined && baseElevation >= unit.top_mAOD) {
          diagnostics.push({
            code: "GM003",
            path: `${unitPath}.base`,
            message: "unit base elevation must lie below top_mAOD"
          });
        }
        if (baseElevation < model.model_base.elevation_mAOD) {
          diagnostics.push({
            code: "GM003",
            path: `${unitPath}.base`,
            message: "unit base elevation must not be below model_base.elevation_mAOD"
          });
        }
      } else if (typeof unit.base === "string" && unit.base !== "MODEL_BASE" && !unitIds.has(unit.base)) {
        diagnostics.push({
          code: "GM003",
          path: `${unitPath}.base`,
          message: `unknown unit base reference \`${unit.base}\``
        });
      }

      if (unit.geometry_wkt && !looksLikeWkt(unit.geometry_wkt, "POLYGON")) {
        diagnostics.push({
          code: "GM006",
          path: `${unitPath}.geometry_wkt`,
          message: "geometry must be a `POLYGON` WKT"
        });
      }
      if (unit.top_surface_wkt && !looksLikeWkt(unit.top_surface_wkt, "TIN")) {
        diagnostics.push({
          code: "GM006",
          path: `${unitPath}.top_surface_wkt`,
          message: "geometry must be a `TIN` WKT"
        });
      }
      if (unit.volume_wkt && !looksLikeWkt(unit.volume_wkt, "POLYHEDRALSURFACE")) {
        diagnostics.push({
          code: "GM006",
          path: `${unitPath}.volume_wkt`,
          message: "geometry must be a `POLYHEDRALSURFACE` WKT"
        });
      }
    });

    (model.cases ?? []).forEach((caseItem, caseIndex) => {
      units.forEach((unit) => {
        const material = materials.find((entry) => entry.id === unit.material_ref);
        if (material && !(material.parameter_sets ?? {})[caseItem.drainage]) {
          diagnostics.push({
            code: "GM004",
            path: `ground_models[${modelIndex}].cases[${caseIndex}].drainage`,
            message: `case drainage \`${caseItem.drainage}\` is missing from material \`${material.id}\``
          });
        }
      });
    });

    if (model.groundwater_level?.elevation_mAOD !== undefined) {
      const modelTop = units.reduce((current, unit) => {
        return unit.top_mAOD !== undefined ? Math.max(current, unit.top_mAOD) : current;
      }, appTop ?? Number.NEGATIVE_INFINITY);
      const modelBottom = appBase ?? model.model_base.elevation_mAOD;
      if (
        model.groundwater_level.elevation_mAOD < modelBottom ||
        model.groundwater_level.elevation_mAOD > modelTop
      ) {
        diagnostics.push({
          code: "GM005",
          path: `ground_models[${modelIndex}].groundwater_level.elevation_mAOD`,
          message: "groundwater level must be within the model vertical extent"
        });
      }
    }
  });

  return diagnostics;
}

function groundModelToAgsi(document: GroundModelDocument): AgsiRoot {
  const clean = cleanDocument(document);
  const materialsById = new Map((clean.materials ?? []).map((material) => [material.id, material]));

  return {
    agsSchema: { name: "AGSi", version: "1.0.1" },
    agsFile: { name: clean.project.name, format: "groundmodel" },
    agsProject: {
      projectID: clean.project.id,
      projectName: clean.project.name,
      description: clean.project.description,
      verticalDatum: clean.project.vertical_datum,
      horizontalCRS: clean.project.horizontal_crs
    },
    agsiModel: (clean.ground_models ?? []).map((model) => ({
      modelID: model.id,
      modelName: model.name,
      modelType: model.type,
      dimensionality: model.dimensionality,
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
      elements: (model.units ?? []).map((unit) => ({
        elementID: unit.id,
        name: unit.name,
        materialRef: unit.material_ref,
        top_mAOD: unit.top_mAOD,
        base: unit.base,
        baseCondition: unit.base_condition,
        geometryWKT: unit.geometry_wkt,
        topSurfaceWKT: unit.top_surface_wkt,
        volumeWKT: unit.volume_wkt,
        agsiDataParameterValue: (model.cases ?? []).flatMap((caseItem) => {
          const params = materialsById.get(unit.material_ref)?.parameter_sets?.[caseItem.drainage] ?? {};
          return Object.entries(params)
            .filter(([key]) => Boolean(CODE_MAP[key]))
            .map(([key, value]) => ({
              codeID: CODE_MAP[key],
              caseID: caseItem.id,
              drainage: caseItem.drainage,
              value
            }));
        })
      }))
    }))
  };
}

function agsiToGroundModel(agsi: AgsiRoot): GroundModelDocument {
  const materials = new Map<string, Material>();

  const groundModels = (agsi.agsiModel ?? []).map((model) => {
    const cases = new Map<string, Drainage>();
    const units = (model.elements ?? []).map((element) => {
      if (!materials.has(element.materialRef)) {
        materials.set(element.materialRef, {
          id: element.materialRef,
          name: element.materialRef,
          description: "",
          color: "",
          hatch: "",
          parameter_sets: {}
        });
      }
      const material = materials.get(element.materialRef)!;

      for (const parameter of element.agsiDataParameterValue ?? []) {
        const key = REVERSE_CODE_MAP[parameter.codeID];
        if (!key) continue;
        material.parameter_sets ??= {};
        material.parameter_sets[parameter.drainage] ??= {};
        material.parameter_sets[parameter.drainage][key] = parameter.value;
        cases.set(parameter.caseID, (parameter.drainage as Drainage) || "undrained");
      }

      return {
        id: element.elementID,
        name: element.name ?? "",
        material_ref: element.materialRef,
        top_mAOD: element.top_mAOD,
        base: element.base ?? "MODEL_BASE",
        base_condition: element.baseCondition as Condition | undefined,
        geometry_wkt: element.geometryWKT ?? "",
        top_surface_wkt: element.topSurfaceWKT ?? "",
        volume_wkt: element.volumeWKT ?? ""
      };
    });

    return {
      id: model.modelID,
      name: model.modelName,
      type: (model.modelType as GroundModelType) ?? "design",
      dimensionality: (model.dimensionality as Dimensionality) ?? "1D",
      applicability: model.agsiModelBoundary
        ? {
            description: model.agsiModelBoundary.description ?? "",
            plan_polygon_wkt: model.agsiModelBoundary.planPolygonWKT ?? "",
            top_mAOD: model.agsiModelBoundary.top_mAOD,
            base_mAOD: model.agsiModelBoundary.base_mAOD
          }
        : undefined,
      groundwater_level:
        model.groundwaterLevel === undefined
          ? undefined
          : { elevation_mAOD: model.groundwaterLevel },
      model_base: {
        elevation_mAOD: model.modelBase?.elevation_mAOD ?? 0,
        material_ref: model.modelBase?.materialRef ?? "",
        condition: (model.modelBase?.condition as Condition) ?? "assumed"
      },
      units,
      cases: Array.from(cases.entries()).map(([id, drainage]) => ({
        id,
        name: id,
        drainage
      })),
      section_line_wkt: ""
    };
  });

  return {
    schema_version: "0.1.0",
    project: {
      id: agsi.agsProject.projectID,
      name: agsi.agsProject.projectName,
      description: agsi.agsProject.description ?? "",
      vertical_datum: (agsi.agsProject.verticalDatum as VerticalDatum) ?? "mAOD",
      horizontal_crs: agsi.agsProject.horizontalCRS ?? "",
      units: "SI"
    },
    materials: Array.from(materials.values()),
    ground_models: groundModels
  };
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

function setInArray<T>(items: T[], index: number, updater: (item: T) => T): T[] {
  return items.map((item, itemIndex) => (itemIndex === index ? updater(item) : item));
}

function removeFromArray<T>(items: T[], index: number) {
  return items.filter((_, itemIndex) => itemIndex !== index);
}

function ParameterEditor({
  label,
  value,
  onChange
}: {
  label: string;
  value: ParameterValue | undefined;
  onChange: (value: ParameterValue | undefined) => void;
}) {
  const mode = value === undefined ? "none" : isRangeValue(value) ? "range" : "scalar";

  return (
    <div className="parameter-card">
      <div className="parameter-head">
        <strong>{label}</strong>
        <select
          value={mode}
          onChange={(event) => {
            const nextMode = event.target.value;
            if (nextMode === "none") onChange(undefined);
            if (nextMode === "scalar") onChange(typeof value === "number" ? value : 0);
            if (nextMode === "range") onChange(isRangeValue(value) ? value : defaultRange());
          }}
        >
          <option value="none">Off</option>
          <option value="scalar">Scalar</option>
          <option value="range">Range</option>
        </select>
      </div>

      {mode === "scalar" ? (
        <input
          type="number"
          value={typeof value === "number" ? value : ""}
          onChange={(event) => onChange(parseOptionalNumber(event.target.value))}
        />
      ) : null}

      {mode === "range" ? (
        <div className="parameter-range-grid">
          {(["value", "min", "max", "char"] as const).map((field) => (
            <label key={field}>
              <span>{field}</span>
              <input
                type="number"
                value={isRangeValue(value) && value[field] !== undefined ? value[field] : ""}
                onChange={(event) =>
                  onChange({
                    ...(isRangeValue(value) ? value : defaultRange()),
                    [field]: parseOptionalNumber(event.target.value)
                  })
                }
              />
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("setup");
  const [selectedMaterialIndex, setSelectedMaterialIndex] = useState(0);
  const [selectedDrainage, setSelectedDrainage] = useState<Drainage>("undrained");
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);
  const [modelTab, setModelTab] = useState<ModelWorkspaceTab>("overview");
  const [documentState, setDocumentState] = useState<GroundModelDocument>(() =>
    parseYamlDocument(SAMPLE_YAML)
  );
  const [importError, setImportError] = useState("");
  const [yamlDraft, setYamlDraft] = useState(SAMPLE_YAML);
  const [yamlError, setYamlError] = useState("");
  const [yamlDirty, setYamlDirty] = useState(false);

  const cleanedDocument = useMemo(() => cleanDocument(documentState), [documentState]);
  const diagnostics = useMemo(() => validateDocument(documentState), [documentState]);
  const yamlText = useMemo(
    () => stringify(cleanedDocument, { indent: 2, lineWidth: 0 }),
    [cleanedDocument]
  );
  const agsiText = useMemo(
    () => JSON.stringify(groundModelToAgsi(cleanedDocument), null, 2),
    [cleanedDocument]
  );

  useEffect(() => {
    ensureMonacoYaml();
  }, []);

  useEffect(() => {
    if (!yamlDirty) {
      setYamlDraft(yamlText);
    }
  }, [yamlDirty, yamlText]);

  async function importFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const nextDocument = file.name.endsWith(".json")
        ? agsiToGroundModel(JSON.parse(text) as AgsiRoot)
        : parseYamlDocument(text);
      setDocumentState(nextDocument);
      setSelectedMaterialIndex(0);
      setSelectedDrainage("undrained");
      setSelectedModelIndex(0);
      setModelTab("overview");
      setImportError("");
      setYamlError("");
      setYamlDirty(false);
      setActiveTab("setup");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Import failed.");
    }

    event.target.value = "";
  }

  const materials = documentState.materials ?? [];
  const groundModels = documentState.ground_models ?? [];
  const safeSelectedMaterialIndex =
    materials.length === 0 ? -1 : Math.min(selectedMaterialIndex, materials.length - 1);
  const selectedMaterial =
    safeSelectedMaterialIndex >= 0 ? materials[safeSelectedMaterialIndex] : undefined;
  const safeSelectedModelIndex =
    groundModels.length === 0 ? -1 : Math.min(selectedModelIndex, groundModels.length - 1);
  const selectedModel = safeSelectedModelIndex >= 0 ? groundModels[safeSelectedModelIndex] : undefined;
  const unitCount = groundModels.reduce((total, model) => total + (model.units?.length ?? 0), 0);
  const caseCount = groundModels.reduce((total, model) => total + (model.cases?.length ?? 0), 0);
  const validationTone = diagnostics.length === 0 ? "ok" : diagnostics.length < 4 ? "warn" : "bad";

  function applyYamlDraft() {
    try {
      const nextDocument = parseYamlDocument(yamlDraft);
      setDocumentState(nextDocument);
      setSelectedMaterialIndex(0);
      setSelectedDrainage("undrained");
      setSelectedModelIndex(0);
      setModelTab("overview");
      setYamlDirty(false);
      setYamlError("");
      setImportError("");
    } catch (error) {
      setYamlError(error instanceof Error ? error.message : "YAML update failed.");
    }
  }

  function resetYamlDraft() {
    setYamlDraft(yamlText);
    setYamlDirty(false);
    setYamlError("");
  }

  return (
    <main className="app-shell">
      <section className="topbar hero">
        <div>
          <h1>Groundmodel Editor</h1>
          <p>
            Guided workflow for non-technical users, with an advanced YAML workspace for power users.
          </p>
        </div>
        <div className="toolbar">
          <button
            onClick={() => {
              setDocumentState(blankDocument());
              setSelectedMaterialIndex(0);
              setSelectedDrainage("undrained");
              setSelectedModelIndex(0);
              setModelTab("overview");
            }}
            type="button"
          >
            New
          </button>
          <button
            onClick={() => {
              setDocumentState(parseYamlDocument(SAMPLE_YAML));
              setSelectedMaterialIndex(0);
              setSelectedDrainage("undrained");
              setSelectedModelIndex(0);
              setModelTab("overview");
            }}
            type="button"
          >
            Load Sample
          </button>
          <button onClick={() => fileInputRef.current?.click()} type="button">
            Import
          </button>
          <button onClick={() => saveFile("groundmodel.yaml", yamlText, "text/yaml")} type="button">
            Export YAML
          </button>
          <button onClick={() => saveFile("agsi.json", agsiText, "application/json")} type="button">
            Export AGSi
          </button>
          <input
            ref={fileInputRef}
            className="hidden"
            type="file"
            accept=".yaml,.yml,.json"
            onChange={importFile}
          />
        </div>
      </section>

      {importError ? <section className="notice error">{importError}</section> : null}
      <section className="workspace-tabs" aria-label="Editor modes">
        {WORKSPACE_TABS.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? "tab-button active" : "tab-button"}
            type="button"
            onClick={() => setActiveTab(tab.id)}
          >
            <strong>{tab.label}</strong>
            <span>{tab.description}</span>
          </button>
        ))}
      </section>

      {activeTab === "setup" ? (
        <section className="stack">
          <section className="overview-grid">
            <article className="card workflow-card">
              <div className="section-head">
                <h2>Project Setup</h2>
                <span className={`status-pill ${validationTone}`}>
                  {diagnostics.length === 0
                    ? "Ready"
                    : `${diagnostics.length} issue${diagnostics.length === 1 ? "" : "s"}`}
                </span>
              </div>
              <p className="section-copy">
                Start with the project metadata, then build a material library and assign those
                materials into one or more ground models.
              </p>
              <div className="metric-grid">
                <div className="metric-card">
                  <strong>{materials.length}</strong>
                  <span>Materials</span>
                </div>
                <div className="metric-card">
                  <strong>{groundModels.length}</strong>
                  <span>Models</span>
                </div>
                <div className="metric-card">
                  <strong>{unitCount}</strong>
                  <span>Units</span>
                </div>
                <div className="metric-card">
                  <strong>{caseCount}</strong>
                  <span>Cases</span>
                </div>
              </div>
              <div className="shortcut-row">
                <button type="button" onClick={() => setActiveTab("materials")}>
                  Edit Materials
                </button>
                <button type="button" onClick={() => setActiveTab("models")}>
                  Edit Models
                </button>
                <button type="button" onClick={() => setActiveTab("yaml")}>
                  Open YAML
                </button>
              </div>
            </article>

            <article className="card workflow-card accent-card">
              <div className="section-head">
                <h2>How This Flows</h2>
              </div>
              <div className="step-list">
                <div className="step-item">
                  <strong>1. Define the project</strong>
                  <span>Name, IDs, units, and coordinate reference details.</span>
                </div>
                <div className="step-item">
                  <strong>2. Build the material library</strong>
                  <span>Enter soil and rock properties once, then reuse them across cases.</span>
                </div>
                <div className="step-item">
                  <strong>3. Assemble ground models</strong>
                  <span>Add units, boundaries, groundwater, and analysis cases.</span>
                </div>
                <div className="step-item">
                  <strong>4. Review or fine-tune in YAML</strong>
                  <span>Use validation and the schema-aware Monaco editor before export.</span>
                </div>
              </div>
            </article>
          </section>

          <section className="card">
            <div className="section-head">
              <h2>Project</h2>
            </div>
            <div className="form-grid">
              <label>
                <span>Schema Version</span>
                <input
                  value={documentState.schema_version}
                  onChange={(event) =>
                    setDocumentState({ ...documentState, schema_version: event.target.value })
                  }
                />
              </label>
              <label>
                <span>Project ID</span>
                <input
                  value={documentState.project.id}
                  onChange={(event) =>
                    setDocumentState({
                      ...documentState,
                      project: { ...documentState.project, id: event.target.value }
                    })
                  }
                />
              </label>
              <label>
                <span>Name</span>
                <input
                  value={documentState.project.name}
                  onChange={(event) =>
                    setDocumentState({
                      ...documentState,
                      project: { ...documentState.project, name: event.target.value }
                    })
                  }
                />
              </label>
              <label>
                <span>Vertical Datum</span>
                <select
                  value={documentState.project.vertical_datum}
                  onChange={(event) =>
                    setDocumentState({
                      ...documentState,
                      project: {
                        ...documentState.project,
                        vertical_datum: event.target.value as VerticalDatum
                      }
                    })
                  }
                >
                  {VERTICAL_DATUMS.map((datum) => (
                    <option key={datum} value={datum}>
                      {datum}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Units</span>
                <select
                  value={documentState.project.units ?? "SI"}
                  onChange={(event) =>
                    setDocumentState({
                      ...documentState,
                      project: {
                        ...documentState.project,
                        units: event.target.value as UnitSystem
                      }
                    })
                  }
                >
                  {UNIT_SYSTEMS.map((unitSystem) => (
                    <option key={unitSystem} value={unitSystem}>
                      {unitSystem}
                    </option>
                  ))}
                </select>
              </label>
              <label className="full-width">
                <span>Horizontal CRS</span>
                <input
                  value={documentState.project.horizontal_crs ?? ""}
                  onChange={(event) =>
                    setDocumentState({
                      ...documentState,
                      project: { ...documentState.project, horizontal_crs: event.target.value }
                    })
                  }
                />
              </label>
              <label className="full-width">
                <span>Description</span>
                <textarea
                  rows={3}
                  value={documentState.project.description ?? ""}
                  onChange={(event) =>
                    setDocumentState({
                      ...documentState,
                      project: { ...documentState.project, description: event.target.value }
                    })
                  }
                />
              </label>
            </div>
          </section>
        </section>
      ) : null}

      {activeTab === "materials" ? (
        <section className="card">
          <div className="section-head">
            <div>
              <h2>Materials</h2>
              <p className="section-copy">
                Define the reusable material library first. Select one material from the list, then
                edit its properties in the panel.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setDocumentState({
                  ...documentState,
                  materials: [...materials, defaultMaterial()]
                });
                setSelectedMaterialIndex(materials.length);
              }}
            >
              Add Material
            </button>
          </div>

          <div className="stack">
            {materials.length === 0 ? (
              <div className="empty-state">
                <strong>No materials yet.</strong>
                <span>Add your first material to start building the library.</span>
              </div>
            ) : null}
            {selectedMaterial ? (
              <div className="model-workspace">
                <aside className="model-rail">
                  <div className="model-rail-head">
                    <strong>Material Library</strong>
                    <span>{materials.length} total</span>
                  </div>
                  <div className="model-list">
                    {materials.map((material, materialIndex) => (
                      <button
                        key={material.id || materialIndex}
                        type="button"
                        className={
                          safeSelectedMaterialIndex === materialIndex
                            ? "model-list-item active"
                            : "model-list-item"
                        }
                        onClick={() => setSelectedMaterialIndex(materialIndex)}
                      >
                        <strong>{material.name || `Material ${materialIndex + 1}`}</strong>
                        <span>{material.id || "No ID"}</span>
                      </button>
                    ))}
                  </div>
                </aside>

                <div className="model-detail stack">
                  <div className="subcard" key={selectedMaterial.id || safeSelectedMaterialIndex}>
                    <div className="subhead">
                      <div>
                        <strong>{selectedMaterial.name || "Untitled Material"}</strong>
                        <p className="section-copy">
                          Reusable material parameters live here and are referenced by units in the
                          active model.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setDocumentState({
                            ...documentState,
                            materials: removeFromArray(materials, safeSelectedMaterialIndex)
                          });
                          setSelectedMaterialIndex((current) =>
                            Math.max(0, Math.min(current, materials.length - 2))
                          );
                        }}
                      >
                        Remove
                      </button>
                    </div>

                    <div className="form-grid">
                      <label>
                        <span>ID</span>
                        <input
                          value={selectedMaterial.id}
                          onChange={(event) =>
                            setDocumentState({
                              ...documentState,
                              materials: setInArray(materials, safeSelectedMaterialIndex, (item) => ({
                                ...item,
                                id: event.target.value
                              }))
                            })
                          }
                        />
                      </label>
                      <label>
                        <span>Name</span>
                        <input
                          value={selectedMaterial.name}
                          onChange={(event) =>
                            setDocumentState({
                              ...documentState,
                              materials: setInArray(materials, safeSelectedMaterialIndex, (item) => ({
                                ...item,
                                name: event.target.value
                              }))
                            })
                          }
                        />
                      </label>
                      <label>
                        <span>Color</span>
                        <input
                          value={selectedMaterial.color ?? ""}
                          onChange={(event) =>
                            setDocumentState({
                              ...documentState,
                              materials: setInArray(materials, safeSelectedMaterialIndex, (item) => ({
                                ...item,
                                color: event.target.value
                              }))
                            })
                          }
                        />
                      </label>
                      <label>
                        <span>Hatch</span>
                        <input
                          value={selectedMaterial.hatch ?? ""}
                          onChange={(event) =>
                            setDocumentState({
                              ...documentState,
                              materials: setInArray(materials, safeSelectedMaterialIndex, (item) => ({
                                ...item,
                                hatch: event.target.value
                              }))
                            })
                          }
                        />
                      </label>
                      <label className="full-width">
                        <span>Description</span>
                        <textarea
                          rows={2}
                          value={selectedMaterial.description ?? ""}
                          onChange={(event) =>
                            setDocumentState({
                              ...documentState,
                              materials: setInArray(materials, safeSelectedMaterialIndex, (item) => ({
                                ...item,
                                description: event.target.value
                              }))
                            })
                          }
                        />
                      </label>
                    </div>

                    <div className="subsection">
                      <div className="section-head small">
                        <h3>Parameters</h3>
                        <label className="inline-select">
                          <span>Drainage set</span>
                          <select
                            value={selectedDrainage}
                            onChange={(event) => setSelectedDrainage(event.target.value as Drainage)}
                          >
                            {DRAINAGES.map((drainage) => (
                              <option key={drainage} value={drainage}>
                                {drainage}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="parameter-grid">
                        {PARAMETER_KEYS.map((parameterKey) => (
                          <ParameterEditor
                            key={parameterKey}
                            label={parameterKey}
                            value={selectedMaterial.parameter_sets?.[selectedDrainage]?.[parameterKey]}
                            onChange={(value) =>
                              setDocumentState({
                                ...documentState,
                                materials: setInArray(materials, safeSelectedMaterialIndex, (item) => ({
                                  ...item,
                                  parameter_sets: {
                                    ...(item.parameter_sets ?? {}),
                                    [selectedDrainage]: {
                                      ...(item.parameter_sets?.[selectedDrainage] ?? {}),
                                      ...(value === undefined
                                        ? Object.fromEntries(
                                            Object.entries(item.parameter_sets?.[selectedDrainage] ?? {}).filter(
                                              ([key]) => key !== parameterKey
                                            )
                                          )
                                        : { [parameterKey]: value })
                                    }
                                  }
                                }))
                              })
                            }
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {activeTab === "models" ? (
        <section className="card">
          <div className="section-head">
            <div>
              <h2>Ground Models</h2>
              <p className="section-copy">
                Add model extents, groundwater, cases, and units. Materials are selected from the
                library you defined in the previous tab.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setDocumentState({
                  ...documentState,
                  ground_models: [...groundModels, defaultModel(materials[0]?.id ?? "")]
                });
                setSelectedModelIndex(groundModels.length);
                setModelTab("overview");
              }}
            >
              Add Model
            </button>
          </div>

          <div className="stack">
            {groundModels.length === 0 ? (
              <div className="empty-state">
                <strong>No models yet.</strong>
                <span>Create a ground model and then add cases and units inside it.</span>
              </div>
            ) : null}
            {selectedModel ? (
              <div className="stack">
                <section className="subcard">
                  <div className="model-select-row">
                    <label className="model-select-field">
                      <span>Active model</span>
                      <select
                        value={safeSelectedModelIndex}
                        onChange={(event) => {
                          setSelectedModelIndex(Number(event.target.value));
                          setModelTab("overview");
                        }}
                      >
                        {groundModels.map((model, modelIndex) => (
                          <option key={model.id || modelIndex} value={modelIndex}>
                            {model.name || `Model ${modelIndex + 1}`} {model.id ? `(${model.id})` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="helper-copy">
                      {groundModels.length} model{groundModels.length === 1 ? "" : "s"} in this project
                    </span>
                  </div>
                </section>

                <div className="model-detail stack">
                  <section className="subcard model-header-card">
                    <div className="subhead">
                      <div>
                        <strong>{selectedModel.name || "Untitled Model"}</strong>
                        <p className="section-copy">
                          Work through one model at a time: define it, set geometry and hydro
                          conditions, then add cases and units.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setDocumentState({
                            ...documentState,
                            ground_models: removeFromArray(groundModels, safeSelectedModelIndex)
                          });
                          setSelectedModelIndex((current) =>
                            Math.max(0, Math.min(current, groundModels.length - 2))
                          );
                          setModelTab("overview");
                        }}
                      >
                        Remove Model
                      </button>
                    </div>

                    <div className="metric-grid compact-metrics">
                      <div className="metric-card">
                        <strong>{selectedModel.units?.length ?? 0}</strong>
                        <span>Units</span>
                      </div>
                      <div className="metric-card">
                        <strong>{selectedModel.cases?.length ?? 0}</strong>
                        <span>Cases</span>
                      </div>
                      <div className="metric-card">
                        <strong>{selectedModel.groundwater_level ? "On" : "Off"}</strong>
                        <span>Groundwater</span>
                      </div>
                      <div className="metric-card">
                        <strong>{selectedModel.dimensionality ?? "1D"}</strong>
                        <span>Dimensionality</span>
                      </div>
                    </div>
                  </section>

                  <section className="model-subtabs" aria-label="Model editing modes">
                    {MODEL_WORKSPACE_TABS.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        className={modelTab === tab.id ? "subtab-button active" : "subtab-button"}
                        onClick={() => setModelTab(tab.id)}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </section>

                  {modelTab === "overview" ? (
                    <section className="subcard">
                      <div className="section-head">
                        <h3>Model Overview</h3>
                      </div>
                      <div className="form-grid">
                        <label>
                          <span>ID</span>
                          <input
                            value={selectedModel.id}
                            onChange={(event) =>
                              setDocumentState({
                                ...documentState,
                                ground_models: setInArray(groundModels, safeSelectedModelIndex, (item) => ({
                                  ...item,
                                  id: event.target.value
                                }))
                              })
                            }
                          />
                        </label>
                        <label>
                          <span>Name</span>
                          <input
                            value={selectedModel.name}
                            onChange={(event) =>
                              setDocumentState({
                                ...documentState,
                                ground_models: setInArray(groundModels, safeSelectedModelIndex, (item) => ({
                                  ...item,
                                  name: event.target.value
                                }))
                              })
                            }
                          />
                        </label>
                        <label>
                          <span>Type</span>
                          <select
                            value={selectedModel.type ?? "design"}
                            onChange={(event) =>
                              setDocumentState({
                                ...documentState,
                                ground_models: setInArray(groundModels, safeSelectedModelIndex, (item) => ({
                                  ...item,
                                  type: event.target.value as GroundModelType
                                }))
                              })
                            }
                          >
                            {MODEL_TYPES.map((modelType) => (
                              <option key={modelType} value={modelType}>
                                {modelType}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>Dimensionality</span>
                          <select
                            value={selectedModel.dimensionality ?? "1D"}
                            onChange={(event) =>
                              setDocumentState({
                                ...documentState,
                                ground_models: setInArray(groundModels, safeSelectedModelIndex, (item) => ({
                                  ...item,
                                  dimensionality: event.target.value as Dimensionality
                                }))
                              })
                            }
                          >
                            {DIMENSIONALITIES.map((dimensionality) => (
                              <option key={dimensionality} value={dimensionality}>
                                {dimensionality}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </section>
                  ) : null}

                  {modelTab === "geometry" ? (
                    <section className="subcard">
                      <div className="section-head">
                        <h3>Geometry And Extents</h3>
                      </div>
                      <div className="form-grid">
                        <label>
                          <span>Model Base Elevation</span>
                          <input
                            type="number"
                            value={selectedModel.model_base.elevation_mAOD}
                            onChange={(event) =>
                              setDocumentState({
                                ...documentState,
                                ground_models: setInArray(groundModels, safeSelectedModelIndex, (item) => ({
                                  ...item,
                                  model_base: {
                                    ...item.model_base,
                                    elevation_mAOD: parseRequiredNumber(event.target.value)
                                  }
                                }))
                              })
                            }
                          />
                        </label>
                        <label>
                          <span>Model Base Material</span>
                          <select
                            value={selectedModel.model_base.material_ref}
                            onChange={(event) =>
                              setDocumentState({
                                ...documentState,
                                ground_models: setInArray(groundModels, safeSelectedModelIndex, (item) => ({
                                  ...item,
                                  model_base: {
                                    ...item.model_base,
                                    material_ref: event.target.value
                                  }
                                }))
                              })
                            }
                          >
                            <option value="">Select material</option>
                            {materials.map((material) => (
                              <option key={material.id} value={material.id}>
                                {material.id}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>Model Base Condition</span>
                          <select
                            value={selectedModel.model_base.condition}
                            onChange={(event) =>
                              setDocumentState({
                                ...documentState,
                                ground_models: setInArray(groundModels, safeSelectedModelIndex, (item) => ({
                                  ...item,
                                  model_base: {
                                    ...item.model_base,
                                    condition: event.target.value as Condition
                                  }
                                }))
                              })
                            }
                          >
                            {CONDITIONS.map((condition) => (
                              <option key={condition} value={condition}>
                                {condition}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="full-width">
                          <span>Section Line WKT</span>
                          <textarea
                            rows={2}
                            value={selectedModel.section_line_wkt ?? ""}
                            onChange={(event) =>
                              setDocumentState({
                                ...documentState,
                                ground_models: setInArray(groundModels, safeSelectedModelIndex, (item) => ({
                                  ...item,
                                  section_line_wkt: event.target.value
                                }))
                              })
                            }
                          />
                        </label>
                      </div>

                      <div className="subsection">
                        <div className="section-head small">
                          <h3>Applicability</h3>
                          <button
                            type="button"
                            onClick={() =>
                              setDocumentState({
                                ...documentState,
                                ground_models: setInArray(groundModels, safeSelectedModelIndex, (item) => ({
                                  ...item,
                                  applicability: item.applicability
                                    ? undefined
                                    : {
                                        description: "",
                                        plan_polygon_wkt: "",
                                        top_mAOD: undefined,
                                        base_mAOD: undefined
                                      }
                                }))
                              })
                            }
                          >
                            {selectedModel.applicability ? "Remove Applicability" : "Add Applicability"}
                          </button>
                        </div>
                        {selectedModel.applicability ? (
                          <div className="form-grid">
                            <label className="full-width">
                              <span>Description</span>
                              <textarea
                                rows={2}
                                value={selectedModel.applicability.description ?? ""}
                                onChange={(event) =>
                                  setDocumentState({
                                    ...documentState,
                                    ground_models: setInArray(groundModels, safeSelectedModelIndex, (item) => ({
                                      ...item,
                                      applicability: {
                                        ...item.applicability!,
                                        description: event.target.value
                                      }
                                    }))
                                  })
                                }
                              />
                            </label>
                            <label className="full-width">
                              <span>Plan Polygon WKT</span>
                              <textarea
                                rows={2}
                                value={selectedModel.applicability.plan_polygon_wkt ?? ""}
                                onChange={(event) =>
                                  setDocumentState({
                                    ...documentState,
                                    ground_models: setInArray(groundModels, safeSelectedModelIndex, (item) => ({
                                      ...item,
                                      applicability: {
                                        ...item.applicability!,
                                        plan_polygon_wkt: event.target.value
                                      }
                                    }))
                                  })
                                }
                              />
                            </label>
                            <label>
                              <span>Top mAOD</span>
                              <input
                                type="number"
                                value={selectedModel.applicability.top_mAOD ?? ""}
                                onChange={(event) =>
                                  setDocumentState({
                                    ...documentState,
                                    ground_models: setInArray(groundModels, safeSelectedModelIndex, (item) => ({
                                      ...item,
                                      applicability: {
                                        ...item.applicability!,
                                        top_mAOD: parseOptionalNumber(event.target.value)
                                      }
                                    }))
                                  })
                                }
                              />
                            </label>
                            <label>
                              <span>Base mAOD</span>
                              <input
                                type="number"
                                value={selectedModel.applicability.base_mAOD ?? ""}
                                onChange={(event) =>
                                  setDocumentState({
                                    ...documentState,
                                    ground_models: setInArray(groundModels, safeSelectedModelIndex, (item) => ({
                                      ...item,
                                      applicability: {
                                        ...item.applicability!,
                                        base_mAOD: parseOptionalNumber(event.target.value)
                                      }
                                    }))
                                  })
                                }
                              />
                            </label>
                          </div>
                        ) : (
                          <div className="empty-state">
                            <strong>No applicability envelope yet.</strong>
                            <span>Add one if this model only applies to a specific area or elevation range.</span>
                          </div>
                        )}
                      </div>
                    </section>
                  ) : null}

                  {modelTab === "hydro" ? (
                    <section className="subcard">
                      <div className="section-head">
                        <h3>Hydro Conditions</h3>
                        <button
                          type="button"
                          onClick={() =>
                            setDocumentState({
                              ...documentState,
                              ground_models: setInArray(groundModels, safeSelectedModelIndex, (item) => ({
                                ...item,
                                groundwater_level: item.groundwater_level
                                  ? undefined
                                  : { elevation_mAOD: 0 }
                              }))
                            })
                          }
                        >
                          {selectedModel.groundwater_level ? "Remove Groundwater" : "Add Groundwater"}
                        </button>
                      </div>
                      {selectedModel.groundwater_level ? (
                        <div className="form-grid">
                          <label>
                            <span>Elevation mAOD</span>
                            <input
                              type="number"
                              value={selectedModel.groundwater_level.elevation_mAOD}
                              onChange={(event) =>
                                setDocumentState({
                                  ...documentState,
                                  ground_models: setInArray(groundModels, safeSelectedModelIndex, (item) => ({
                                    ...item,
                                    groundwater_level: {
                                      elevation_mAOD: parseRequiredNumber(event.target.value)
                                    }
                                  }))
                                })
                              }
                            />
                          </label>
                        </div>
                      ) : (
                        <div className="empty-state">
                          <strong>No groundwater level defined.</strong>
                          <span>Add it when this model needs a representative groundwater elevation.</span>
                        </div>
                      )}
                    </section>
                  ) : null}

                  {modelTab === "cases" ? (
                    <section className="subcard">
                      <div className="section-head">
                        <h3>Cases</h3>
                        <button
                          type="button"
                          onClick={() =>
                            setDocumentState({
                              ...documentState,
                              ground_models: setInArray(groundModels, safeSelectedModelIndex, (item) => ({
                                ...item,
                                cases: [...(item.cases ?? []), defaultCase()]
                              }))
                            })
                          }
                        >
                          Add Case
                        </button>
                      </div>
                      <div className="stack compact">
                        {(selectedModel.cases ?? []).length === 0 ? (
                          <div className="empty-state">
                            <strong>No cases yet.</strong>
                            <span>Add drainage cases so units can reference the right material parameters.</span>
                          </div>
                        ) : null}
                        {(selectedModel.cases ?? []).map((caseItem, caseIndex) => (
                          <div className="mini-grid case-grid" key={caseItem.id || caseIndex}>
                            <input
                              placeholder="Case ID"
                              value={caseItem.id}
                              onChange={(event) =>
                                setDocumentState({
                                  ...documentState,
                                  ground_models: setInArray(groundModels, safeSelectedModelIndex, (modelItem) => ({
                                    ...modelItem,
                                    cases: setInArray(modelItem.cases ?? [], caseIndex, (entry) => ({
                                      ...entry,
                                      id: event.target.value
                                    }))
                                  }))
                                })
                              }
                            />
                            <input
                              placeholder="Case name"
                              value={caseItem.name}
                              onChange={(event) =>
                                setDocumentState({
                                  ...documentState,
                                  ground_models: setInArray(groundModels, safeSelectedModelIndex, (modelItem) => ({
                                    ...modelItem,
                                    cases: setInArray(modelItem.cases ?? [], caseIndex, (entry) => ({
                                      ...entry,
                                      name: event.target.value
                                    }))
                                  }))
                                })
                              }
                            />
                            <select
                              value={caseItem.drainage}
                              onChange={(event) =>
                                setDocumentState({
                                  ...documentState,
                                  ground_models: setInArray(groundModels, safeSelectedModelIndex, (modelItem) => ({
                                    ...modelItem,
                                    cases: setInArray(modelItem.cases ?? [], caseIndex, (entry) => ({
                                      ...entry,
                                      drainage: event.target.value as Drainage
                                    }))
                                  }))
                                })
                              }
                            >
                              {DRAINAGES.map((drainage) => (
                                <option key={drainage} value={drainage}>
                                  {drainage}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() =>
                                setDocumentState({
                                  ...documentState,
                                  ground_models: setInArray(groundModels, safeSelectedModelIndex, (modelItem) => ({
                                    ...modelItem,
                                    cases: removeFromArray(modelItem.cases ?? [], caseIndex)
                                  }))
                                })
                              }
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {modelTab === "units" ? (
                    <section className="subcard">
                      <div className="section-head">
                        <h3>Units</h3>
                        <button
                          type="button"
                          onClick={() =>
                            setDocumentState({
                              ...documentState,
                              ground_models: setInArray(groundModels, safeSelectedModelIndex, (item) => ({
                                ...item,
                                units: [...(item.units ?? []), defaultUnit(materials[0]?.id ?? "")]
                              }))
                            })
                          }
                        >
                          Add Unit
                        </button>
                      </div>

                      <div className="stack">
                        {(selectedModel.units ?? []).length === 0 ? (
                          <div className="empty-state">
                            <strong>No units yet.</strong>
                            <span>Add stratigraphic units and connect each one to a material definition.</span>
                          </div>
                        ) : null}
                        {(selectedModel.units ?? []).map((unit, unitIndex) => {
                          const baseMode =
                            typeof unit.base === "object"
                              ? "elevation"
                              : unit.base === "MODEL_BASE"
                                ? "model-base"
                                : "unit-ref";

                          return (
                            <div className="subcard inset" key={unit.id || unitIndex}>
                              <div className="subhead">
                                <strong>{unit.name || unit.id || "Untitled Unit"}</strong>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDocumentState({
                                      ...documentState,
                                      ground_models: setInArray(groundModels, safeSelectedModelIndex, (modelItem) => ({
                                        ...modelItem,
                                        units: removeFromArray(modelItem.units ?? [], unitIndex)
                                      }))
                                    })
                                  }
                                >
                                  Remove
                                </button>
                              </div>

                              <div className="form-grid">
                                <label>
                                  <span>ID</span>
                                  <input
                                    value={unit.id}
                                    onChange={(event) =>
                                      setDocumentState({
                                        ...documentState,
                                        ground_models: setInArray(groundModels, safeSelectedModelIndex, (modelItem) => ({
                                          ...modelItem,
                                          units: setInArray(modelItem.units ?? [], unitIndex, (unitItem) => ({
                                            ...unitItem,
                                            id: event.target.value
                                          }))
                                        }))
                                      })
                                    }
                                  />
                                </label>
                                <label>
                                  <span>Name</span>
                                  <input
                                    value={unit.name ?? ""}
                                    onChange={(event) =>
                                      setDocumentState({
                                        ...documentState,
                                        ground_models: setInArray(groundModels, safeSelectedModelIndex, (modelItem) => ({
                                          ...modelItem,
                                          units: setInArray(modelItem.units ?? [], unitIndex, (unitItem) => ({
                                            ...unitItem,
                                            name: event.target.value
                                          }))
                                        }))
                                      })
                                    }
                                  />
                                </label>
                                <label>
                                  <span>Material</span>
                                  <select
                                    value={unit.material_ref}
                                    onChange={(event) =>
                                      setDocumentState({
                                        ...documentState,
                                        ground_models: setInArray(groundModels, safeSelectedModelIndex, (modelItem) => ({
                                          ...modelItem,
                                          units: setInArray(modelItem.units ?? [], unitIndex, (unitItem) => ({
                                            ...unitItem,
                                            material_ref: event.target.value
                                          }))
                                        }))
                                      })
                                    }
                                  >
                                    <option value="">Select material</option>
                                    {materials.map((material) => (
                                      <option key={material.id} value={material.id}>
                                        {material.id}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label>
                                  <span>Top mAOD</span>
                                  <input
                                    type="number"
                                    value={unit.top_mAOD ?? ""}
                                    onChange={(event) =>
                                      setDocumentState({
                                        ...documentState,
                                        ground_models: setInArray(groundModels, safeSelectedModelIndex, (modelItem) => ({
                                          ...modelItem,
                                          units: setInArray(modelItem.units ?? [], unitIndex, (unitItem) => ({
                                            ...unitItem,
                                            top_mAOD: parseOptionalNumber(event.target.value)
                                          }))
                                        }))
                                      })
                                    }
                                  />
                                </label>
                                <label>
                                  <span>Base Mode</span>
                                  <select
                                    value={baseMode}
                                    onChange={(event) =>
                                      setDocumentState({
                                        ...documentState,
                                        ground_models: setInArray(groundModels, safeSelectedModelIndex, (modelItem) => ({
                                          ...modelItem,
                                          units: setInArray(modelItem.units ?? [], unitIndex, (unitItem) => ({
                                            ...unitItem,
                                            base:
                                              event.target.value === "model-base"
                                                ? "MODEL_BASE"
                                                : event.target.value === "unit-ref"
                                                  ? ""
                                                  : { mAOD: 0 }
                                          }))
                                        }))
                                      })
                                    }
                                  >
                                    <option value="model-base">MODEL_BASE</option>
                                    <option value="unit-ref">Unit reference</option>
                                    <option value="elevation">Elevation</option>
                                  </select>
                                </label>
                                <label>
                                  <span>Base Condition</span>
                                  <select
                                    value={unit.base_condition ?? ""}
                                    onChange={(event) =>
                                      setDocumentState({
                                        ...documentState,
                                        ground_models: setInArray(groundModels, safeSelectedModelIndex, (modelItem) => ({
                                          ...modelItem,
                                          units: setInArray(modelItem.units ?? [], unitIndex, (unitItem) => ({
                                            ...unitItem,
                                            base_condition: event.target.value
                                              ? (event.target.value as Condition)
                                              : undefined
                                          }))
                                        }))
                                      })
                                    }
                                  >
                                    <option value="">None</option>
                                    {CONDITIONS.map((condition) => (
                                      <option key={condition} value={condition}>
                                        {condition}
                                      </option>
                                    ))}
                                  </select>
                                </label>

                                {baseMode === "unit-ref" ? (
                                  <label className="full-width">
                                    <span>Base Unit ID</span>
                                    <input
                                      value={typeof unit.base === "string" && unit.base !== "MODEL_BASE" ? unit.base : ""}
                                      onChange={(event) =>
                                        setDocumentState({
                                          ...documentState,
                                          ground_models: setInArray(groundModels, safeSelectedModelIndex, (modelItem) => ({
                                            ...modelItem,
                                            units: setInArray(modelItem.units ?? [], unitIndex, (unitItem) => ({
                                              ...unitItem,
                                              base: event.target.value
                                            }))
                                          }))
                                        })
                                      }
                                    />
                                  </label>
                                ) : null}

                                {baseMode === "elevation" ? (
                                  <label className="full-width">
                                    <span>Base Elevation mAOD</span>
                                    <input
                                      type="number"
                                      value={typeof unit.base === "object" ? unit.base.mAOD : ""}
                                      onChange={(event) =>
                                        setDocumentState({
                                          ...documentState,
                                          ground_models: setInArray(groundModels, safeSelectedModelIndex, (modelItem) => ({
                                            ...modelItem,
                                            units: setInArray(modelItem.units ?? [], unitIndex, (unitItem) => ({
                                              ...unitItem,
                                              base: {
                                                mAOD: parseRequiredNumber(event.target.value)
                                              }
                                            }))
                                          }))
                                        })
                                      }
                                    />
                                  </label>
                                ) : null}

                                <label className="full-width">
                                  <span>Geometry WKT</span>
                                  <textarea
                                    rows={2}
                                    value={unit.geometry_wkt ?? ""}
                                    onChange={(event) =>
                                      setDocumentState({
                                        ...documentState,
                                        ground_models: setInArray(groundModels, safeSelectedModelIndex, (modelItem) => ({
                                          ...modelItem,
                                          units: setInArray(modelItem.units ?? [], unitIndex, (unitItem) => ({
                                            ...unitItem,
                                            geometry_wkt: event.target.value
                                          }))
                                        }))
                                      })
                                    }
                                  />
                                </label>
                                <label className="full-width">
                                  <span>Top Surface WKT</span>
                                  <textarea
                                    rows={2}
                                    value={unit.top_surface_wkt ?? ""}
                                    onChange={(event) =>
                                      setDocumentState({
                                        ...documentState,
                                        ground_models: setInArray(groundModels, safeSelectedModelIndex, (modelItem) => ({
                                          ...modelItem,
                                          units: setInArray(modelItem.units ?? [], unitIndex, (unitItem) => ({
                                            ...unitItem,
                                            top_surface_wkt: event.target.value
                                          }))
                                        }))
                                      })
                                    }
                                  />
                                </label>
                                <label className="full-width">
                                  <span>Volume WKT</span>
                                  <textarea
                                    rows={2}
                                    value={unit.volume_wkt ?? ""}
                                    onChange={(event) =>
                                      setDocumentState({
                                        ...documentState,
                                        ground_models: setInArray(groundModels, safeSelectedModelIndex, (modelItem) => ({
                                          ...modelItem,
                                          units: setInArray(modelItem.units ?? [], unitIndex, (unitItem) => ({
                                            ...unitItem,
                                            volume_wkt: event.target.value
                                          }))
                                        }))
                                      })
                                    }
                                  />
                                </label>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {activeTab === "review" ? (
        <section className="layout review-layout">
          <section className="card">
            <div className="section-head">
              <h2>Validation</h2>
            </div>
            {diagnostics.length === 0 ? (
              <p className="clean">No current validation issues.</p>
            ) : (
              <div className="stack compact">
                {diagnostics.map((diagnostic, index) => (
                  <div className="notice" key={`${diagnostic.code}-${index}`}>
                    <strong>{diagnostic.code}</strong>
                    <span>{diagnostic.path}</span>
                    <p>{diagnostic.message}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card">
            <div className="section-head">
              <h2>YAML Preview</h2>
            </div>
            <textarea readOnly rows={18} value={yamlText} />
          </section>

          <section className="card">
            <div className="section-head">
              <h2>AGSi Preview</h2>
            </div>
            <textarea readOnly rows={18} value={agsiText} />
          </section>
        </section>
      ) : null}

      {activeTab === "yaml" ? (
        <section className="stack">
          <section className="card">
            <div className="section-head">
              <div>
                <h2>Advanced YAML Editor</h2>
                <p className="section-copy">
                  Monaco is configured against the current Groundmodel schema for completion,
                  hover, and validation. Changes apply only when you confirm them.
                </p>
              </div>
              <div className="toolbar">
                <button type="button" onClick={applyYamlDraft}>
                  Apply YAML
                </button>
                <button type="button" onClick={resetYamlDraft}>
                  Reset Draft
                </button>
              </div>
            </div>
            {yamlError ? <section className="notice error">{yamlError}</section> : null}
            <div className="editor-frame">
              <Editor
                defaultLanguage="yaml"
                height="540px"
                language="yaml"
                options={{
                  automaticLayout: true,
                  minimap: { enabled: false },
                  fontSize: 14,
                  lineNumbersMinChars: 3,
                  padding: { top: 16, bottom: 16 },
                  scrollBeyondLastLine: false,
                  tabSize: 2,
                  wordWrap: "on"
                }}
                path="groundmodel.yaml"
                theme="vs"
                value={yamlDraft}
                onChange={(value) => {
                  setYamlDraft(value ?? "");
                  setYamlDirty(true);
                }}
              />
            </div>
          </section>

          <section className="overview-grid">
            <article className="card workflow-card">
              <div className="section-head">
                <h2>Draft Status</h2>
              </div>
              <div className="step-list">
                <div className="step-item">
                  <strong>{yamlDirty ? "Unsaved draft edits" : "Draft matches current model"}</strong>
                  <span>
                    {yamlDirty
                      ? "Apply the YAML to push changes back into the structured editor."
                      : "Structured tabs and YAML are in sync."}
                  </span>
                </div>
                <div className="step-item">
                  <strong>{diagnostics.length === 0 ? "No validation issues" : "Validation still runs on apply"}</strong>
                  <span>
                    Schema completion helps with shape, but project rules are still checked in the
                    Review tab.
                  </span>
                </div>
              </div>
            </article>

            <article className="card workflow-card">
              <div className="section-head">
                <h2>Current Validation Snapshot</h2>
              </div>
              {diagnostics.length === 0 ? (
                <p className="clean">No current validation issues.</p>
              ) : (
                <div className="stack compact">
                  {diagnostics.slice(0, 4).map((diagnostic, index) => (
                    <div className="notice" key={`${diagnostic.code}-${index}`}>
                      <strong>{diagnostic.code}</strong>
                      <span>{diagnostic.path}</span>
                      <p>{diagnostic.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </section>
        </section>
      ) : null}
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
