<script lang="ts">
	import { MenuIcon } from 'lucide-svelte';
</script>

<div class="toolbar relative flex bg-primary-800 p-2">
	<button class="btn btn-sm ">
		<MenuIcon />
	</button>
	<h4 class="ml-3 h4 leading-8">
    My Toolbar
  </h4>
	<div class="gloss-effect absolute inset-0"></div>
</div>

<!-- <div class="bg-gradient-to-r from-purple-500 to-pink-500 min-h-screen flex items-center justify-center p-8">
  <div class="bg-white/30 backdrop-blur-md rounded-xl border border-white/20 shadow-lg p-6 max-w-sm">
    <h2 class="text-2xl font-bold mb-4 text-white">Glossy Card</h2>
    <p class="text-white/80">This card demonstrates the gloss effect using Tailwind CSS.</p>
  </div>
</div> -->

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
