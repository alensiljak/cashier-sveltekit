/**
 * Thin async wrapper around fflate's ZIP compression, keeping its
 * callback-based API out of call sites that just want a Promise.
 */
import { zip, type AsyncZippable, type ZipOptions } from 'fflate';

/** Compresses a flat path → bytes map into a single ZIP archive. */
export async function createZipArchive(
	files: Record<string, Uint8Array>,
	opts?: ZipOptions
): Promise<Uint8Array<ArrayBuffer>> {
	const { promise, resolve, reject } = Promise.withResolvers<Uint8Array<ArrayBuffer>>();
	zip(files as AsyncZippable, opts ?? { level: 6 }, (err, buf) => {
		if (err) reject(err);
		else resolve(buf);
	});
	return promise;
}
