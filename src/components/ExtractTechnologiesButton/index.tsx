'use client'

import { useDocumentInfo, Button, toast } from '@payloadcms/ui'
import { useState } from 'react'
import { extractTechnologies } from '@/actions/extractTechnologies'

const ExtractTechnologiesButton: React.FC = () => {
  const { id } = useDocumentInfo()
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
        toast.success(`Created ${result.created.length} new technologies: ${result.created.join(', ')}`)
      } else {
        toast.info('No new technologies to create')
      }

      if (result.linked > 0) {
        window.location.reload()
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Extraction failed')
    } finally {
      setIsLoading(false)
    }
  }

  if (!id) return null

  return (
    <Button
      onClick={handleExtract}
      disabled={isLoading}
      buttonStyle="secondary"
      size="small"
    >
      {isLoading ? 'Extracting...' : 'Extract Technologies'}
    </Button>
  )
}

export default ExtractTechnologiesButton