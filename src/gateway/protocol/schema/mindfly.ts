import { Type } from "@sinclair/typebox";

import { NonEmptyString } from "./primitives.js";

export const MindflyGoogleIdentitySchema = Type.Object(
  {
    email: NonEmptyString,
    name: Type.Optional(NonEmptyString),
    picture: Type.Optional(NonEmptyString),
    id: Type.Optional(NonEmptyString),
    expiresAtMs: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const MindflyGoogleIdentityGetParamsSchema = Type.Object(
  {},
  { additionalProperties: false },
);

export const MindflyGoogleIdentityGetResultSchema = Type.Object(
  {
    identity: Type.Union([MindflyGoogleIdentitySchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export const MindflyGoogleSignInStartParamsSchema = Type.Object(
  {},
  { additionalProperties: false },
);

export const MindflyGoogleSignInStartResultSchema = Type.Object(
  {
    sessionId: NonEmptyString,
    authUrl: NonEmptyString,
  },
  { additionalProperties: false },
);

export const MindflyGoogleSignInWaitParamsSchema = Type.Object(
  {
    sessionId: NonEmptyString,
    timeoutMs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const MindflyGoogleSignInWaitResultSchema = Type.Object(
  {
    identity: MindflyGoogleIdentitySchema,
  },
  { additionalProperties: false },
);

export const MindflyGoogleSignOutParamsSchema = Type.Object({}, { additionalProperties: false });

export const MindflyGoogleSignOutResultSchema = Type.Object(
  { ok: Type.Literal(true) },
  { additionalProperties: false },
);

export const MindflyProviderSchema = Type.Object(
  {
    id: NonEmptyString,
    label: NonEmptyString,
    configured: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const MindflyIntegrationsProvidersListParamsSchema = Type.Object(
  {},
  { additionalProperties: false },
);

export const MindflyIntegrationsProvidersListResultSchema = Type.Object(
  {
    providers: Type.Array(MindflyProviderSchema),
  },
  { additionalProperties: false },
);

export const MindflyIntegrationsProviderSetApiKeyParamsSchema = Type.Object(
  {
    provider: NonEmptyString,
    apiKey: NonEmptyString,
  },
  { additionalProperties: false },
);

export const MindflyIntegrationsProviderSetApiKeyResultSchema = Type.Object(
  { ok: Type.Literal(true) },
  { additionalProperties: false },
);

export const MindflyIntegrationsProviderClearApiKeyParamsSchema = Type.Object(
  {
    provider: NonEmptyString,
  },
  { additionalProperties: false },
);

export const MindflyIntegrationsProviderClearApiKeyResultSchema = Type.Object(
  { ok: Type.Literal(true) },
  { additionalProperties: false },
);
