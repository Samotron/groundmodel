use crate::model::{
    BaseRef, Drainage, GroundModel, GroundModelDocument, GroundModelType, Material, ParameterValue,
    Project, SCHEMA_VERSION, Unit, UnitSystem, VerticalDatum,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;

const CODE_MAP: &[(&str, &str)] = &[
    ("gamma", "UnitWeight"),
    ("gamma_sat", "SaturatedUnitWeight"),
    ("gamma_dry", "DryUnitWeight"),
    ("cu", "UndrainedShearStrength"),
    ("phi_prime", "EffectiveFrictionAngle"),
    ("c_prime", "EffectiveCohesion"),
    ("phi_cv", "CriticalStateFrictionAngle"),
    ("e", "YoungsModulus"),
    ("eu", "UndrainedYoungsModulus"),
    ("g", "ShearModulus"),
    ("g0", "SmallStrainShearModulus"),
    ("nu", "PoissonsRatio"),
    ("k", "Permeability"),
    ("cv", "CoefficientOfConsolidation"),
    ("mv", "CoefficientOfVolumeCompr"),
    ("ocr", "OverconsolidationRatio"),
    ("k0", "EarthPressureCoeffAtRest"),
    ("vs", "ShearWaveVelocity"),
    ("qc", "ConePenetrationResistance"),
    ("n_spt", "SptN"),
];

pub fn ground_model_to_agsi_value(doc: &GroundModelDocument) -> Value {
    let material_lookup: BTreeMap<_, _> =
        doc.materials.iter().map(|m| (m.id.as_str(), m)).collect();
    json!({
        "agsSchema": { "name": "AGSi", "version": "1.0.1" },
        "agsFile": { "name": doc.project.name, "format": "groundmodel" },
        "agsProject": {
            "projectID": doc.project.id,
            "projectName": doc.project.name,
            "description": doc.project.description,
            "verticalDatum": datum_name(&doc.project.vertical_datum),
            "horizontalCRS": doc.project.horizontal_crs,
        },
        "agsiModel": doc.ground_models.iter().map(|model| model_to_agsi(model, &material_lookup)).collect::<Vec<_>>()
    })
}

fn model_to_agsi(model: &GroundModel, materials: &BTreeMap<&str, &Material>) -> Value {
    json!({
        "modelID": model.id,
        "modelName": model.name,
        "modelType": model_type_name(&model.r#type),
        "dimensionality": dimensionality_name(&model.dimensionality),
        "agsiModelBoundary": model.applicability.as_ref().map(|app| json!({
            "description": app.description,
            "planPolygonWKT": app.plan_polygon_wkt,
            "top_mAOD": app.top_m_aod,
            "base_mAOD": app.base_m_aod
        })),
        "groundwaterLevel": model.groundwater_level.as_ref().map(|gwl| gwl.elevation_m_aod),
        "modelBase": {
            "elevation_mAOD": model.model_base.elevation_m_aod,
            "materialRef": model.model_base.material_ref,
            "condition": format!("{:?}", model.model_base.condition),
        },
        "elements": model.units.iter().map(|unit| unit_to_agsi(unit, model, materials)).collect::<Vec<_>>(),
    })
}

fn unit_to_agsi(unit: &Unit, model: &GroundModel, materials: &BTreeMap<&str, &Material>) -> Value {
    let parameters = materials
        .get(unit.material_ref.as_str())
        .into_iter()
        .flat_map(|material| {
            model.cases.iter().filter_map(move |case_def| {
                material
                    .parameter_sets
                    .get(case_def.drainage.as_key())
                    .map(|set| {
                        set.iter()
                            .filter_map(|(key, value)| {
                                code_for(key).map(|code| {
                                    json!({
                                        "codeID": code,
                                        "caseID": case_def.id,
                                        "drainage": case_def.drainage.as_key(),
                                        "value": parameter_to_json(value),
                                    })
                                })
                            })
                            .collect::<Vec<_>>()
                    })
            })
        })
        .flatten()
        .collect::<Vec<_>>();

    json!({
        "elementID": unit.id,
        "name": unit.name,
        "materialRef": unit.material_ref,
        "top_mAOD": unit.top_m_aod,
        "base": match &unit.base {
            BaseRef::ModelBase => json!("MODEL_BASE"),
            BaseRef::Unit(unit_id) => json!(unit_id),
            BaseRef::Elevation { m_aod } => json!({ "mAOD": m_aod }),
        },
        "baseCondition": unit.base_condition.as_ref().map(|c| format!("{:?}", c)),
        "geometryWKT": unit.geometry_wkt,
        "topSurfaceWKT": unit.top_surface_wkt,
        "volumeWKT": unit.volume_wkt,
        "agsiDataParameterValue": parameters,
    })
}

fn parameter_to_json(value: &ParameterValue) -> Value {
    match value {
        ParameterValue::Scalar(value) => json!(value),
        ParameterValue::Range(range) => json!({
            "value": range.value,
            "min": range.min,
            "max": range.max,
            "char": range.char,
        }),
    }
}

fn code_for(key: &str) -> Option<&'static str> {
    CODE_MAP
        .iter()
        .find_map(|(yaml, agsi)| (*yaml == key).then_some(*agsi))
}

fn key_for(code: &str) -> Option<&'static str> {
    CODE_MAP
        .iter()
        .find_map(|(yaml, agsi)| (*agsi == code).then_some(*yaml))
}

fn datum_name(datum: &VerticalDatum) -> &'static str {
    match datum {
        VerticalDatum::MAod => "mAOD",
        VerticalDatum::MOd => "mOD",
        VerticalDatum::MAsl => "mASL",
        VerticalDatum::MBgl => "mBGL",
        VerticalDatum::Local => "local",
    }
}

fn model_type_name(model_type: &GroundModelType) -> &'static str {
    match model_type {
        GroundModelType::Observational => "observational",
        GroundModelType::Design => "design",
        GroundModelType::Hydrogeological => "hydrogeological",
    }
}

fn dimensionality_name(dimensionality: &crate::model::Dimensionality) -> &'static str {
    match dimensionality {
        crate::model::Dimensionality::OneD => "1D",
        crate::model::Dimensionality::TwoD => "2D",
        crate::model::Dimensionality::ThreeD => "3D",
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AgsiRoot {
    #[serde(rename = "agsProject")]
    ags_project: AgsiProject,
    #[serde(rename = "agsiModel", default)]
    agsi_model: Vec<AgsiModel>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AgsiProject {
    #[serde(rename = "projectID")]
    project_id: String,
    #[serde(rename = "projectName")]
    project_name: String,
    description: Option<String>,
    #[serde(rename = "verticalDatum")]
    vertical_datum: Option<String>,
    #[serde(rename = "horizontalCRS")]
    horizontal_crs: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AgsiModel {
    #[serde(rename = "modelID")]
    model_id: String,
    #[serde(rename = "modelName")]
    model_name: String,
    #[serde(rename = "elements", default)]
    elements: Vec<AgsiElement>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AgsiElement {
    #[serde(rename = "elementID")]
    element_id: String,
    name: Option<String>,
    #[serde(rename = "materialRef")]
    material_ref: String,
    #[serde(rename = "top_mAOD")]
    top_m_aod: Option<f64>,
    base: Option<BaseRef>,
    #[serde(rename = "agsiDataParameterValue", default)]
    agsi_data_parameter_value: Vec<AgsiParameter>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(deny_unknown_fields)]
struct AgsiParameter {
    #[serde(rename = "codeID")]
    code_id: String,
    #[serde(rename = "caseID")]
    case_id: String,
    drainage: String,
    value: Value,
}

pub fn ground_model_from_agsi_str(input: &str) -> Result<GroundModelDocument, serde_json::Error> {
    let agsi: AgsiRoot = serde_json::from_str(input)?;
    let mut materials_by_id: BTreeMap<String, Material> = BTreeMap::new();
    let mut ground_models = Vec::new();

    for model in agsi.agsi_model {
        let mut units = Vec::new();
        let mut cases: BTreeMap<String, Drainage> = BTreeMap::new();

        for element in model.elements {
            let material = materials_by_id
                .entry(element.material_ref.clone())
                .or_insert(Material {
                    id: element.material_ref.clone(),
                    name: element.material_ref.clone(),
                    description: None,
                    color: None,
                    hatch: None,
                    parameter_sets: BTreeMap::new(),
                });

            for param in &element.agsi_data_parameter_value {
                if let Some(key) = key_for(&param.code_id) {
                    let parsed = if param.value.is_number() {
                        ParameterValue::Scalar(param.value.as_f64().unwrap_or_default())
                    } else {
                        serde_json::from_value(param.value.clone())
                            .unwrap_or(ParameterValue::Scalar(0.0))
                    };
                    material
                        .parameter_sets
                        .entry(param.drainage.clone())
                        .or_default()
                        .insert(key.to_string(), parsed);
                    cases
                        .entry(param.case_id.clone())
                        .or_insert(match param.drainage.as_str() {
                            "drained" => Drainage::Drained,
                            "total" => Drainage::Total,
                            "effective" => Drainage::Effective,
                            _ => Drainage::Undrained,
                        });
                }
            }

            units.push(Unit {
                id: element.element_id,
                name: element.name,
                material_ref: element.material_ref,
                top_m_aod: element.top_m_aod,
                base: element.base.unwrap_or(BaseRef::ModelBase),
                base_condition: None,
                geometry_wkt: None,
                top_surface_wkt: None,
                volume_wkt: None,
            });
        }

        ground_models.push(GroundModel {
            id: model.model_id,
            name: model.model_name,
            r#type: GroundModelType::Design,
            dimensionality: crate::model::Dimensionality::OneD,
            applicability: None,
            groundwater_level: None,
            model_base: crate::model::ModelBase {
                elevation_m_aod: 0.0,
                material_ref: units
                    .first()
                    .map(|unit| unit.material_ref.clone())
                    .unwrap_or_else(|| "UNKNOWN".to_string()),
                condition: crate::model::Condition::Assumed,
            },
            units,
            cases: cases
                .into_iter()
                .map(|(id, drainage)| crate::model::Case {
                    name: id.clone(),
                    id,
                    drainage,
                })
                .collect(),
            section_line_wkt: None,
        });
    }

    Ok(GroundModelDocument {
        schema_version: SCHEMA_VERSION.to_string(),
        project: Project {
            id: agsi.ags_project.project_id,
            name: agsi.ags_project.project_name,
            description: agsi.ags_project.description,
            vertical_datum: match agsi.ags_project.vertical_datum.as_deref() {
                Some("mOD") => VerticalDatum::MOd,
                Some("mASL") => VerticalDatum::MAsl,
                Some("mBGL") => VerticalDatum::MBgl,
                Some("local") => VerticalDatum::Local,
                _ => VerticalDatum::MAod,
            },
            horizontal_crs: agsi.ags_project.horizontal_crs,
            units: UnitSystem::Si,
        },
        materials: materials_by_id.into_values().collect(),
        ground_models,
    })
}
