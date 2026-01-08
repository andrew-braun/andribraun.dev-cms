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
          label: 'Backend',
          value: 'backend',
        },
        {
          label: 'CMS',
          value: 'cms',
        },
        {
          label: 'Database',
          value: 'database',
        },
        {
          label: 'Design',
          value: 'design',
        },
        {
          label: 'DevOps',
          value: 'devops',
        },
        {
          label: 'Framework',
          value: 'framework',
        },
        {
          label: 'Frontend',
          value: 'frontend',
        },
        {
          label: 'Language',
          value: 'language',
        },
        {
          label: 'Tool',
          value: 'tool',
        },
      ],
      hasMany: true,
    },
  ],
}
