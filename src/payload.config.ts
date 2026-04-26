import type { CollectionSlug } from 'payload'

// storage-adapter-import-placeholde
import { postgresAdapter } from '@payloadcms/db-postgres'
import { payloadCloudPlugin } from '@payloadcms/payload-cloud'
import { importExportPlugin } from '@payloadcms/plugin-import-export'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { s3Storage } from '@payloadcms/storage-s3'
import path from 'path'
import { buildConfig } from 'payload'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { Forms } from './collections/Forms'
import { Media } from './collections/Media'
import { Projects } from './collections/Projects'
import { Tags } from './collections/Tags'
import { Technologies } from './collections/Technologies'
import { ThirdPartyAccess } from './collections/ThirdPartyAccess'
import { Users } from './collections/Users'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    importMap: {
      baseDir: path.resolve(dirname),
    },
    user: Users.slug,
  },
  collections: [Forms, Users, Media, Projects, Technologies, Tags, ThirdPartyAccess],
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URI || '',
    },
  }),
  editor: lexicalEditor(),
  plugins: [
    payloadCloudPlugin(),
    s3Storage({
      bucket: process.env.R2_BUCKET_NAME || '',
      collections: {
        media: true,
      },
      config: {
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID!,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
        },
        endpoint: process.env.R2_ENDPOINT,
        forcePathStyle: true,
        region: 'auto',
      },
    }),
    importExportPlugin({
      collections: [
        {
          slug: 'projects' as CollectionSlug,
        },
      ],
    }),
    // storage-adapter-placeholder
  ],
  secret: process.env.PAYLOAD_SECRET || '',
  sharp,
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
})
