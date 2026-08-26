/**
 * Collection Schemas
 *
 * All collections with columns and RBAC permissions.
 * Single source of truth — imported by both worker and frontend.
 *
 * Add schemas by creating a file in src/schemas/ and importing it here.
 */

import type { CollectionSchema } from 'deepspace/schema'
import { usersSchema } from './schemas/users-schema'
import { settingsSchema } from './schemas/admin-schema'
import {
  channelsSchema,
  devProfilesSchema,
  matchesSchema,
  messagesSchema,
  profilesSchema,
  readReceiptsSchema,
  swipesSchema,
} from './schemas/hottake-schemas'

export const schemas: CollectionSchema[] = [
  usersSchema,
  settingsSchema,
  profilesSchema,
  devProfilesSchema,
  swipesSchema,
  matchesSchema,
  channelsSchema,
  messagesSchema,
  readReceiptsSchema,
]
