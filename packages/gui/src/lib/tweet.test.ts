import { describe, expect, it } from "vitest";
import { extractTweet } from "./tweet";

describe("extractTweet", () => {
  it("returns null tweet when no つぶやき section is present", () => {
    const md = "# headline\n\n## 実施内容\n- did a thing\n";
    const { tweet, body } = extractTweet(md);
    expect(tweet).toBeNull();
    expect(body).toBe(md);
  });

  it("extracts a single-line tweet and removes it from the body", () => {
    const md = [
      "# headline",
      "",
      "## 実施内容",
      "- did stuff",
      "",
      "## つぶやき",
      "「テスト先に書いたら勝ち確。」",
      "",
      "— Mika",
      "",
    ].join("\n");
    const { tweet, body } = extractTweet(md);
    expect(tweet).toBe("「テスト先に書いたら勝ち確。」");
    expect(body).not.toContain("つぶやき");
    expect(body).not.toContain("勝ち確");
    expect(body).toContain("— Mika");
    expect(body).toContain("## 実施内容");
  });

  it("stops at next heading when there is no signature", () => {
    const md = [
      "## つぶやき",
      "ひとこと感想",
      "",
      "## 申し送り",
      "なし",
    ].join("\n");
    const { tweet, body } = extractTweet(md);
    expect(tweet).toBe("ひとこと感想");
    expect(body).toContain("## 申し送り");
    expect(body).not.toContain("ひとこと感想");
  });

  it("treats an empty つぶやき section as null", () => {
    const md = ["## つぶやき", "", "— Kai"].join("\n");
    const { tweet, body } = extractTweet(md);
    expect(tweet).toBeNull();
    expect(body).toContain("— Kai");
  });
});
