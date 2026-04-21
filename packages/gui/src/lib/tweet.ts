export interface ExtractedTweet {
  tweet: string | null;
  body: string;
}

export function extractTweet(markdown: string): ExtractedTweet {
  const lines = markdown.split("\n");
  let tweetStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s*つぶやき\s*$/.test(lines[i])) {
      tweetStart = i;
      break;
    }
  }
  if (tweetStart === -1) return { tweet: null, body: markdown };

  let tweetEnd = lines.length;
  for (let i = tweetStart + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{1,6}\s/.test(line)) {
      tweetEnd = i;
      break;
    }
    if (/^[—–-]{1,2}\s/.test(line.trim())) {
      tweetEnd = i;
      break;
    }
  }

  const tweet = lines
    .slice(tweetStart + 1, tweetEnd)
    .join("\n")
    .trim();
  const remaining = [...lines.slice(0, tweetStart), ...lines.slice(tweetEnd)]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { tweet: tweet.length > 0 ? tweet : null, body: remaining };
}
