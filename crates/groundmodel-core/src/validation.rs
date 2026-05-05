use crate::model::{
    Applicability, BaseRef, Dimensionality, GroundModel, GroundModelDocument, Material,
    ParameterSet, SCHEMA_VERSION,
};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use wkt::Wkt;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub enum Severity {
    Error,
    Warning,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Diagnostic {
    pub code: &'static str,
    pub severity: Severity,
    pub path: String,
    pub message: String,
}

impl Diagnostic {
    fn error(code: &'static str, path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code,
            severity: Severity::Error,
            path: path.into(),
            message: message.into(),
        }
    }
}

const ALLOWED_DRAINAGE_KEYS: &[&str] = &["undrained", "drained", "total", "effective"];
const ALLOWED_PARAMETER_KEYS: &[&str] = &[
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
    "n_spt",
];

pub fn validate_document(doc: &GroundModelDocument) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    if doc.schema_version != SCHEMA_VERSION {
        diagnostics.push(Diagnostic::error(
            "GM000",
            "schema_version",
            format!(
                "unsupported schema_version `{}`; expected `{SCHEMA_VERSION}`",
                doc.schema_version
            ),
        ));
    }

    let materials_by_id: BTreeMap<_, _> =
        doc.materials.iter().map(|m| (m.id.as_str(), m)).collect();
    for (index, material) in doc.materials.iter().enumerate() {
        validate_material(material, index, &mut diagnostics);
    }

    for (index, model) in doc.ground_models.iter().enumerate() {
        validate_ground_model(model, index, &materials_by_id, &mut diagnostics);
    }

    diagnostics
}

fn validate_material(material: &Material, index: usize, diagnostics: &mut Vec<Diagnostic>) {
    for (drainage, params) in &material.parameter_sets {
        if !ALLOWED_DRAINAGE_KEYS.contains(&drainage.as_str()) {
            diagnostics.push(Diagnostic::error(
                "GM008",
                format!("materials[{index}].parameter_sets.{drainage}"),
                format!("unsupported drainage key `{drainage}`"),
            ));
        }
        validate_parameter_set(index, &material.id, drainage, params, diagnostics);
    }
}

fn validate_parameter_set(
    material_index: usize,
    material_id: &str,
    drainage: &str,
    params: &ParameterSet,
    diagnostics: &mut Vec<Diagnostic>,
) {
    for key in params.keys() {
        if !ALLOWED_PARAMETER_KEYS.contains(&key.as_str()) {
            diagnostics.push(Diagnostic::error(
                "GM009",
                format!("materials[{material_index}].parameter_sets.{drainage}.{key}"),
                format!("material `{material_id}` uses unsupported parameter key `{key}`"),
            ));
        }
    }
}

fn validate_ground_model(
    model: &GroundModel,
    model_index: usize,
    materials_by_id: &BTreeMap<&str, &Material>,
    diagnostics: &mut Vec<Diagnostic>,
) {
    if !materials_by_id.contains_key(model.model_base.material_ref.as_str()) {
        diagnostics.push(Diagnostic::error(
            "GM001",
            format!("ground_models[{model_index}].model_base.material_ref"),
            format!("unknown material_ref `{}`", model.model_base.material_ref),
        ));
    }

    validate_applicability(&model.applicability, model_index, diagnostics);

    if let Some(wkt) = &model.section_line_wkt {
        validate_wkt_slot(
            wkt,
            "LINESTRING",
            format!("ground_models[{model_index}].section_line_wkt"),
            diagnostics,
        );
    }

    let unit_ids: BTreeSet<_> = model.units.iter().map(|unit| unit.id.as_str()).collect();
    if unit_ids.len() != model.units.len() {
        diagnostics.push(Diagnostic::error(
            "GM007",
            format!("ground_models[{model_index}].units"),
            format!("ground model `{}` contains duplicate unit ids", model.id),
        ));
    }

    let mut prev_top: Option<f64> = None;
    let app_top = model.applicability.as_ref().and_then(|a| a.top_m_aod);
    let app_base = model.applicability.as_ref().and_then(|a| a.base_m_aod);

    for (unit_index, unit) in model.units.iter().enumerate() {
        let unit_path = format!("ground_models[{model_index}].units[{unit_index}]");
        if !materials_by_id.contains_key(unit.material_ref.as_str()) {
            diagnostics.push(Diagnostic::error(
                "GM001",
                format!("{unit_path}.material_ref"),
                format!("unknown material_ref `{}`", unit.material_ref),
            ));
        }

        if model.dimensionality == Dimensionality::OneD {
            match unit.top_m_aod {
                Some(top) => {
                    if let Some(previous) = prev_top
                        && top >= previous
                    {
                        diagnostics.push(Diagnostic::error(
                            "GM002",
                            format!("{unit_path}.top_mAOD"),
                            "unit top_mAOD must strictly decrease down the stack",
                        ));
                    }
                    if let Some(max_top) = app_top
                        && top > max_top
                    {
                        diagnostics.push(Diagnostic::error(
                            "GM002",
                            format!("{unit_path}.top_mAOD"),
                            "unit top_mAOD is above applicability.top_mAOD",
                        ));
                    }
                    if top <= model.model_base.elevation_m_aod {
                        diagnostics.push(Diagnostic::error(
                            "GM002",
                            format!("{unit_path}.top_mAOD"),
                            "unit top_mAOD must be above model_base.elevation_mAOD",
                        ));
                    }
                    prev_top = Some(top);
                }
                None => diagnostics.push(Diagnostic::error(
                    "GM002",
                    format!("{unit_path}.top_mAOD"),
                    "1D units must define top_mAOD",
                )),
            }
        }

        match &unit.base {
            BaseRef::ModelBase => {}
            BaseRef::Elevation { m_aod } => {
                if let Some(top) = unit.top_m_aod
                    && *m_aod >= top
                {
                    diagnostics.push(Diagnostic::error(
                        "GM003",
                        format!("{unit_path}.base"),
                        "unit base elevation must lie below top_mAOD",
                    ));
                }
                if *m_aod < model.model_base.elevation_m_aod {
                    diagnostics.push(Diagnostic::error(
                        "GM003",
                        format!("{unit_path}.base"),
                        "unit base elevation must not be below model_base.elevation_mAOD",
                    ));
                }
            }
            BaseRef::Unit(target_id) => match model.units.iter().find(|u| u.id == *target_id) {
                Some(target) => {
                    if let (Some(top), Some(target_top)) = (unit.top_m_aod, target.top_m_aod)
                        && target_top >= top
                    {
                        diagnostics.push(Diagnostic::error(
                            "GM003",
                            format!("{unit_path}.base"),
                            "unit base reference must point to a lower unit",
                        ));
                    }
                }
                None => diagnostics.push(Diagnostic::error(
                    "GM003",
                    format!("{unit_path}.base"),
                    format!("unknown unit base reference `{target_id}`"),
                )),
            },
        }

        if let Some(wkt) = &unit.geometry_wkt {
            validate_wkt_slot(
                wkt,
                "POLYGON",
                format!("{unit_path}.geometry_wkt"),
                diagnostics,
            );
        }
        if let Some(wkt) = &unit.top_surface_wkt {
            validate_wkt_slot(
                wkt,
                "TIN",
                format!("{unit_path}.top_surface_wkt"),
                diagnostics,
            );
        }
        if let Some(wkt) = &unit.volume_wkt {
            validate_wkt_slot(
                wkt,
                "POLYHEDRALSURFACE",
                format!("{unit_path}.volume_wkt"),
                diagnostics,
            );
        }
    }

    for (case_index, case_def) in model.cases.iter().enumerate() {
        let drainage_key = case_def.drainage.as_key();
        for unit in &model.units {
            if let Some(material) = materials_by_id.get(unit.material_ref.as_str())
                && !material.parameter_sets.contains_key(drainage_key)
            {
                diagnostics.push(Diagnostic::error(
                    "GM004",
                    format!("ground_models[{model_index}].cases[{case_index}].drainage"),
                    format!(
                        "case drainage `{drainage_key}` is missing from material `{}`",
                        material.id
                    ),
                ));
            }
        }
    }

    if let Some(gwl) = &model.groundwater_level {
        let model_top = model
            .units
            .iter()
            .filter_map(|unit| unit.top_m_aod)
            .fold(app_top.unwrap_or(f64::NEG_INFINITY), f64::max);
        let model_bottom = app_base.unwrap_or(model.model_base.elevation_m_aod);
        if gwl.elevation_m_aod < model_bottom || gwl.elevation_m_aod > model_top {
            diagnostics.push(Diagnostic::error(
                "GM005",
                format!("ground_models[{model_index}].groundwater_level.elevation_mAOD"),
                "groundwater level must be within the model vertical extent",
            ));
        }
    }
}

fn validate_applicability(
    applicability: &Option<Applicability>,
    model_index: usize,
    diagnostics: &mut Vec<Diagnostic>,
) {
    if let Some(applicability) = applicability {
        if let Some(wkt) = &applicability.plan_polygon_wkt {
            validate_wkt_slot(
                wkt,
                "POLYGON",
                format!("ground_models[{model_index}].applicability.plan_polygon_wkt"),
                diagnostics,
            );
        }
    }
}

fn validate_wkt_slot(
    raw_wkt: &str,
    expected_prefix: &str,
    path: String,
    diagnostics: &mut Vec<Diagnostic>,
) {
    if raw_wkt.parse::<Wkt<f64>>().is_err() {
        diagnostics.push(Diagnostic::error("GM006", path, "malformed WKT geometry"));
        return;
    }

    let normalized = raw_wkt.trim().to_ascii_uppercase();
    if !normalized.starts_with(expected_prefix) {
        diagnostics.push(Diagnostic::error(
            "GM006",
            path,
            format!("geometry must be a `{expected_prefix}` WKT"),
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::validate_document;
    use crate::parse_yaml_str;

    #[test]
    fn validates_minimal_valid_document() {
        let yaml = r#"
schema_version: "0.1.0"
project:
  id: EXAMPLE-01
  name: Example
  vertical_datum: mAOD
materials:
  - id: MAT-CLAY
    name: London Clay
    parameter_sets:
      undrained:
        gamma: 19
        cu: 75
ground_models:
  - id: GM-01
    name: Site-wide Ground Model
    model_base:
      elevation_mAOD: 20.0
      material_ref: MAT-CLAY
      condition: assumed
    units:
      - id: UNIT-CLAY
        material_ref: MAT-CLAY
        top_mAOD: 60.2
        base: MODEL_BASE
        base_condition: not_proven
    cases:
      - id: SLS-UND
        name: SLS - Undrained
        drainage: undrained
"#;

        let doc = parse_yaml_str(yaml).unwrap();
        let diagnostics = validate_document(&doc);
        assert!(diagnostics.is_empty(), "{diagnostics:#?}");
    }
}
