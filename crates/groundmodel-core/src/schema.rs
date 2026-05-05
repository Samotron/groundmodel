use crate::model::GroundModelDocument;
use schemars::schema_for;

pub fn json_schema_pretty() -> Result<String, serde_json::Error> {
    serde_json::to_string_pretty(&schema_for!(GroundModelDocument))
}
