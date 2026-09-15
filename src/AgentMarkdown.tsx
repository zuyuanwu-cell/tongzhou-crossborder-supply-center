import React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

function safeMarkdownHref(href?: string) {
  const value = String(href || "").trim();
  if (/^(?:https?:|mailto:|#|\/)/i.test(value)) return value;
  return "";
}

const markdownComponents: Components = {
  a: ({ href, children, ...props }) => {
    const safeHref = safeMarkdownHref(href);
    if (!safeHref) return <span>{children}</span>;
    const external = /^https?:\/\//i.test(safeHref);
    return (
      <a
        {...props}
        href={safeHref}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer noopener" : undefined}
      >
        {children}
      </a>
    );
  },
  table: ({ children, ...props }) => (
    <div className="ai-agent-markdown-table" role="region" aria-label="数据表格" tabIndex={0}>
      <table {...props}>{children}</table>
    </div>
  ),
};

export default function AgentMarkdown({ content }: { content: string }) {
  return (
    <div className="ai-agent-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents} skipHtml>
        {content}
      </ReactMarkdown>
    </div>
  );
}
