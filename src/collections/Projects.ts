import type { CollectionConfig } from 'payload'

export const Projects: CollectionConfig = {
  slug: 'projects',
  fields: [
    {
      name: 'title',
      type: 'text',
    },
    {
      name: 'description',
      type: 'textarea',
    },
    {
      name: 'metadata',
      type: 'group',
      fields: [
        {
          name: 'technologies',
          type: 'relationship',
          relationTo: 'technologies',
          hasMany: true,
        },
      ],
    },
    {
      label: 'links',
      type: 'collapsible',
      fields: [
        {
          name: 'liveLink',
          type: 'text',
        },
        {
          name: 'snapshotLink',
          type: 'text',
        },
        { name: 'githubLink', type: 'text' },
      ],
    },
    {
      label: 'media',
      type: 'collapsible',
      fields: [
        {
          name: 'images',
          type: 'upload',
          relationTo: 'media',
        },
      ],
    },
  ],
}
