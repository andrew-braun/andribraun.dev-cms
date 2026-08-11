export type ScreenshotCaptureIssue = 'cookie-consent' | 'page-error'

export function detectScreenshotCaptureIssues(bodyText: string): ScreenshotCaptureIssue[] {
  const text = bodyText.replace(/\s+/g, ' ').trim()
  const issues: ScreenshotCaptureIssue[] = []
  if (/\b(?:accept all|accept cookies|cookie settings|we use cookies)\b/i.test(text)) {
    issues.push('cookie-consent')
  }
  if (
    /\b(?:can(?:not|['’]t) load google maps correctly|application error|something went wrong)\b/i.test(
      text,
    )
  ) {
    issues.push('page-error')
  }
  return issues
}
