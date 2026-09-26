/** In-memory StorageBackend for testing stores without OPFS. */
import type { StorageBackend } from '$lib/storage/storageBackend';

export class MemoryBackend implements StorageBackend {
	files = new Map<string, { content: string; modified: number }>();
	private clock = 1;

	constructor(initial: Record<string, string> = {}) {
		for (const [name, content] of Object.entries(initial))
			this.files.set(name, { content, modified: this.clock++ });
	}

	async readFile(filename: string) {
		return this.files.get(filename)?.content;
	}

	async writeFile(filename: string, content: string) {
		this.files.set(filename, { content, modified: this.clock++ });
	}

	async listFiles() {
		return [...this.files.keys()];
	}

	async lastModified(filename: string) {
		return this.files.get(filename)?.modified;
	}
}
