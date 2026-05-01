import Ajv2020 from "ajv/dist/2020";

import schema from "../../../data/schema.json";

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

export const extractionTool = {
  name: "emit_clinical_extraction",
  description: "Emit a schema-conformant structured extraction for one clinical transcript.",
  input_schema: schema,
};

export function validateExtraction(value: unknown): { valid: boolean; errors: string[] } {
  const valid = validate(value);
  const errors =
    validate.errors?.map((error) => {
      const path = error.instancePath || "/";
      return `${path} ${error.message ?? "is invalid"}`;
    }) ?? [];

  return { valid, errors };
}
