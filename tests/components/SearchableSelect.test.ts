import { render, fireEvent, cleanup } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SearchableSelect from '../../src/lib/components/SearchableSelect.svelte';

describe('SearchableSelect', () => {
	it('should navigate with arrow keys', async () => {
		const options = ['Assets:Cash', 'Assets:Bank', 'Assets:Investments'];
		render(SearchableSelect, {
			props: { options, value: '', placeholder: 'Select account...' }
		});

		// Open the dropdown
		const selectButton = document.querySelector('.select.select-bordered') as HTMLButtonElement;
		await fireEvent.click(selectButton);

		// Get the filter input
		const filterInput = document.querySelector(
			'input[placeholder="Filter..."]'
		) as HTMLInputElement;

		// Type to filter
		await fireEvent.input(filterInput, { target: { value: 'Assets' } });

		// Press ArrowDown to select first item
		await fireEvent.keyDown(filterInput, { key: 'ArrowDown', code: 'ArrowDown' });

		// Press ArrowDown again to select second item
		await fireEvent.keyDown(filterInput, { key: 'ArrowDown', code: 'ArrowDown' });

		// Press ArrowUp to go back to first item
		await fireEvent.keyDown(filterInput, { key: 'ArrowUp', code: 'ArrowUp' });

		// Verify selection works with Enter
		await fireEvent.keyDown(filterInput, { key: 'Enter', code: 'Enter' });

		// Check that the selected value is correct
		const selectedValue = (
			document.querySelector('.select.select-bordered span') as HTMLSpanElement
		).textContent;
		expect(selectedValue).toContain('Assets:Cash');
		expect(selectedValue).not.toContain('Assets:Bank');
	});

	it('should close on Escape', async () => {
		const options = ['Assets:Cash', 'Assets:Bank'];
		render(SearchableSelect, {
			props: { options, value: '', placeholder: 'Select account...' }
		});

		// Open the dropdown
		const selectButton = document.querySelector('.select.select-bordered') as HTMLButtonElement;
		await fireEvent.click(selectButton);

		// Get the filter input
		const filterInput = document.querySelector(
			'input[placeholder="Filter..."]'
		) as HTMLInputElement;

		// Press Escape to close
		await fireEvent.keyDown(filterInput, { key: 'Escape', code: 'Escape' });

		// Verify dropdown is closed
		const dropdown = document.querySelector('.absolute.z-50');
		expect(dropdown).toBeNull();
	});
});
