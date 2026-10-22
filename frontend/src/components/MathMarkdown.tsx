import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import { preprocessMarkdown } from '../lib/format';

/**
 * react-markdown passes its internal AST `node` to every component override.
 * Spreading it onto a DOM element rendered `node="[object Object]"` as an
 * invalid attribute, so it is dropped here.
 */
function stripAstNode<T extends object>(props: T): Omit<T, 'node'> {
  const { node, ...rest } = props as T & { node?: unknown };
  void node;
  return rest as Omit<T, 'node'>;
}

interface MathMarkdownProps {
  children: string;
  className?: string;
  style?: React.CSSProperties;
  inline?: boolean;
}

export default function MathMarkdown({ children, className, style, inline = false }: MathMarkdownProps) {
  const processed = preprocessMarkdown(children);
  const Tag = inline ? 'span' : 'div';

  return (
    <Tag className={className} style={{ display: inline ? 'inline' : 'block', ...style }}>
      <ReactMarkdown
        /**
         * `remarkGfm` supplies tables. Authored questions carry pipe tables
         * (297 active production items), and CommonMark has no table syntax, so
         * without this they rendered as literal `|` and `| :---: |` rows —
         * unreadable for the student. Styling lives in globals.css under
         * `.markdown-table-wrapper`.
         */
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { output: 'htmlAndMathml', throwOnError: false }]]}
        components={{
          /**
           * A wide table scrolls inside its own frame so the page never gains a
           * horizontal scrollbar on a phone. Two details matter: `node` is
           * react-markdown's internal AST prop and must not reach the DOM (it
           * rendered as `node="[object Object]"`), and the wrapper is a `span`
           * so the markup stays valid when `inline` renders into a span.
           */
          table: (props) => (
            <span className="markdown-table-wrapper">
              <table {...stripAstNode(props)} />
            </span>
          ),
          ...(inline
            ? {
                p: (props) => (
                  <span
                    {...stripAstNode(props)}
                    style={{ display: 'inline', margin: 0, padding: 0 }}
                  />
                ),
              }
            : {}),
        }}
      >
        {processed}
      </ReactMarkdown>
    </Tag>
  );
}
