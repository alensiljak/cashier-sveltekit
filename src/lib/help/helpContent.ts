/*
	Loads in-app help content from markdown files kept in `doc/help/` at the
	repo root — deliberately outside `src/` so content stays easy to browse
	and edit independently of the app source.

	Each file's basename (without extension) is its topic key, referenced by
	`<HelpButton topic="..." />` on a page's toolbar.
*/
import { marked } from 'marked';

// Vite glob-imports every markdown file under doc/help as a raw string,
// resolved at build time — works offline, no runtime fetch. The glob result
// keys are static (fixed at build time), so a Record fits better than a Map.
const rawContent = import.meta.glob('../../../doc/help/*.md', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

const helpTopics: Record<string, string> = {};
for (const [path, content] of Object.entries(rawContent)) {
	const topic = path.split('/').pop()!.replace(/\.md$/, '');
	helpTopics[topic] = content;
}

export { helpTopics };

/**
 * Render the markdown help content for a topic to HTML.
 * Returns null if no content exists for the topic.
 */
export function getHelpHtml(topic: string): string | null {
	const md = helpTopics[topic];
	if (!md) return null;
	return marked.parse(md, { async: false });
}

/**
 * All topics with a display title (the markdown's first `# ` heading, or
 * the topic key itself if none), sorted alphabetically by title — used by
 * the /help index page to list every available topic.
 *
 * When `query` is given, only topics whose title or body text contains it
 * (case-insensitive) are returned — a simple full-text filter rather than
 * a title-only one, since topic titles are short and often don't mention
 * the terms someone would search for.
 */
export function listHelpTopics(query?: string): Array<{ topic: string; title: string }> {
	const needle = query?.trim().toLowerCase();
	return Object.keys(helpTopics)
		.map((topic) => ({
			topic,
			title: helpTopics[topic].match(/^#\s+(.+)$/m)?.[1] ?? topic,
			body: helpTopics[topic]
		}))
		.filter(
			({ title, body }) =>
				!needle || title.toLowerCase().includes(needle) || body.toLowerCase().includes(needle)
		)
		.map(({ topic, title }) => ({ topic, title }))
		.sort((a, b) => a.title.localeCompare(b.title));
}
