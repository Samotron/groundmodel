use schemars::JsonSchema;
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeMap;

pub const SCHEMA_VERSION: &str = "0.1.0";

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct GroundModelDocument {
    pub schema_version: String,
    pub project: Project,
    #[serde(default)]
    pub materials: Vec<Material>,
    #[serde(default)]
    pub ground_models: Vec<GroundModel>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub vertical_datum: VerticalDatum,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub horizontal_crs: Option<String>,
    #[serde(default)]
    pub units: UnitSystem,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum UnitSystem {
    #[default]
    #[serde(rename = "SI")]
    Si,
    Imperial,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Material {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hatch: Option<String>,
    #[serde(default)]
    pub parameter_sets: BTreeMap<String, ParameterSet>,
}

pub type ParameterSet = BTreeMap<String, ParameterValue>;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum ParameterValue {
    Scalar(f64),
    Range(ParameterRange),
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ParameterRange {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub char: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct GroundModel {
    pub id: String,
    pub name: String,
    #[serde(default = "default_model_type")]
    pub r#type: GroundModelType,
    #[serde(default)]
    pub dimensionality: Dimensionality,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub applicability: Option<Applicability>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub groundwater_level: Option<GroundwaterLevel>,
    pub model_base: ModelBase,
    #[serde(default)]
    pub units: Vec<Unit>,
    #[serde(default)]
    pub cases: Vec<Case>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub section_line_wkt: Option<String>,
}

fn default_model_type() -> GroundModelType {
    GroundModelType::Design
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq, Default)]
pub enum GroundModelType {
    #[serde(rename = "observational")]
    Observational,
    #[default]
    #[serde(rename = "design")]
    Design,
    #[serde(rename = "hydrogeological")]
    Hydrogeological,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq, Default)]
pub enum Dimensionality {
    #[default]
    #[serde(rename = "1D")]
    OneD,
    #[serde(rename = "2D")]
    TwoD,
    #[serde(rename = "3D")]
    ThreeD,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Applicability {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_polygon_wkt: Option<String>,
    #[serde(rename = "top_mAOD", default, skip_serializing_if = "Option::is_none")]
    pub top_m_aod: Option<f64>,
    #[serde(rename = "base_mAOD", default, skip_serializing_if = "Option::is_none")]
    pub base_m_aod: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct GroundwaterLevel {
    #[serde(rename = "elevation_mAOD")]
    pub elevation_m_aod: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ModelBase {
    #[serde(rename = "elevation_mAOD")]
    pub elevation_m_aod: f64,
    pub material_ref: String,
    pub condition: Condition,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Unit {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub material_ref: String,
    #[serde(rename = "top_mAOD", default, skip_serializing_if = "Option::is_none")]
    pub top_m_aod: Option<f64>,
    pub base: BaseRef,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_condition: Option<Condition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub geometry_wkt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top_surface_wkt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volume_wkt: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Case {
    pub id: String,
    pub name: String,
    pub drainage: Drainage,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub enum VerticalDatum {
    #[serde(rename = "mAOD")]
    MAod,
    #[serde(rename = "mOD")]
    MOd,
    #[serde(rename = "mASL")]
    MAsl,
    #[serde(rename = "mBGL")]
    MBgl,
    #[serde(rename = "local")]
    Local,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub enum Condition {
    #[serde(rename = "proven")]
    Proven,
    #[serde(rename = "not_proven")]
    NotProven,
    #[serde(rename = "assumed")]
    Assumed,
    #[serde(rename = "inferred")]
    Inferred,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub enum Drainage {
    #[serde(rename = "undrained")]
    Undrained,
    #[serde(rename = "drained")]
    Drained,
    #[serde(rename = "total")]
    Total,
    #[serde(rename = "effective")]
    Effective,
}

impl Drainage {
    pub fn as_key(&self) -> &'static str {
        match self {
            Self::Undrained => "undrained",
            Self::Drained => "drained",
            Self::Total => "total",
            Self::Effective => "effective",
        }
    }
}

#[derive(Debug, Clone, JsonSchema)]
pub enum BaseRef {
    ModelBase,
    Unit(String),
    Elevation { m_aod: f64 },
}

impl Serialize for BaseRef {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            Self::ModelBase => serializer.serialize_str("MODEL_BASE"),
            Self::Unit(value) => serializer.serialize_str(value),
            Self::Elevation { m_aod } => {
                use serde::ser::SerializeMap;
                let mut map = serializer.serialize_map(Some(1))?;
                map.serialize_entry("mAOD", m_aod)?;
                map.end()
            }
        }
    }
}

impl<'de> Deserialize<'de> for BaseRef {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum RawBaseRef {
            Text(String),
            Elevation {
                #[serde(rename = "mAOD")]
                m_aod: f64,
            },
        }

        match RawBaseRef::deserialize(deserializer)? {
            RawBaseRef::Text(text) if text == "MODEL_BASE" => Ok(BaseRef::ModelBase),
            RawBaseRef::Text(text) => Ok(BaseRef::Unit(text)),
            RawBaseRef::Elevation { m_aod } => Ok(BaseRef::Elevation { m_aod }),
        }
    }
}
