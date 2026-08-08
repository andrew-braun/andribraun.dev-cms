import { describe, expect, it } from 'vitest'

import type { CaseStudySidecar } from '../../scripts/ingest/lib/caseStudy'

import { renderCaseStudySection } from '../../scripts/ingest/lib/sheet'

describe('renderCaseStudySection', () => {
  it('lists proposed values and needsReview when sidecar exists', () => {
    const sidecar: CaseStudySidecar = {
      businessChallenge: 'Fragmented planning.',
      clientName: 'WhereNext.ai',
      contributionHighlights: [{ statement: 'Built the platform end-to-end' }],
      needsReview: ['businessChallenge'],
      outcomes: [{ metric: 'From idea to live product', statement: 'End-to-end experience' }],
      status: 'live',
    }

    const md = renderCaseStudySection('wherenext-ai', sidecar).join('\n')
    expect(md).toContain('## Case study')
    expect(md).toContain('`slug`')
    expect(md).toContain('wherenext-ai')
    expect(md).toContain('WhereNext.ai')
    expect(md).toContain('**Needs review:**')
    expect(md).toContain('`businessChallenge`')
    expect(md).toContain('case-study.json')
  })

  it('flags all fields when sidecar is missing', () => {
    const md = renderCaseStudySection('demo', null).join('\n')
    expect(md).toContain('_No case-study.json yet')
    expect(md).toContain('`clientName`')
    expect(md).toContain('`status`')
  })
})
