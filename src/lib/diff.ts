export enum DiffKind {
	Same = "same",
	Removed = "removed",
	Added = "added",
}

export interface DiffLine {
	kind: DiffKind;
	text: string;
}

interface DiffLinesParams {
	oldText: string;
	newText: string;
}

// ponytail: O(n·m) LCS; permission-prompt edits are small, cap keeps it bounded
const MAX_LINES = 400;

function splitLines(text: string): string[] {
	return text === "" ? [] : text.split("\n").slice(0, MAX_LINES);
}

export function diffLines({ oldText, newText }: DiffLinesParams): DiffLine[] {
	const a = splitLines(oldText);
	const b = splitLines(newText);
	const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
		new Array(b.length + 1).fill(0),
	);
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) {
			lcs[i][j] =
				a[i] === b[j]
					? lcs[i + 1][j + 1] + 1
					: Math.max(lcs[i + 1][j], lcs[i][j + 1]);
		}
	}

	const out: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		const same = a[i] === b[j];
		const preferRemove = !same && lcs[i + 1][j] >= lcs[i][j + 1];
		same && out.push({ kind: DiffKind.Same, text: a[i] });
		!same && preferRemove && out.push({ kind: DiffKind.Removed, text: a[i] });
		!same && !preferRemove && out.push({ kind: DiffKind.Added, text: b[j] });
		i += same || preferRemove ? 1 : 0;
		j += same || !preferRemove ? 1 : 0;
	}
	out.push(...a.slice(i).map((text) => ({ kind: DiffKind.Removed, text })));
	out.push(...b.slice(j).map((text) => ({ kind: DiffKind.Added, text })));
	return out;
}
