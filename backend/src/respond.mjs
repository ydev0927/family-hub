// Turns an app result or error into an HTTP response.
import { HttpError } from './app.mjs';

export async function respond(handle, request) {
  try {
    const result = await handle(request);
    if (result.html !== undefined) {
      return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: result.html };
    }
    return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(result) };
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return { status, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: e.message }) };
  }
}
