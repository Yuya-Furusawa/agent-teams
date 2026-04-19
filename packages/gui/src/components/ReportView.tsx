import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { EmptyState } from "./EmptyState";

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
  return (
    <div className="h-full overflow-y-auto px-6 py-4 prose prose-invert max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {body}
      </ReactMarkdown>
    </div>
  );
}
