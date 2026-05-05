use groundmodel_core::{ground_model_to_agsi_value, parse_yaml_str, validate_document};
use pyo3::prelude::*;

#[pyfunction]
fn validate_yaml(input: &str) -> PyResult<String> {
    let doc = parse_yaml_str(input)
        .map_err(|err| pyo3::exceptions::PyValueError::new_err(err.to_string()))?;
    serde_json::to_string(&validate_document(&doc))
        .map_err(|err| pyo3::exceptions::PyRuntimeError::new_err(err.to_string()))
}

#[pyfunction]
fn yaml_to_agsi_json(input: &str) -> PyResult<String> {
    let doc = parse_yaml_str(input)
        .map_err(|err| pyo3::exceptions::PyValueError::new_err(err.to_string()))?;
    serde_json::to_string(&ground_model_to_agsi_value(&doc))
        .map_err(|err| pyo3::exceptions::PyRuntimeError::new_err(err.to_string()))
}

#[pymodule]
fn groundmodel(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(validate_yaml, m)?)?;
    m.add_function(wrap_pyfunction!(yaml_to_agsi_json, m)?)?;
    Ok(())
}
