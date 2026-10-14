import { describe, expect, it } from "bun:test"
import { clean, hasSensitiveContent, normalizeSearchText, validLanguage } from "../src/policy"

describe("Idea Bank input policy", () => {
  it("normalizes control characters and whitespace before enforcing length", () => {
    expect(clean("  local\u0000tool   idea  ", 30)).toBe("local tool idea")
    expect(clean("a  b  c", 4)).toBe("a b")
    expect(clean(42, 20)).toBe("")
  })

  it("rejects common credentials and private-key markers", () => {
    const syntheticCredential = ["OPENAI_KEY=sk-", "123456", "789012", "345678", "901234"].join("")
    expect(hasSensitiveContent(syntheticCredential)).toBe(true)
    expect(hasSensitiveContent("password: hunter2")).toBe(true)
    expect(hasSensitiveContent("-----BEGIN PRIVATE KEY-----")).toBe(true)
    expect(hasSensitiveContent("AKIA1234567890ABCDEF")).toBe(true)
  })

  it("rejects personal contact details, URLs, IPs, and common home paths", () => {
    expect(hasSensitiveContent("Contact person@example.org")).toBe(true)
    expect(hasSensitiveContent("More info at https://example.org/private")).toBe(true)
    expect(hasSensitiveContent("Host is 192.0.2.25")).toBe(true)
    expect(hasSensitiveContent("Config lives at /home/alex/.config/app")).toBe(true)
    expect(hasSensitiveContent("Open C:\\Users\\Alex\\secret.txt")).toBe(true)
  })

  it("allows generic ideas that mention security without including credentials", () => {
    expect(
      hasSensitiveContent("Build a local tool that explains API-key rotation without storing credentials."),
    ).toBe(false)
  })

  it("normalizes English and Cyrillic search text consistently", () => {
    expect(normalizeSearchText("  ПЕРЕВОД   ИГРЫ  ")).toBe("перевод игры")
    expect(normalizeSearchText("ＡＰＩ   TOOL")).toBe("api tool")
  })

  it("accepts only simple supported language tags", () => {
    expect(validLanguage("en")).toBe(true)
    expect(validLanguage("ru")).toBe(true)
    expect(validLanguage("ru-RU")).toBe(true)
    expect(validLanguage("english")).toBe(false)
    expect(validLanguage("en-us")).toBe(false)
    expect(validLanguage("")).toBe(false)
  })
})
