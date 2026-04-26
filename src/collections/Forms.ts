import type { CollectionConfig } from 'payload'

export const Forms: CollectionConfig = {
  slug: 'forms',

  fields: [
    {
      name: 'form_name',
      type: 'text',
    },
    {
      name: 'form_subject',
      type: 'text',
    },
    {
      name: 'form_body',
      type: 'code',
      admin: {
        language: 'markdown',
      },
    },
    {
      name: 'sender_data',
      type: 'group',
      fields: [
        { name: 'name', type: 'text' },
        { name: 'email', type: 'text' },
      ],
    },
    {
      name: 'metadata',
      type: 'group',
      fields: [
        {
          name: 'ip_address',
          type: 'text',
        },
        {
          name: 'user_agent',
          type: 'text',
        },
        {
          name: 'referrer',
          type: 'text',
        },
      ],
    },
  ],
}
