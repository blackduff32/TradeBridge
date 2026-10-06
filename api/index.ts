import { get, put, del, BlobPreconditionFailedError } from '@vercel/blob';
import { hostedHandler, SnapshotConflict, type HostedState, type HostedStorage } from '../src/hosted.js';
const storage: HostedStorage = {
  async read(key) {
    // Compressed downloads carry a weak ETag, which cannot be used for CAS.
    // Request the identity representation to preserve the storage object's strong ETag.
    const result = await get(key, { access: 'private', useCache: false, headers: { 'Accept-Encoding': 'identity' } });
    if (!result) return null;
    if (result.statusCode !== 200 || !result.stream) throw new Error('Unexpected storage response');
    return { state: await new Response(result.stream).json() as HostedState, etag: result.blob.etag };
  },
  async write(key, state, etag) {
    try { await put(key, JSON.stringify(state), { access: 'private', addRandomSuffix: false, contentType: 'application/json', ...(etag ? { ifMatch: etag, allowOverwrite: true } : { allowOverwrite: false }) }); }
    catch (error) { if (error instanceof BlobPreconditionFailedError) throw new SnapshotConflict(); throw error; }
  },
  async remove(key, etag) {
    try { await del(key, { ifMatch: etag }); }
    catch (error) { if (error instanceof BlobPreconditionFailedError) throw new SnapshotConflict(); throw error; }
  },
};
export default { fetch: hostedHandler(storage) };
