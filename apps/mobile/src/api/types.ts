/**
 * The API's types, by name. Every one comes from the generated schema
 * (schema.ts, from api/ via openapi.json: `npm run gen:api`); nothing here
 * is written by hand except the lists of enum values the UI iterates.
 */
import type { components } from './schema';

type Schemas = components['schemas'];

export type AppUser = Schemas['AppUser'];
export type UpdateMe = Schemas['UpdateMeRequest'];
