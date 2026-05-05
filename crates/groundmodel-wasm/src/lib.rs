use groundmodel_core::{ground_model_to_agsi_value, parse_yaml_str, validate_document};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn validate_yaml(input: &str) -> String {
    match parse_yaml_str(input) {
        Ok(doc) => {
            serde_json::to_string(&validate_document(&doc)).unwrap_or_else(|_| "[]".to_string())
        }
        Err(err) => format!(
            r#"[{{"code":"GMYAML","severity":"error","path":"$","message":"{}"}}]"#,
            err
        ),
    }
}

#[wasm_bindgen]
pub fn yaml_to_agsi_json(input: &str) -> String {
    match parse_yaml_str(input) {
        Ok(doc) => serde_json::to_string(&ground_model_to_agsi_value(&doc))
            .unwrap_or_else(|_| "{}".to_string()),
        Err(err) => format!(r#"{{"error":"{}"}}"#, err),
    }
}
