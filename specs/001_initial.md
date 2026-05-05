
A rust cli tool, with seperate python bindings and react application hosted on github pages.

the tool is for hte creation, validataion etc of groundmodels, and follows the yaml fomrmat below. It will need this feautes.

+ conversion to and from AGSi
+ viewing information as strip logs
+ other stuff!


```yaml
schema_version: "0.1.0"
project:
  id: "EXAMPLE-01"
  name: "Worked Orchard Example"
  vertical_datum: "mAOD"

materials:
  - id: "MAT-CLAY"
    name: "London Clay"
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
```
```
```
