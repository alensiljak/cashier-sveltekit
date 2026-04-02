<script lang="ts">
	import { goto } from '$app/navigation';
	import SearchToolbar from '$lib/components/SearchToolbar.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { selectionMetadata } from '$lib/data/mainStore';
	import { ListSearch } from '$lib/utils/ListSearch';
	import ledgerService from '$lib/services/ledgerService';
	import { resolve } from '$app/paths';

	interface AccountRow {
		account: string;
		open: string | null;
		close: string | null;
		currencies: string[] | null;
		booking: string | null;
	}

	const lsVersion = ledgerService.version;

	let searchTerm = $state('');
	let isInSelectionMode = $derived($selectionMetadata !== undefined);

	const allAccounts: AccountRow[] = $derived.by(() => {
		const _v = $lsVersion; // reactive dependency
		const result = ledgerService.query('select * from accounts');

		return (result?.rows ?? []).map((row: any[]) => ({
			account: row[0],
			open: row[1],
			close: row[2],
			currencies: row[3],
			booking: row[4]
		}));
	});

	const filteredAccounts: AccountRow[] = $derived.by(() => {
		if (!searchTerm) return allAccounts;

		const search = new ListSearch();
		const regex = search.getRegex(searchTerm);
		return allAccounts.filter((row) => regex.test(row.account ?? ''));
	});

	/**
	 * Colour the account names based on the account type.
	 */
	function getAccountColour(accountName: string | undefined): string {
		if (!accountName) {
			console.warn('Account record has undefined accountName. Please check and adjust the underlying data.');
			return '';
		}
		if (accountName.startsWith('Income:')) {
			return 'text-primary-200';
		} else if (accountName.startsWith('Expenses:')) {
			return 'text-secondary-200';
		} else if (accountName.startsWith('Assets:')) {
			return 'text-base-content';
		} else if (accountName.startsWith('Liabilities:')) {
			return 'text-purple-200';
		} else {
			return '';
		}
	}

	function onAccountSelected(name: string) {
		if (isInSelectionMode) {
			if ($selectionMetadata) {
				$selectionMetadata.selectedId = name;
			}
			history.back();
		} else {
			goto(resolve('/account')); // todo: show account details
		}
	}

	function onSearch(value: string) {
		searchTerm = value;
	}
</script>

<main class="flex flex-col flex-1">
	<Toolbar title="Accounts" />
	<!-- search toolbar -->
	<SearchToolbar focus {onSearch} />
	<!-- Account list -->
	<div class="flex-1 overflow-y-auto px-1">
		{#each filteredAccounts as row, i (row.account ?? `undefined-${i}`)}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div
				class="border-base-content/15 flex items-center justify-between border-b py-2 px-1 {getAccountColour(
					row.account
				)}"
				onclick={() => onAccountSelected(row.account)}
				role="listitem"
			>
				<div class="flex-1 pl-1">{row.account}</div>
				{#if row.currencies?.length}
					<span class="text-sm opacity-60 pr-1">
						{row.currencies.join(', ')}
					</span>
				{/if}
			</div>
		{/each}
	</div>
</main>
