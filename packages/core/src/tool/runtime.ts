import type { ToolDefinition } from "@opencode/ai"
import { Tool } from "@opencode/schema/tool"
import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec"
import { Cache, Effect, JsonSchema, Schema, SchemaIssue, SchemaRepresentation } from "effect"
import { $ZodType, toJSONSchema } from "zod/v4/core"

const formatEffectIssues = SchemaIssue.makeFormatterStandardSchemaV1()

const jsonSchemas = Effect.runSync(
  Cache.make<JsonSchema.JsonSchema, Schema.Codec<unknown> | undefined>({
    capacity: 100,
    lookup: (schema) =>
      Effect.try({
        try: () => jsonSchema(schema),
        catch: () => undefined,
      }).pipe(Effect.orElseSucceed(() => undefined)),
  }),
)

export const definition = (tool: Tool.Info<any, any>): ToolDefinition => ({
  type: "tool",
  name: effectiveName(tool),
  description: tool.description,
  inputSchema: inputJsonSchema(tool.input),
  ...(tool.output === undefined ? {} : { outputSchema: outputJsonSchema(tool.output) }),
  ...(tool.native === undefined ? {} : { native: tool.native }),
})

export const execute = (tool: Tool.Info<any, any>, input: unknown, context: Tool.Context) =>
  Effect.gen(function* () {
    const decoded = yield* decodeInput(tool, input)
    // Tool implementations declare `Tool.Error` but plugins can fail with anything at
    // runtime. A foreign typed failure would slip past every `catchTag("Tool.Error")`
    // downstream and leave its call permanently unsettled, so the declared contract is
    // enforced here at the untrusted boundary. Declines tunnel through as defects and
    // interrupts are not errors; neither is touched.
    const result = yield* tool.execute(decoded, context).pipe(
      Effect.mapError((error: unknown) =>
        error instanceof Tool.Error
          ? error
          : new Tool.Error({
              message: error instanceof globalThis.Error ? error.message : String(error),
            }),
      ),
    )
    if (tool.output === undefined) {
      if ("output" in result) return yield* Effect.die("Tool result declared output without an output schema")
      return {
        output: undefined,
        content: normalizeContent(result.content),
        ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
      }
    }
    if (!("output" in result)) return yield* new Tool.Error({ message: "Tool did not return its declared output" })
    const output = yield* encodeOutput(tool.output, result.output)
    return {
      output,
      content: normalizeContent(result.content, output),
      ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
    }
  })

const decodeInput = (tool: Tool.Info<any, any>, value: unknown) =>
  Effect.gen(function* () {
    const result = yield* validateInput(tool.input, value)
    if (!result.issues) return result.value
    // A vendor schema without JSON Schema support still fails with its issues, just without the shape hint.
    const schema = yield* Effect.try(() => inputJsonSchema(tool.input)).pipe(Effect.orElseSucceed(() => ({})))
    return yield* new Tool.Error({ message: formatInputIssues(effectiveName(tool), result.issues, value, schema) })
  })

const validateInput = (
  schema: Tool.ValueSchema<any>,
  value: unknown,
): Effect.Effect<StandardSchemaV1.Result<unknown>> => {
  if (isStandardSchema(schema)) return validateStandard(schema, value)
  return Effect.gen(function* () {
    const codec = Schema.isSchema(schema) ? schema : yield* Cache.get(jsonSchemas, schema)
    if (codec === undefined) return { value }
    return yield* Schema.decodeUnknownEffect(codec)(value, { errors: "all" }).pipe(
      Effect.match({
        onFailure: (error) => formatEffectIssues(error.issue),
        onSuccess: (value) => ({ value }),
      }),
    )
  })
}

const formatInputIssues = (
  tool: string,
  issues: ReadonlyArray<StandardSchemaV1.Issue>,
  value: unknown,
  schema: JsonSchema.JsonSchema,
) => {
  const details = issues.slice(0, 5).map((issue) => {
    const path =
      issue.path?.reduce<string>((path, segment) => {
        const key = typeof segment === "object" ? segment.key : segment
        if (typeof key === "number") return `${path}[${key}]`
        return path === "" ? String(key) : `${path}.${String(key)}`
      }, "") || "root"
    return `- ${path}: ${issue.message}`
  })
  if (issues.length > 5) details.push(`- ...and ${issues.length - 5} more ${issues.length === 6 ? "issue" : "issues"}`)
  const expected = signature(schema)
  return [
    `Invalid arguments for tool "${tool}":`,
    ...details,
    ...(expected === undefined ? [] : ["", `Expected arguments: ${expected}`]),
    "",
    "Arguments provided:",
    JSON.stringify(shorten(value), null, 2),
    "",
    "Update the arguments and call the tool again.",
  ].join("\n")
}

// One line per field, `name: type` with `?` for optional and enum values inline, so a model that
// guessed the shape sees the real one without re-reading the whole tool description.
const signature = (schema: JsonSchema.JsonSchema) => {
  if (!isRecord(schema.properties)) return undefined
  const required = Array.isArray(schema.required) ? schema.required : []
  const fields = Object.entries(schema.properties).map(
    ([key, property]) => `${key}${required.includes(key) ? "" : "?"}: ${typeName(property)}`,
  )
  return fields.length === 0 ? undefined : `{ ${fields.join(", ")} }`
}

const typeName = (property: unknown): string => {
  if (!isRecord(property)) return "unknown"
  if (Array.isArray(property.enum)) return property.enum.map((item) => JSON.stringify(item)).join(" | ")
  if ("const" in property) return JSON.stringify(property.const)
  if (typeof property.$ref === "string") return property.$ref.slice(property.$ref.lastIndexOf("/") + 1)
  const branches = Array.isArray(property.anyOf) ? property.anyOf : Array.isArray(property.oneOf) ? property.oneOf : []
  if (branches.length > 0) return branches.map(typeName).join(" | ")
  if (property.type === "array") return `${typeName(property.items)}[]`
  if (Array.isArray(property.type)) return property.type.join(" | ")
  return typeof property.type === "string" ? property.type : "unknown"
}

// The echo exists to show the shape the model sent. A rejected write with a whole file in it used
// to come back verbatim and double the tokens of the failed step.
const SHORTENED_DEPTH = "[maximum depth reached]"
const MAX_SHORTENED_ENTRIES = 50

const shorten = (value: unknown, depth = 0): unknown => {
  if (typeof value === "string")
    return value.length > 300 ? `${value.slice(0, 200)}... [${value.length - 200} more characters]` : value
  if (depth > 6) return SHORTENED_DEPTH
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_SHORTENED_ENTRIES).map((item) => shorten(item, depth + 1))
    if (value.length > MAX_SHORTENED_ENTRIES)
      items.push(`...${value.length - MAX_SHORTENED_ENTRIES} additional entries omitted`)
    return items
  }
  if (isRecord(value)) {
    const entries = Object.entries(value)
    const shortened = entries
      .slice(0, MAX_SHORTENED_ENTRIES)
      .map(([key, item]) => [key, shorten(item, depth + 1)])
    if (entries.length > MAX_SHORTENED_ENTRIES)
      shortened.push(["...", `${entries.length - MAX_SHORTENED_ENTRIES} additional entries omitted`])
    return Object.fromEntries(shortened)
  }
  return value
}

const jsonSchema = (schema: JsonSchema.JsonSchema) => {
  const draft =
    (typeof schema.$schema === "string" && schema.$schema.includes("draft-07")) || "definitions" in schema
      ? JsonSchema.fromSchemaDraft07(schema)
      : JsonSchema.fromSchemaDraft2020_12(schema)
  return Schema.make<Schema.Codec<unknown>>(SchemaRepresentation.fromJsonSchemaDocument(draft).ast)
}

const encodeOutput = (schema: Tool.ValueSchema<any>, value: unknown) => {
  if (Schema.isSchema(schema))
    return Schema.encodeEffect(schema)(value).pipe(
      Effect.mapError(
        (error) =>
          new Tool.Error({ message: `Tool returned an invalid value for its output schema: ${error.message}` }),
      ),
    )
  if (isStandardSchema(schema))
    return validateStandard(schema, value).pipe(
      Effect.flatMap((result) =>
        result.issues
          ? new Tool.Error({
              message: `Tool returned an invalid value for its output schema: ${result.issues.map((issue) => issue.message).join(", ")}`,
            })
          : Effect.succeed(result.value),
      ),
    )
  return Schema.decodeUnknownEffect(Schema.Json)(value).pipe(
    Effect.mapError(
      (error) => new Tool.Error({ message: `Tool returned a non-JSON value for its output schema: ${error.message}` }),
    ),
  )
}

const isStandardSchema = (schema: Tool.ValueSchema<any>): schema is StandardSchemaV1<any, any> =>
  typeof schema === "object" && schema !== null && "~standard" in schema

const isStandardJSONSchema = (
  schema: StandardSchemaV1<any, any>,
): schema is StandardSchemaV1<any, any> & StandardJSONSchemaV1<any, any> => "jsonSchema" in schema["~standard"]

const validateStandard = (
  schema: StandardSchemaV1<any, any>,
  value: unknown,
): Effect.Effect<StandardSchemaV1.Result<unknown>> =>
  Effect.gen(function* () {
    const result = yield* Effect.try({ try: () => schema["~standard"].validate(value), catch: (error) => error })
    return result instanceof Promise ? yield* Effect.tryPromise({ try: () => result, catch: (error) => error }) : result
  }).pipe(
    Effect.match({
      onFailure: (error) => ({ issues: [{ message: error instanceof Error ? error.message : String(error) }] }),
      onSuccess: (result) => result,
    }),
  )

const inputJsonSchema = (schema: Tool.ValueSchema<any>): JsonSchema.JsonSchema => {
  if (schema === undefined || schema === null) return {}
  if (isStandardSchema(schema)) return standardJsonSchema(schema, "input")
  return Schema.isSchema(schema) ? toJsonSchema(schema) : schema
}

const outputJsonSchema = (schema: Tool.ValueSchema<any>): JsonSchema.JsonSchema => {
  if (isStandardSchema(schema)) return standardJsonSchema(schema, "output")
  return Schema.isSchema(schema) ? toJsonSchema(schema) : schema
}

const standardJsonSchema = (schema: StandardSchemaV1<any, any>, io: "input" | "output"): JsonSchema.JsonSchema => {
  if (isStandardJSONSchema(schema)) return schema["~standard"].jsonSchema[io]({ target: "draft-2020-12" })
  if (schema instanceof $ZodType) return toJSONSchema(schema, { target: "draft-2020-12", io })
  throw new Error(`Schema vendor "${schema["~standard"].vendor}" does not support JSON Schema conversion`)
}

const toJsonSchema = (schema: Schema.Top): JsonSchema.JsonSchema => {
  const document = Schema.toJsonSchemaDocument(schema)
  // Effect emits valid JSON Schema that some inference providers handle poorly. Simplify it
  // without changing validation: `{ type: "integer", allOf: [{ minimum: 0 }] }` becomes
  // `{ type: "integer", minimum: 0 }` only when no keyword would be overwritten. Named schemas
  // emit `$ref` plus root `$defs`; inline acyclic local references so providers receive the full
  // nested schema directly, then remove unused `$defs`. Recursive references stay intact because
  // expanding them would never terminate.
  const normalized = flattenAllOf(
    Object.keys(document.definitions).length === 0
      ? document.schema
      : { ...document.schema, $defs: document.definitions },
  )
  return dropDefinitionsIfResolved(inlineLocalReferences(normalized)) as JsonSchema.JsonSchema
}

const flattenAllOf = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(flattenAllOf)
  if (typeof value !== "object" || value === null) return value

  const schema = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, flattenAllOf(item)]))
  if (!Array.isArray(schema.allOf) || !schema.allOf.every(isRecord) || !canFlattenAllOf(schema.allOf, schema))
    return schema
  const { allOf, ...rest } = schema
  return flattenAllOf({ ...Object.assign({}, ...allOf), ...rest })
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const canFlattenAllOf = (allOf: ReadonlyArray<Record<string, unknown>>, parent: Record<string, unknown>) => {
  const keys = new Set(Object.keys(parent).filter((key) => key !== "allOf"))
  return allOf.every((item) =>
    Object.keys(item).every((key) => {
      if (keys.has(key)) return false
      keys.add(key)
      return true
    }),
  )
}

const inlineLocalReferences = (
  value: unknown,
  definitions?: Record<string, unknown>,
  seen = new Set<string>(),
): unknown => {
  if (Array.isArray(value)) return value.map((item) => inlineLocalReferences(item, definitions, seen))
  if (!isRecord(value)) return value

  const localDefinitions = definitions ?? (isRecord(value.$defs) ? value.$defs : undefined)
  if (typeof value.$ref === "string" && localDefinitions) {
    const segment = value.$ref.match(/^#\/\$defs\/([^/]+)$/)?.[1]
    const name = segment?.replaceAll("~1", "/").replaceAll("~0", "~")
    if (name && !seen.has(name)) {
      const target = localDefinitions[name]
      if (target) {
        const { $ref: _, ...rest } = value
        const resolvedTarget = inlineLocalReferences(target, localDefinitions, new Set(seen).add(name))
        const resolvedSiblings = inlineLocalReferences(rest, localDefinitions, seen)
        if (!isRecord(resolvedTarget) || !isRecord(resolvedSiblings)) return resolvedTarget
        if (canMergeRecords(resolvedTarget, resolvedSiblings)) return { ...resolvedTarget, ...resolvedSiblings }
        return { allOf: [resolvedTarget, resolvedSiblings] }
      }
    }
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, inlineLocalReferences(item, localDefinitions, seen)]),
  )
}

const canMergeRecords = (left: Record<string, unknown>, right: Record<string, unknown>) =>
  Object.keys(left).every((key) => !(key in right))

const dropDefinitionsIfResolved = (value: unknown): unknown => {
  if (!isRecord(value) || hasLocalReference(value)) return value
  const { $defs: _, ...rest } = value
  return rest
}

const hasLocalReference = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasLocalReference)
  if (!isRecord(value)) return false
  if (typeof value.$ref === "string" && value.$ref.startsWith("#/$defs/")) return true
  return Object.values(value).some(hasLocalReference)
}

export const normalizeContent = (value: string | ReadonlyArray<Tool.Content> | undefined, output?: unknown) => {
  if (typeof value === "string") return [{ type: "text" as const, text: value }]
  if (value !== undefined && value.length > 0) return [...value]
  return [{ type: "text" as const, text: stringify(output) }]
}

const stringify = (value: unknown) => {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

export const normalizedName = (tool: Tool.Info) => tool.name.replace(/[^a-zA-Z0-9_-]/g, "_")

export const effectiveName = (tool: Tool.Info) =>
  tool.options?.namespace === undefined
    ? normalizedName(tool)
    : `${tool.options.namespace.replaceAll(".", "_")}_${normalizedName(tool)}`
