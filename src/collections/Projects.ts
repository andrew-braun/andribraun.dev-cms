import type { CollectionConfig } from 'payload'

export const Projects: CollectionConfig = {
  slug: 'projects',
  admin: {
    components: {
      edit: {
        beforeDocumentControls: [{ path: '@/components/ExtractTechnologiesButton' }],
      },
    },
  },
  fields: [
    {
      name: 'title',
      type: 'text',
    },
    {
      name: 'description',
      type: 'richText',
    },
    {
      name: 'description_markdown',
      type: 'code',
      admin: {
        language: 'markdown',
      },
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
          name: 'thumbnail',
          type: 'upload',
          relationTo: 'media',
        },
        {
          name: 'images',
          type: 'upload',
          relationTo: 'media',
          unique: true,
          hasMany: true,
        },
      ],
    },
  ],
}
