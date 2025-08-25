import type { CollectionConfig } from 'payload'

export const Technologies: CollectionConfig = {
  slug: 'technologies',
  admin: {
    useAsTitle: 'name',
  },
  fields: [
    {
      name: 'name',
      type: 'text',
    },
    {
      name: 'description',
      type: 'textarea',
    },
    {
      name: 'link',
      type: 'text',
    },
    {
      name: 'category',
      type: 'select',
      options: [
        {
          label: 'Frontend',
          value: 'frontend',
        },
        {
          label: 'Backend',
          value: 'backend',
        },
        {
          label: 'Database',
          value: 'database',
        },
        {
          label: 'CMS',
          value: 'cms',
        },
        {
          label: 'Language',
          value: 'language',
        },
        {
          label: 'Tool',
          value: 'tool',
        },
        {
          label: 'Framework',
          value: 'framework',
        },
      ],
      hasMany: true,
    },
  ],
}
