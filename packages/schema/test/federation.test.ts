import { expect, test } from "bun:test"
import { Federation } from "../src/federation.js"
import { ProjectID } from "../src/orchestra.js"

const a = ProjectID.make("prj_a")
const b = ProjectID.make("prj_b")
const c = ProjectID.make("prj_c")

const policy = (grants: Federation.Policy["grants"], maxOpen?: number): Federation.Policy => ({
  project: b,
  visibility: "summary",
  grants,
  ...(maxOpen === undefined ? {} : { maxOpen }),
})

const ticket = (kind: Federation.Kind, chain: readonly ProjectID[] = [a]) => ({ from: a, to: b, kind, chain })

test("a peer without a grant is refused", () => {
  expect(Federation.admit(Federation.defaultPolicy(b), ticket("question"), 0)).toBe("no-grant")
})

test("a grant limits the kinds of ticket a peer may send", () => {
  const rules = policy([{ peer: a, allow: ["question"] }])
  expect(Federation.admit(rules, ticket("question"), 0)).toBeUndefined()
  expect(Federation.admit(rules, ticket("request"), 0)).toBe("kind-not-allowed")
})

test("a project cannot send tickets to itself", () => {
  expect(Federation.admit(policy([{ peer: b, allow: ["question"] }]), { ...ticket("question"), from: b }, 0)).toBe("self")
})

test("a ticket that already passed through the receiver is a loop", () => {
  const rules = policy([{ peer: a, allow: ["question"] }])
  expect(Federation.admit(rules, ticket("question", [a, b]), 0)).toBe("loop")
})

test("long chains are refused", () => {
  const rules = policy([{ peer: a, allow: ["question"] }])
  expect(Federation.admit(rules, ticket("question", [a, c, c, c, c]), 0)).toBe("chain-too-long")
})

test("a peer cannot keep more tickets open than the receiver allows", () => {
  const rules = policy([{ peer: a, allow: ["question"] }], 2)
  expect(Federation.admit(rules, ticket("question"), 1)).toBeUndefined()
  expect(Federation.admit(rules, ticket("question"), 2)).toBe("too-many-open")
})

test("linking shows both projects to each other and allows questions only", () => {
  const linked = Federation.linkPolicy(Federation.defaultPolicy(b), a)
  expect(linked.visibility).toBe("summary")
  expect(Federation.allows(linked, a, "question")).toBe(true)
  expect(Federation.allows(linked, a, "request")).toBe(false)
  expect(Federation.autoAnswers(linked, a, "question")).toBe(false)
})

test("linking keeps wider grants and unlinking removes the peer", () => {
  const wide = policy([{ peer: a, allow: ["request"], autoAnswer: true }])
  const linked = Federation.linkPolicy(wide, a)
  expect(Federation.grantOf(linked, a)?.allow).toEqual(["request", "question"])
  expect(Federation.unlinkPolicy(linked, a).grants).toEqual([])
})

test("a group links every pair once", () => {
  expect(Federation.pairs([a, b, c])).toEqual([[a, b], [a, c], [b, c]])
  expect(Federation.pairs([a])).toEqual([])
})

test("only granted questions are answered without a human", () => {
  const rules = policy([{ peer: a, allow: ["question", "request"], autoAnswer: true }])
  expect(Federation.autoAnswers(rules, a, "question")).toBe(true)
  expect(Federation.autoAnswers(rules, a, "request")).toBe(false)
  expect(Federation.autoAnswers(policy([{ peer: a, allow: ["question"] }]), a, "question")).toBe(false)
})
