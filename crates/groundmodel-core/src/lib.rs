pub mod agsi;
pub mod model;
pub mod schema;
pub mod validation;

pub use agsi::{ground_model_from_agsi_str, ground_model_to_agsi_value};
pub use model::GroundModelDocument;
pub use schema::json_schema_pretty;
pub use validation::{Diagnostic, Severity, validate_document};

use thiserror::Error;

#[derive(Debug, Error)]
pub enum GroundModelError {
    #[error("yaml parse error: {0}")]
    Yaml(#[from] serde_yaml::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

pub fn parse_yaml_str(input: &str) -> Result<GroundModelDocument, GroundModelError> {
    Ok(serde_yaml::from_str(input)?)
}
