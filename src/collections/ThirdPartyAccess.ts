import type { CollectionConfig } from 'payload'

export const ThirdPartyAccess: CollectionConfig = {
  slug: 'third-party-access',
  admin: {
    useAsTitle: 'name',
  },
  auth: {
    useAPIKey: true,
  },
  fields: [
    {
      name: 'name',
      type: 'text',

      defaultValue: 'Default API Key Name',
      required: true,
    },
  ],
}
