/*
    PostingEditor component tests.

    PostingEditor has no props for its data — it reads/writes the posting at
    `$xact.postings[index]` directly via the shared `xact` store, and drives
    navigation (`goto`) for the calculator and advanced-editor buttons. Tests
    seed the store before each render and assert on both the DOM and the
    resulting store state.
*/
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import PostingEditor from '$lib/components/PostingEditor.svelte';
import { xact, selectionMetadata, postingEditorIndex } from '$lib/data/mainStore';
import { Posting, Xact } from '$lib/data/model';

const { gotoMock } = vi.hoisted(() => ({ gotoMock: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));

function makeXact(postings: Array<Partial<Posting>>): Xact {
	const tx = new Xact();
	tx.postings = postings.map((overrides) => Object.assign(new Posting(), overrides));
	return tx;
}

beforeEach(() => {
	gotoMock.mockClear();
	xact.set(makeXact([{ account: 'Assets:Cash', amount: 20, currency: 'EUR' }]));
});

afterEach(() => {
	cleanup();
});

describe('PostingEditor', () => {
	it('renders the posting fields from the store', () => {
		const { getByTitle } = render(PostingEditor, { props: { index: 0 } });

		expect((getByTitle('Account') as HTMLInputElement).value).toBe('Assets:Cash');
		expect((getByTitle('Amount') as HTMLInputElement).value).toBe('20');
		expect((getByTitle('Currency') as HTMLInputElement).value).toBe('EUR');
	});

	it('flips the amount sign and notifies onAmountChanged', async () => {
		const onAmountChanged = vi.fn();
		render(PostingEditor, {
			props: { index: 0, onAmountChanged }
		});

		// The sign-flip button has no accessible name of its own (icon-only);
		// it's the second of the two leading buttons.
		const signButton = document.querySelectorAll('button')[1] as HTMLButtonElement;
		await fireEvent.click(signButton);

		expect(get(xact).postings[0].amount).toBe(-20);
		expect(onAmountChanged).toHaveBeenCalledOnce();
	});

	it('uppercases the currency as the user types', async () => {
		const { getByTitle } = render(PostingEditor, { props: { index: 0 } });

		const currencyInput = getByTitle('Currency') as HTMLInputElement;
		await fireEvent.input(currencyInput, { target: { value: 'usd' } });

		expect(get(xact).postings[0].currency).toBe('USD');
	});

	it('calls onAccountClicked when the account field is clicked', async () => {
		const onAccountClicked = vi.fn();
		const { getByTitle } = render(PostingEditor, {
			props: { index: 0, onAccountClicked }
		});

		await fireEvent.click(getByTitle('Account'));

		expect(onAccountClicked).toHaveBeenCalledOnce();
	});

	it('navigates to the calculator with amount selection metadata', async () => {
		const { getByTitle } = render(PostingEditor, { props: { index: 0 } });

		await fireEvent.click(getByTitle('Open calculator'));

		expect(gotoMock).toHaveBeenCalledWith('/calculator');
		const meta = get(selectionMetadata);
		expect(meta?.postingIndex).toBe(0);
		expect(meta?.selectionType).toBe('amount');
		expect(meta?.initialValue).toBe(20);
	});

	it('navigates to the advanced posting editor with the posting index', async () => {
		xact.set(
			makeXact([
				{ account: 'Assets:Cash', amount: 20, currency: 'EUR' },
				{ account: 'Expenses:Food', amount: -20, currency: 'EUR' }
			])
		);
		const { getByTitle } = render(PostingEditor, { props: { index: 1 } });

		await fireEvent.click(getByTitle('Advanced posting editor'));

		expect(gotoMock).toHaveBeenCalledWith('/postings/editor');
		expect(get(postingEditorIndex)).toBe(1);
	});

	it('colors the amount field by sign', () => {
		xact.set(
			makeXact([
				{ account: 'A', amount: -5, currency: 'EUR' },
				{ account: 'B', amount: 5, currency: 'EUR' }
			])
		);
		const negative = render(PostingEditor, { props: { index: 0 } });
		expect((negative.getByTitle('Amount') as HTMLInputElement).className).toContain(
			'bg-secondary/20'
		);
		negative.unmount();

		const positive = render(PostingEditor, { props: { index: 1 } });
		expect((positive.getByTitle('Amount') as HTMLInputElement).className).toContain(
			'bg-primary/20'
		);
	});
});
