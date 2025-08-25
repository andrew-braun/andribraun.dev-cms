import type { CollectionConfig } from 'payload'

export const Tags: CollectionConfig = {
  slug: 'tags',
  fields: [
    {
      name: 'title',
      type: 'text',
    },
    {
      name: 'description',
      type: 'textarea',
    },
  ],
}
