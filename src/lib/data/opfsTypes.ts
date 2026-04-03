export type OpfsTreeNode = {
	name: string;
	kind: 'file' | 'directory';
	children?: OpfsTreeNode[];
	expanded?: boolean;
};
