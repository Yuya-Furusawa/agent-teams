import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { EmptyState } from "./EmptyState";
import { extractTweet } from "../lib/tweet";

export function ReportView({
  body,
  loading,
  missingLabel,
}: {
  body: string | null;
  loading: boolean;
  missingLabel: string;
}): JSX.Element {
  if (loading) {
    return <EmptyState title="Loading…" />;
  }
  if (body === null) {
    return <EmptyState title={missingLabel} />;
  }
  const { tweet, body: mainBody } = extractTweet(body);
  return (
    <div className="h-full overflow-y-auto">
      {tweet && (
        <div className="sticky top-0 z-10 px-6 pt-4 pb-2 bg-neutral-950">
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 shadow-sm">
            <div className="text-sm leading-relaxed text-neutral-100 prose prose-invert max-w-none prose-p:my-0 prose-blockquote:my-1 prose-blockquote:border-amber-500/40 prose-blockquote:text-neutral-200">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{tweet}</ReactMarkdown>
            </div>
          </div>
        </div>
      )}
      <div className="px-6 py-4 prose prose-invert max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {mainBody}
        </ReactMarkdown>
      </div>
    </div>
  );
}
