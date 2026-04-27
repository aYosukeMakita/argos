'use client'

import { Children, isValidElement, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { StatusBadge } from '@/components/status-badge'

export type FindingOutcome = 'bug' | 'false-positive'

type MarkdownContentProps = {
  content: string
  className?: string
  findingOutcomes?: Partial<Record<string, FindingOutcome>>
}

function flattenText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }

  return Children.toArray(node)
    .map(child => {
      if (isValidElement<{ children?: ReactNode }>(child)) {
        return flattenText(child.props.children)
      }

      return flattenText(child)
    })
    .join('')
}

function getFindingOutcomeLabel(outcome: FindingOutcome): string {
  return outcome === 'bug' ? 'バグ' : '誤検知'
}

function getFindingOutcomeTone(outcome: FindingOutcome): 'success' | 'danger' {
  return outcome === 'bug' ? 'success' : 'danger'
}

export function MarkdownContent({ content, className, findingOutcomes }: MarkdownContentProps) {
  const classes = ['markdown-content', className].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      <ReactMarkdown
        components={{
          h3: ({ children, ...props }) => {
            const headingText = flattenText(children).trim()
            const findingId = /^([HML]\d+)$/.exec(headingText)?.[1]
            const outcome = findingId ? findingOutcomes?.[findingId] : undefined

            return (
              <h3 {...props}>
                <span className="finding-heading">
                  <span>{children}</span>
                  {outcome ? (
                    <StatusBadge tone={getFindingOutcomeTone(outcome)}>{getFindingOutcomeLabel(outcome)}</StatusBadge>
                  ) : null}
                </span>
              </h3>
            )
          },
          h4: ({ children, ...props }) => {
            const headingText = flattenText(children).trim()
            const findingId = /^([HML]\d+)$/.exec(headingText)?.[1]
            const outcome = findingId ? findingOutcomes?.[findingId] : undefined

            return (
              <h4 {...props}>
                <span className="finding-heading">
                  <span>{children}</span>
                  {outcome ? (
                    <StatusBadge tone={getFindingOutcomeTone(outcome)}>{getFindingOutcomeLabel(outcome)}</StatusBadge>
                  ) : null}
                </span>
              </h4>
            )
          },
        }}
        remarkPlugins={[remarkGfm]}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
