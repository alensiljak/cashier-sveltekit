<script lang="ts">
	import { desktopNavVisible, drawerState } from '$lib/data/mainStore';
	import { page } from '$app/state';
	import { peerConnection } from '$lib/sync/peerConnection.svelte';
	// Icons
	import {
		CalendarClockIcon,
		ChartLineIcon,
		ChartPieIcon,
		DatabaseIcon,
		WrenchIcon,
		CircleQuestionMarkIcon,
		HouseIcon,
		InfoIcon,
		LandmarkIcon,
		ScrollIcon,
		SettingsIcon,
		UsersRoundIcon,
		ContainerIcon,
		FolderOpenIcon,
		FolderInputIcon,
		FolderOutputIcon,
		ArrowLeftRightIcon,
		ChartNoAxesCombinedIcon,
		HardDriveIcon,
		CalculatorIcon,
		CalendarIcon,
		MicIcon,
		CoinsIcon,
		ListTreeIcon,
		PiggyBankIcon,
		ShieldCheckIcon,
		CloudUploadIcon,
		WifiIcon,
		FilePlusIcon,
		TerminalSquareIcon,
		SearchIcon,
		PinIcon,
		PinOffIcon
	} from '@lucide/svelte';

	function closeDrawer(): void {
		// the new drawer
		drawerState.update((state) => false);
	}

	function togglePin(): void {
		if ($desktopNavVisible) {
			// unpinning: also close the mobile overlay checkbox so the nav
			// collapses fully instead of reappearing as an open overlay.
			desktopNavVisible.set(false);
			drawerState.set(false);
		} else {
			desktopNavVisible.set(true);
		}
	}
</script>

<div class="bg-base-200 flex h-screen flex-col">
	<div class="bg-primary relative w-full p-4">
		{#if peerConnection.presence.isInRoom}
			<a
				href="/peer-sync"
				class="btn btn-circle btn-ghost btn-xs absolute top-2 left-2 border border-white/20 bg-white/10 backdrop-blur-sm"
				title="Connected to peer sync room"
				aria-label="Connected to peer sync room"
			>
				<span
					class="block h-2 w-2 rounded-full bg-green-400 shadow-[0_0_5px_1px_rgba(74,222,128,0.85)]"
				></span>
			</a>
		{/if}
		<button
			class="btn btn-square btn-ghost absolute top-2 right-2 hidden rounded border-0 lg:inline-flex"
			onclick={togglePin}
			title={$desktopNavVisible ? 'Unpin sidebar' : 'Pin sidebar'}
			aria-label={$desktopNavVisible ? 'Unpin sidebar' : 'Pin sidebar'}
		>
			{#if $desktopNavVisible}
				<PinOffIcon size={20} />
			{:else}
				<PinIcon size={20} />
			{/if}
		</button>
		<div class="flex w-full items-center justify-center">
			<img src="/icons/icon-192.png" class="w-1/3 lg:w-1/2" alt="logo" />
		</div>
		<div class="pt-2 text-center">
			<p class="text-2xl font-semibold">Cashier</p>
		</div>
	</div>

	<div class="flex-1 overflow-y-auto">
		<ul class="menu menu-lg w-full">
			<li>
				<a
					href="/"
					class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/'
						? 'active bg-secondary text-secondary-content'
						: ''}"
					onclick={closeDrawer}
				>
					<HouseIcon />
					<span>Home</span>
				</a>
			</li>
			<li>
				<a
					href="/accounts/groups"
					class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/accounts/groups'
						? 'active bg-secondary text-secondary-content'
						: ''}"
					onclick={closeDrawer}
				>
					<LandmarkIcon />
					<span>My Accounts</span>
				</a>
			</li>
			<li>
				<a
					href="/journal"
					class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/journal'
						? 'active bg-secondary text-secondary-content'
						: ''}"
					onclick={closeDrawer}
				>
					<ScrollIcon />
					<span>Journal</span>
				</a>
			</li>
			<li>
				<a
					href="/scheduled-xacts"
					class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/scheduled-xacts'
						? 'active bg-secondary text-secondary-content'
						: ''}"
					onclick={closeDrawer}
				>
					<CalendarClockIcon />
					<span>Scheduled Transactions</span>
				</a>
			</li>
			<li>
				<a
					href="/tx"
					class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/tx'
						? 'active bg-secondary text-secondary-content'
						: ''}"
					onclick={closeDrawer}
				>
					<FilePlusIcon />
					<span>New Transaction</span>
				</a>
			</li>
		</ul>

		<div class="divider divider-primary m-1"></div>

		<ul class="menu menu-lg w-full">
			<li>
				<details>
					<summary class="flex w-full items-center gap-2 py-2 text-lg font-medium">
						<ChartNoAxesCombinedIcon size={22} />
						<span>Analysis</span>
						<span class="flex-1"></span>
					</summary>
					<ul>
						<li>
							<a
								href="/reports"
								class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/reports'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<ChartLineIcon />
								<span>Reports</span>
							</a>
						</li>
						<li>
							<a
								href="/budget"
								class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/budget'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<PiggyBankIcon />
								<span>Budget</span>
							</a>
						</li>
						<li>
							<a
								href="/accounts/tree"
								class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/accounts/tree'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<ListTreeIcon />
								<span>Account Tree</span>
							</a>
						</li>
						<li>
							<a
								href="/scheduled-xacts/calendar"
								class="flex w-full items-center gap-2 py-2"
								onclick={closeDrawer}
							>
								<CalendarIcon />
								<span>Calendar</span>
							</a>
						</li>
						<li>
							<a
								href="/asset-allocation"
								class="flex w-full items-center gap-2 py-2 {page.url.pathname ===
								'/asset-allocation'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<ChartPieIcon />
								<span>Asset Allocation</span>
							</a>
						</li>
					</ul>
				</details>
			</li>
			<li>
				<details>
					<summary class="flex w-full items-center gap-2 py-2 text-lg font-medium">
						<ScrollIcon size={22} />
						<span>Ledger</span>
						<span class="flex-1"></span>
					</summary>
					<ul>
						<li>
							<a
								href="/accounts"
								class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/accounts'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<LandmarkIcon />
								<span>Accounts</span>
							</a>
						</li>
						<li>
							<a
								href="/payees"
								class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/payees'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<UsersRoundIcon />
								<span>Payees</span>
							</a>
						</li>
						<li>
							<a
								href="/commodities"
								class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/commodities'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<CoinsIcon />
								<span>Commodities</span>
							</a>
						</li>
					</ul>
				</details>
			</li>
			<li>
				<details>
					<summary class="flex w-full items-center gap-2 py-2 text-lg font-medium">
						<HardDriveIcon size={22} />
						<span>Data</span>
						<span class="flex-1"></span>
					</summary>
					<ul>
						<li>
							<a
								href="/opfs/import-ledger"
								class="flex w-full items-center gap-2 py-2 {page.url.pathname ===
								'/opfs/import-ledger'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<FolderInputIcon />
								<span>Ledger Import</span>
							</a>
						</li>
						<li>
							<a
								href="/opfs/export-ledger"
								class="flex w-full items-center gap-2 py-2 {page.url.pathname ===
								'/opfs/export-ledger'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<FolderOutputIcon />
								<span>Ledger Export</span>
							</a>
						</li>
						<!-- <li>
							<a
								href="/opfs/sync"
								class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/opfs/sync'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<ArrowLeftRightIcon />
								<span>Sync</span>
							</a>
						</li> -->
						<li>
							<a
								href="/backup"
								class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/backup'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<DatabaseIcon />
								<span>Backup</span>
							</a>
						</li>
						<li>
							<a
								href="/backup/webdav"
								class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/backup/webdav'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<CloudUploadIcon />
								<span>WebDAV Backup</span>
							</a>
						</li>
						<li>
							<a
								href="/opfs"
								class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/opfs'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<FolderOpenIcon />
								<span>File Storage</span>
							</a>
						</li>
						<li>
							<a
								href="/peer-sync"
								class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/peer-sync'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<WifiIcon />
								<span>Peer Sync</span>
							</a>
						</li>
						<li>
							<a
								href="/sync/beancount"
								class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/sync/beancount'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<ArrowLeftRightIcon />
								<span>Beancount Sync</span>
							</a>
						</li>
					</ul>
				</details>
			</li>
			<li>
				<details>
					<summary class="flex w-full items-center gap-2 py-2 text-lg font-medium">
						<WrenchIcon size={22} />
						<span>Utilities</span>
						<span class="flex-1"></span>
					</summary>
					<ul>
						<li>
							<a
								href="/util/cache"
								class="flex w-full items-center gap-2 py-2 {page.url.pathname ===
								'/util/cache'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<ContainerIcon />
								<span>Cache</span>
							</a>
						</li>
						<li>
							<a
								href="/calculator"
								class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/calculator'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<CalculatorIcon />
								<span>Calculator</span>
							</a>
						</li>
						<li>
							<a
								href="/currency-converter"
								class="flex w-full items-center gap-2 py-2 {page.url.pathname ===
								'/currency-converter'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<CoinsIcon />
								<span>Currency Converter</span>
							</a>
						</li>
						<li>
							<a
								href="/search/full-text"
								class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/search/full-text'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<SearchIcon />
								<span>Search</span>
							</a>
						</li>
						<li>
							<a
								href="/util/validation"
								class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/util/validation'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<ShieldCheckIcon />
								<span>Validation</span>
							</a>
						</li>
						<li>
							<a
								href="/util/quick-query"
								class="flex w-full items-center gap-2 py-2 {page.url.pathname ===
								'/util/quick-query'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<TerminalSquareIcon />
								<span>Quick Query</span>
							</a>
						</li>
					</ul>
				</details>
			</li>
			<!-- <li>
				<a
					href="/peer-sync"
					class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/peer-sync'
						? 'active bg-secondary text-secondary-content'
						: ''}"
					onclick={closeDrawer}
				>
					<RefreshCw />
					<span>Peer Sync</span>
				</a>
			</li> -->
		</ul>

		<div class="divider divider-primary m-1"></div>

		<ul class="menu menu-lg w-full">
			<li>
				<a
					href="/help"
					class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/help'
						? 'active bg-secondary text-secondary-content'
						: ''}"
					onclick={closeDrawer}
				>
					<CircleQuestionMarkIcon />
					<span>Help</span>
				</a>
			</li>
			<li>
				<a
					href="/about"
					class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/about'
						? 'active bg-secondary text-secondary-content'
						: ''}"
					onclick={closeDrawer}
				>
					<InfoIcon />
					<span>About</span>
				</a>
			</li>
			<li>
				<a
					href="/settings"
					class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/settings'
						? 'active bg-secondary text-secondary-content'
						: ''}"
					onclick={closeDrawer}
				>
					<SettingsIcon />
					<span>Settings</span>
				</a>
			</li>
		</ul>
	</div>
</div>
