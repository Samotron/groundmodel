use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand};
use groundmodel_core::{
    Severity, ground_model_from_agsi_str, ground_model_to_agsi_value, json_schema_pretty,
    parse_yaml_str, validate_document,
};
use std::{fs, path::PathBuf};

#[derive(Debug, Parser)]
#[command(name = "groundmodel")]
#[command(about = "Ground model authoring, validation, and conversion toolkit")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Validate {
        input: PathBuf,
    },
    Schema {
        #[arg(short, long)]
        output: Option<PathBuf>,
    },
    ToAgsi {
        input: PathBuf,
        #[arg(short, long)]
        output: Option<PathBuf>,
    },
    FromAgsi {
        input: PathBuf,
        #[arg(short, long)]
        output: Option<PathBuf>,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Validate { input } => validate(&input),
        Command::Schema { output } => write_text(json_schema_pretty()?, output),
        Command::ToAgsi { input, output } => to_agsi(&input, output),
        Command::FromAgsi { input, output } => from_agsi(&input, output),
    }
}

fn validate(input: &PathBuf) -> Result<()> {
    let text =
        fs::read_to_string(input).with_context(|| format!("failed to read {}", input.display()))?;
    let doc = parse_yaml_str(&text)?;
    let diagnostics = validate_document(&doc);
    for diag in &diagnostics {
        let severity = match diag.severity {
            Severity::Error => "error",
            Severity::Warning => "warning",
        };
        println!("{} {} {}: {}", severity, diag.code, diag.path, diag.message);
    }
    if diagnostics
        .iter()
        .any(|diag| matches!(diag.severity, Severity::Error))
    {
        bail!("validation failed");
    }
    println!("validation passed");
    Ok(())
}

fn to_agsi(input: &PathBuf, output: Option<PathBuf>) -> Result<()> {
    let text =
        fs::read_to_string(input).with_context(|| format!("failed to read {}", input.display()))?;
    let doc = parse_yaml_str(&text)?;
    let agsi = serde_json::to_string_pretty(&ground_model_to_agsi_value(&doc))?;
    write_text(agsi, output)
}

fn from_agsi(input: &PathBuf, output: Option<PathBuf>) -> Result<()> {
    let text =
        fs::read_to_string(input).with_context(|| format!("failed to read {}", input.display()))?;
    let doc = ground_model_from_agsi_str(&text)?;
    let yaml = serde_yaml::to_string(&doc)?;
    write_text(yaml, output)
}

fn write_text(text: String, output: Option<PathBuf>) -> Result<()> {
    if let Some(path) = output {
        fs::write(&path, text).with_context(|| format!("failed to write {}", path.display()))?;
    } else {
        print!("{text}");
    }
    Ok(())
}
