'use client'

import { extractTechnologies } from '@/actions/extractTechnologies'
import { Button, toast, useDocumentInfo } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * Button component for extracting technologies from a project description using AI.
 * Automatically creates new technology entries and links them to the current project.
 * Requires the document to be saved before extraction can begin.
 */
const ExtractTechnologiesButton: React.FC = () => {
  const { id } = useDocumentInfo()
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)

  const handleExtract = async () => {
    if (!id) {
      toast.error('Please save the document first')
      return
    }

    setIsLoading(true)
    try {
      const result = await extractTechnologies(id as number)

      if (!result.success) {
        throw new Error(result.message)
      }

      if (result.created.length > 0) {
        toast.success(
          `Created ${result.created.length} new technologies: ${result.created.join(', ')}`,
        )
      } else {
        toast.info('No new technologies to create')
      }

      if (result.errors && result.errors.length > 0) {
        toast.warning(
          `${result.errors.length} error(s) occurred: ${result.errors.slice(0, 3).join('; ')}${result.errors.length > 3 ? '...' : ''}`,
        )
      }

      if (result.linked > 0) {
        router.refresh()
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Extraction failed')
    } finally {
      setIsLoading(false)
    }
  }

  if (!id) {
    return null
  }

  return (
    <Button buttonStyle="secondary" disabled={isLoading} onClick={handleExtract} size="small">
      {isLoading ? 'Extracting...' : 'Extract Technologies'}
    </Button>
  )
}

export default ExtractTechnologiesButton
