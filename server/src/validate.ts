import { z, type ZodTypeAny } from 'zod';
import { badRequest } from './errors';

/** Parse `data` with a zod schema, throwing a 400 `{error:{code:'bad_request'}}` on failure. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const issue = r.error.issues[0];
    const path = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
    throw badRequest(`${path}${issue?.message ?? 'Invalid input'}`);
  }
  return r.data;
}

export { z };
