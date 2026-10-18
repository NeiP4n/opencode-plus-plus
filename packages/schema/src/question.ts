export * as Question from "./question.js"

import { Schema } from "effect"
import { optional } from "./schema.js"

const Option = Schema.Struct({
  label: Schema.String.annotate({ description: "Display text (1-5 words, concise)" }),
  description: Schema.String.annotate({ description: "Explanation of choice" }),
})

const base = {
  question: Schema.String.annotate({ description: "Complete question" }),
  header: Schema.String.annotate({ description: "Very short label (max 30 chars)" }),
  options: Schema.Array(Option).annotate({ description: "Available choices" }),
  kind: Schema.Literals(["choice", "multi-select", "text", "yes-no", "priority", "rating"]).pipe(optional).annotate({
    description:
      "Interaction style: choice for one option, multi-select for several, text for free-form input, yes-no for confirmation, priority for urgency, or rating for a 1-5 rating",
  }),
  multiple: Schema.Boolean.pipe(optional).annotate({ description: "Legacy option for selecting multiple choices; use kind: multi-select for new prompts" }),
}

export const Prompt = Schema.Struct(base).annotate({ identifier: "Question.Prompt" })
export interface Prompt extends Schema.Schema.Type<typeof Prompt> {}

export const Answer = Schema.Array(Schema.String).annotate({ identifier: "Question.Answer" })
export type Answer = typeof Answer.Type
