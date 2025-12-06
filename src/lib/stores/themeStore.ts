import { writable } from 'svelte/store';

// Define the type for our theme
type Theme = 'cashiertheme' | 'cashierthemedark' | 'dark' | 'light';

// Create the store with initial value based on system preference or default
const getInitialTheme = (): Theme => {
	const savedTheme = localStorage.getItem('theme') as Theme | null;
	if (savedTheme && ['cashiertheme', 'cashierthemedark', 'dark', 'light'].includes(savedTheme)) {
		return savedTheme;
	}

	// Check for system preference if no saved theme
	if (typeof window !== 'undefined' && window.matchMedia) {
		const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		return prefersDark ? 'cashierthemedark' : 'cashiertheme';
	}

	// Default to dark theme if we can't detect system preference
	return 'cashierthemedark';
};

// Create the writable store
const themeStore = writable<Theme>(getInitialTheme());

// Subscribe to changes to update localStorage and apply theme
themeStore.subscribe((currentTheme) => {
	localStorage.setItem('theme', currentTheme);

	// Apply the theme to the document
	if (typeof document !== 'undefined') {
		const html = document.documentElement; // Use documentElement instead of querySelector
		if (html) {
			html.setAttribute('data-theme', currentTheme);

			// Also update the class to match daisyUI expectations
			html.classList.remove('dark', 'light');
			if (currentTheme.includes('dark')) {
				html.classList.add('dark');
			} else {
				html.classList.add('light');
			}
		}
	}
});

// Function to set a specific theme
const setTheme = (theme: Theme) => {
	themeStore.set(theme);
};

export { themeStore, setTheme, type Theme };