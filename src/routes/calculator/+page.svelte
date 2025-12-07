<script lang="ts">
	// For complex expressions with parentheses, we'll use a more sophisticated approach
	import Fab from '$lib/components/FAB.svelte';
	import { Check } from '@lucide/svelte';
	import { selectionMetadata } from '$lib/data/mainStore';

	let displayValue = $state('0');
	let expression = $state('');
	let currentExpression = $state('');
	let lastExpression = $state('');

	const inputNumber = (num: string) => {
		// If the display currently shows the result of a previous calculation, start a new expression
		if (currentExpression === displayValue && lastExpression !== '') {
			currentExpression = num;
			displayValue = num;
		} else if (currentExpression === '' || currentExpression === '0') {
			currentExpression = num;
			displayValue = num;
		} else {
			currentExpression += num;
			// Show the full current number being typed
			const parts = currentExpression.split(/[\+\-\×\÷\(\)]/);
			const lastPart = parts[parts.length - 1];
			displayValue = lastPart || num;
		}
	};

	const inputDecimal = () => {
		// If the display currently shows the result of a previous calculation, start a new expression
		if (currentExpression === displayValue && lastExpression !== '') {
			const parts = displayValue.split(/[\+\-\×\÷\(\)]/);
			const lastPart = parts[parts.length - 1] || '';
			if (!lastPart.includes('.')) {
				currentExpression = displayValue + '.';
				displayValue = lastPart + '.';
			}
		} else {
			// Only add decimal if the current number doesn't already have one
			const parts = currentExpression.split(/[\+\-\×\÷\(\)]/);
			const lastPart = parts[parts.length - 1] || '';
			if (!lastPart.includes('.')) {
				currentExpression += '.';
				displayValue = lastPart + '.';
			}
		}
	};

	const clear = () => {
		currentExpression = '';
		lastExpression = '';
		displayValue = '0';
		expression = '';
	};

	const backspace = () => {
		if (currentExpression.length > 0) {
			currentExpression = currentExpression.slice(0, -1);
			// Update display to show the last number in the expression
			if (currentExpression === '') {
				displayValue = '0';
			} else {
				// Extract the last number after any operators
				const parts = currentExpression.split(/[\+\-\×\÷\(\)]/);
				const lastPart = parts[parts.length - 1];
				displayValue = lastPart || '0';
			}
		}
	};

	const inputParenthesis = (paren: string) => {
		currentExpression += paren;
		displayValue = paren; // Show the parenthesis that was just entered
	};

	const inputOperator = (op: string) => {
		// If the display currently shows the result of a previous calculation, start a new expression with the result
		if (currentExpression === displayValue && lastExpression !== '') {
			currentExpression = displayValue + op;
			displayValue = op; // Show the operator that was just entered
		} else if (currentExpression && !['+', '-', '×', '÷'].includes(currentExpression.slice(-1))) {
			currentExpression += op;
			displayValue = op; // Show the operator that was just entered
		}
	};

	const toggleSign = () => {
		// If the display currently shows the result of a previous calculation, toggle the sign of that result
		if (currentExpression === displayValue && lastExpression !== '') {
			const resultNum = parseFloat(displayValue);
			if (!isNaN(resultNum)) {
				const toggledNum = (resultNum * -1).toString();
				currentExpression = toggledNum;
				displayValue = toggledNum;
			}
		} else if (
			currentExpression === '' ||
			['+', '-', '×', '÷', '(', ')'].includes(currentExpression.slice(-1))
		) {
			currentExpression += '-';
			displayValue = '-'; // Show the minus sign that was just entered
		} else {
			// For now, we'll just add a minus at the start of the current number
			const parts = currentExpression.split(/([+\-×÷()])/);
			const lastPart = parts[parts.length - 1];
			if (lastPart && !isNaN(parseFloat(lastPart))) {
				// Replace the last number with its negative
				const lastNum = parseFloat(lastPart);
				const newNum = (lastNum * -1).toString();
				currentExpression = currentExpression.slice(0, -lastPart.length) + newNum;
				// Update display to show the full current number
				const displayParts = currentExpression.split(/[\+\-\×\÷\(\)]/);
				const displayLastPart = displayParts[displayParts.length - 1];
				displayValue = displayLastPart || newNum;
			}
		}
	};

	const inputPercent = () => {
		// If the display currently shows the result of a previous calculation, convert that result to percentage
		if (currentExpression === displayValue && lastExpression !== '') {
			const resultNum = parseFloat(displayValue);
			if (!isNaN(resultNum)) {
				const percentNum = (resultNum / 100).toString();
				currentExpression = percentNum;
				displayValue = percentNum;
			}
		} else {
			// Convert the last number to percentage
			const parts = currentExpression.split(/([+\-×÷()])/);
			const lastPart = parts[parts.length - 1];
			if (lastPart && !isNaN(parseFloat(lastPart))) {
				const lastNum = parseFloat(lastPart);
				const newNum = (lastNum / 100).toString();
				currentExpression = currentExpression.slice(0, -lastPart.length) + newNum;
				// Update display to show the full current number
				const displayParts = currentExpression.split(/[\+\-\×\÷\(\)]/);
				const displayLastPart = displayParts[displayParts.length - 1];
				displayValue = displayLastPart || newNum;
			}
		}
	};

	// Safe evaluation function that handles parentheses and operations properly
	const evaluateExpression = (expr: string): number => {
		// Remove extra spaces
		expr = expr.replace(/\s+/g, '');

		// Check for balanced parentheses
		const openCount = (expr.match(/\(/g) || []).length;
		const closeCount = (expr.match(/\)/g) || []).length;
		if (openCount !== closeCount) {
			throw new Error('Unbalanced parentheses');
		}

		// Replace our operators with JavaScript operators
		expr = expr.replace(/×/g, '*').replace(/÷/g, '/');

		// Only allow safe characters: numbers, operators, parentheses, decimal point
		if (!/^[0-9+\-*/().]+$/.test(expr)) {
			throw new Error('Invalid characters in expression');
		}

		// Use Function constructor for safe evaluation (alternative to eval)
		return new Function('return ' + expr)();
	};

	const handleEquals = () => {
		if (currentExpression) {
			lastExpression = currentExpression;
			try {
				const result = evaluateExpression(currentExpression);
				displayValue = result.toString();
				// Keep the current expression unchanged so the formula stays visible in the small display
				// currentExpression remains as the full formula
			} catch (e) {
				displayValue = 'Error';
				console.error('Calculation error:', e);
			}
		}
	};

	/**
	 * Function to execute when the FAB is clicked
	 */
	function onFabClicked() {
		if (isInSelectionMode) {
			// store the value.
			if ($selectionMetadata) {
				$selectionMetadata.selectedId = name;
			}

			history.back();
		} else {
			goto('/account'); // todo: show account details
		}

		history.back();
	}
</script>

<article
	class="flex h-screen flex-col items-center justify-center bg-gradient-to-b from-gray-700 to-gray-900 p-4"
>
	<div
		class="w-full max-w-xs rounded-2xl border-2 border-gray-500 bg-gradient-to-b from-gray-400 to-gray-600 p-5 shadow-2xl"
	>
		<!-- Calculator Display -->
		<div class="mb-4 rounded-lg border border-gray-700 bg-black p-4 shadow-inner">
			<div
				class="min-h-6 overflow-x-auto text-right font-mono text-sm whitespace-nowrap text-green-400"
			>
				{currentExpression}
			</div>
			<div
				class="mt-1 overflow-x-auto text-right font-mono text-3xl font-bold whitespace-nowrap text-green-400"
			>
				{displayValue}
			</div>
		</div>

		<!-- Calculator Buttons -->
		<div class="grid grid-cols-4 gap-2">
			<button
				class="btn btn-lg rounded-lg border border-gray-500 bg-gray-300 text-lg font-bold text-gray-800 shadow-md hover:bg-gray-400"
				onclick={clear}
			>
				AC
			</button>
			<button
				class="btn btn-lg rounded-lg border border-gray-500 bg-gray-300 text-lg font-bold text-gray-800 shadow-md hover:bg-gray-400"
				onclick={() => inputParenthesis('(')}
			>
				(
			</button>
			<button
				class="btn btn-lg rounded-lg border border-gray-500 bg-gray-300 text-lg font-bold text-gray-800 shadow-md hover:bg-gray-400"
				onclick={() => inputParenthesis(')')}
			>
				)
			</button>
			<button
				class="btn btn-lg rounded-lg border border-gray-500 bg-gray-300 text-lg font-bold text-gray-800 shadow-md hover:bg-gray-400"
				onclick={backspace}
			>
				⌫
			</button>

			<button
				class="btn btn-lg flex items-center justify-center rounded-lg border border-gray-500 bg-gray-900 text-lg font-bold text-gray-800 shadow-md hover:bg-gray-400"
			>
				<img src="/icons/cashier-logo.svg" alt="Cashier Logo" width="20" height="20" />
			</button>
			<button
				class="btn btn-lg rounded-lg border border-gray-500 bg-gray-300 text-lg font-bold text-gray-800 shadow-md hover:bg-gray-400"
				onclick={toggleSign}
			>
				+/-
			</button>
			<button
				class="btn btn-lg rounded-lg border border-gray-500 bg-gray-300 text-lg font-bold text-gray-800 shadow-md hover:bg-gray-400"
				onclick={inputPercent}
			>
				%
			</button>
			<button
				class="btn btn-lg rounded-lg border border-orange-600 bg-orange-500 text-xl font-bold text-white shadow-md hover:bg-orange-600"
				onclick={() => inputOperator('÷')}
			>
				÷
			</button>

			<button
				class="btn btn-lg rounded-lg border border-gray-400 bg-gray-200 text-xl font-bold text-gray-800 shadow-md hover:bg-gray-300"
				onclick={() => inputNumber('7')}
			>
				7
			</button>
			<button
				class="btn btn-lg rounded-lg border border-gray-400 bg-gray-200 text-xl font-bold text-gray-800 shadow-md hover:bg-gray-300"
				onclick={() => inputNumber('8')}
			>
				8
			</button>
			<button
				class="btn btn-lg rounded-lg border border-gray-400 bg-gray-200 text-xl font-bold text-gray-800 shadow-md hover:bg-gray-300"
				onclick={() => inputNumber('9')}
			>
				9
			</button>
			<button
				class="btn btn-lg rounded-lg border border-orange-600 bg-orange-500 text-xl font-bold text-white shadow-md hover:bg-orange-600"
				onclick={() => inputOperator('×')}
			>
				×
			</button>

			<button
				class="btn btn-lg rounded-lg border border-gray-400 bg-gray-200 text-xl font-bold text-gray-800 shadow-md hover:bg-gray-300"
				onclick={() => inputNumber('4')}
			>
				4
			</button>
			<button
				class="btn btn-lg rounded-lg border border-gray-400 bg-gray-200 text-xl font-bold text-gray-800 shadow-md hover:bg-gray-300"
				onclick={() => inputNumber('5')}
			>
				5
			</button>
			<button
				class="btn btn-lg rounded-lg border border-gray-400 bg-gray-200 text-xl font-bold text-gray-800 shadow-md hover:bg-gray-300"
				onclick={() => inputNumber('6')}
			>
				6
			</button>
			<button
				class="btn btn-lg rounded-lg border border-orange-600 bg-orange-500 text-xl font-bold text-white shadow-md hover:bg-orange-600"
				onclick={() => inputOperator('+')}
			>
				+
			</button>

			<button
				class="btn btn-lg rounded-lg border border-gray-400 bg-gray-200 text-xl font-bold text-gray-800 shadow-md hover:bg-gray-300"
				onclick={() => inputNumber('1')}
			>
				1
			</button>
			<button
				class="btn btn-lg rounded-lg border border-gray-400 bg-gray-200 text-xl font-bold text-gray-800 shadow-md hover:bg-gray-300"
				onclick={() => inputNumber('2')}
			>
				2
			</button>
			<button
				class="btn btn-lg rounded-lg border border-gray-400 bg-gray-200 text-xl font-bold text-gray-800 shadow-md hover:bg-gray-300"
				onclick={() => inputNumber('3')}
			>
				3
			</button>
			<button
				class="btn btn-lg rounded-lg border border-orange-600 bg-orange-500 text-xl font-bold text-white shadow-md hover:bg-orange-600"
				onclick={() => inputOperator('-')}
			>
				-
			</button>

			<button
				class="btn btn-lg col-span-2 rounded-lg border border-gray-400 bg-gray-200 text-xl font-bold text-gray-800 shadow-md hover:bg-gray-300"
				onclick={() => inputNumber('0')}
			>
				0
			</button>

			<button
				class="btn btn-lg rounded-lg border border-gray-400 bg-gray-200 text-xl font-bold text-gray-800 shadow-md hover:bg-gray-300"
				onclick={inputDecimal}
			>
				.
			</button>
			<button
				class="btn btn-lg rounded-lg border border-gray-400 bg-gray-900 text-xl font-bold text-gray-200 shadow-md hover:bg-gray-700"
				onclick={handleEquals}
			>
				=
			</button>
		</div>
	</div>
	<Fab Icon={Check} onclick={onFabClicked} />
</article>
