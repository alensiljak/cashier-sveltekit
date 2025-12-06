import { writable } from 'svelte/store';

// Define the type for our theme
type Theme = 'cashiertheme' | 'cashierthemedark' | 'dark' | 'light';

// Create the store with initial value based on system preference or default
const getInitialTheme = (): Theme => {
	const savedTheme = localStorage.getItem('theme') as Theme | null;
	if (savedTheme && ['cashiertheme', 'cashierthemedark', 'dark', 'light'].includes(savedTheme)) {
		return savedTheme;
	}
	
	// Default to light theme, but could use system preference
	return 'cashiertheme';
};

// Create the writable store
const themeStore = writable<Theme>(getInitialTheme());

// Subscribe to changes to update localStorage and apply theme
themeStore.subscribe((currentTheme) => {
	localStorage.setItem('theme', currentTheme);
	
	// Apply the theme to the document
	if (typeof document !== 'undefined') {
		const html = document.querySelector('html');
		if (html) {
			html.setAttribute('data-theme', currentTheme);
		}
	}
});

// Function to toggle between light and dark themes
const toggleTheme = () => {
	themeStore.update((current) => {
		if (current === 'cashiertheme' || current === 'light') {
			return 'cashierthemedark';
		} else {
			return 'cashiertheme';
		}
	});
};

// Function to set a specific theme
const setTheme = (theme: Theme) => {
	themeStore.set(theme);
};

export { themeStore, toggleTheme, setTheme, type Theme };