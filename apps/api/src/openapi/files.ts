import openapiTS, { astToString } from 'openapi-typescript';
import type { OpenAPI3 } from 'openapi-typescript';
import { buildOpenApiDocument, serializeOpenApi } from './build';

/** Repo-relative path -> content of every generated file. */
export const SPEC_PATH = 'apps/api/openapi/openapi.json';
export const CLIENT_SCHEMA_PATH = 'packages/api-client/src/schema.ts';

const HEADER = `// GENERATED from apps/api/openapi/openapi.json by \`pnpm openapi:generate\`. Do not edit by hand.\n`;

export async function buildGeneratedFiles(): Promise<Record<string, string>> {
  const doc = buildOpenApiDocument();
  const ast = await openapiTS(doc as unknown as OpenAPI3, { alphabetize: true });
  return {
    [SPEC_PATH]: serializeOpenApi(doc),
    [CLIENT_SCHEMA_PATH]: `${HEADER}${astToString(ast)}`,
  };
}
