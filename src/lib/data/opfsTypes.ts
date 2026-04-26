export type OpfsTreeNode = {
	name: string;
	kind: 'file' | 'directory';
	children?: OpfsTreeNode[];
	expanded?: boolean;
};

export type AccountFileEntry = {
	name: string;
	openDate: string;
	currencies: string[];
};

export type AccountFileContent = {
	accounts: AccountFileEntry[];
};
