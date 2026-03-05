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
          hasMany: true,
          relationTo: 'technologies',
        },
      ],
    },
    {
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
      label: 'links',
    },
    {
      type: 'collapsible',
      fields: [
        {
          type: 'row',
          fields: [
            {
              name: 'thumbnail',
              type: 'upload',
              admin: {
                width: '50%',
              },
              relationTo: 'media',
            },
            {
              name: 'images',
              type: 'upload',
              admin: {
                width: '50%',
              },
              hasMany: true,
              relationTo: 'media',
              unique: true,
            },
          ],
        },
      ],
      label: 'media',
    },
    {
      name: 'display',
      type: 'group',
      fields: [
        {
          type: 'row',
          fields: [
            {
              name: 'featured',
              type: 'checkbox',
              admin: {
                width: '10%',
              },
            },
            {
              name: 'hide',
              type: 'checkbox',
              admin: {
                width: '10%',
              },
            },
            {
              name: 'order',
              type: 'number',
              admin: {
                width: '20%',
              },
            },
            {
              name: 'card_type',
              type: 'select',
              admin: {
                width: '40%',
              },
              defaultValue: 'visual',
              options: [
                { label: 'Visual', value: 'visual' },
                { label: 'Text', value: 'text' },
              ],
            },
          ],
        },
      ],
    },
  ],
}
