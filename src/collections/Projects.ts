import type { CollectionConfig } from 'payload'

export const Projects: CollectionConfig = {
  slug: 'projects',
  admin: {
    components: {
      edit: {
        beforeDocumentControls: [{ path: '@/components/ExtractTechnologiesButton' }],
      },
    },
    useAsTitle: 'title',
  },
  fields: [
    {
      type: 'row',
      fields: [
        {
          name: 'title',
          type: 'text',
          admin: {
            width: '60%',
          },
        },
        {
          name: 'slug',
          type: 'text',
          admin: {
            width: '40%',
          },
          required: true,
          unique: true,
        },
      ],
    },
    {
      type: 'collapsible',
      fields: [
        {
          name: 'client_name',
          type: 'text',
        },
        {
          name: 'status',
          type: 'select',
          options: [
            { label: 'Live', value: 'live' },
            { label: 'Ongoing', value: 'ongoing' },
            { label: 'Completed', value: 'completed' },
            { label: 'Archived', value: 'archived' },
          ],
        },
        {
          name: 'business_challenge',
          type: 'code',
          admin: {
            language: 'markdown',
          },
        },
        {
          name: 'contribution_highlights',
          type: 'array',
          fields: [
            {
              name: 'statement',
              type: 'text',
              required: true,
            },
          ],
          labels: {
            plural: 'Contribution highlights',
            singular: 'Highlight',
          },
        },
        {
          name: 'outcomes',
          type: 'array',
          fields: [
            {
              name: 'statement',
              type: 'text',
              required: true,
            },
            {
              name: 'metric',
              type: 'text',
            },
          ],
          labels: {
            plural: 'Outcomes',
            singular: 'Outcome',
          },
        },
      ],
      label: 'case study',
    },
    {
      name: 'summary',
      type: 'code',
      admin: {
        language: 'markdown',
      },
    },
    {
      name: 'description',
      type: 'richText',
    },
    {
      name: 'description_markdown',
      type: 'code',
      admin: {
        description:
          'The full write-up. Kept whole for projects that do not follow the four-section structure; otherwise it is the same content as the sections below.',
        language: 'markdown',
      },
    },
    {
      type: 'collapsible',
      admin: {
        description:
          'The write-up split into its standard sections, so the front end can lay each one out on its own.',
      },
      fields: [
        {
          name: 'intro_markdown',
          type: 'code',
          admin: {
            language: 'markdown',
          },
          label: 'Introduction',
        },
        {
          name: 'tech_stack_markdown',
          type: 'code',
          admin: {
            language: 'markdown',
          },
          label: 'Tech stack & architecture',
        },
        {
          name: 'implementation_markdown',
          type: 'code',
          admin: {
            language: 'markdown',
          },
          label: 'Key implementation details',
        },
        {
          name: 'outcome_markdown',
          type: 'code',
          admin: {
            language: 'markdown',
          },
          label: 'Outcome',
        },
      ],
      label: 'description sections',
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
          name: 'live_link',
          type: 'text',
        },
        {
          name: 'snapshot_link',
          type: 'text',
        },
        { name: 'github_link', type: 'text' },
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
                width: '33%',
              },
              relationTo: 'media',
            },
            {
              name: 'hero_image',
              type: 'upload',
              admin: {
                width: '33%',
              },
              relationTo: 'media',
            },
            {
              name: 'images',
              type: 'upload',
              admin: {
                width: '33%',
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
