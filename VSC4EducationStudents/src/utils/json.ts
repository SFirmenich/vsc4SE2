function normalize(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(normalize);
	}

	if (value !== null && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		return Object.keys(record)
			.sort()
			.reduce<Record<string, unknown>>((result, key) => {
				if (record[key] !== undefined) {
					result[key] = normalize(record[key]);
				}
				return result;
			}, {});
	}

	return value;
}

export function canonicalJson(value: unknown): string {
	return JSON.stringify(normalize(value));
}
