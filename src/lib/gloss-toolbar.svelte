<script>
	import { MenuIcon } from 'lucide-svelte';
</script>

<div class="toolbar relative flex bg-primary-800 p-2">
	<button class="btn btn-sm ">
		<MenuIcon />
	</button>
	<h4 class="text-primary ml-3 h4 leading-8">
    My Toolbar
  </h4>
	<div class="gloss-effect absolute inset-0"></div>
</div>

<style>
	.gloss-effect {
		background: linear-gradient(to bottom, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0));
		pointer-events: none; /* Allows interaction with underlying elements */
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background-size: 200px; /* Adjust size for shimmer effect */
		animation: shimmer 2s infinite linear; /* Optional shimmering effect */
	}

	@keyframes shimmer {
		from {
			background-position: -200px;
		}
		to {
			background-position: 200px;
		}
	}
</style>
