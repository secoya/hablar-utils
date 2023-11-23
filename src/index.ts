export interface Context<SafeString extends { toString(): string }> {
	/**
	 * Gets the textual representation of the SafeString. In most cases this would simply call .toString()
	 * on the instance.
	 */
	convertSafeString(val: SafeString): string;
	/**
	 * Encodes a string to make it safe to render in the wanted environment.
	 * IE for web apps this should perform some kind of html encoding.
	 */
	encode(str: string): string;
	/**
	 * Determines if the value is of the given choice of safe string. A safe string is a
	 * value that has been decided to be safe to render without encoding.
	 */
	isSafeString(val: any): val is SafeString;

	/**
	 * Constructs a new safe string with the chosen text value.
	 */
	makeSafeString(str: string): SafeString;
}

export interface FunctionMap<SafeString extends { toString(): string }> {
	[key: string]: (context: Context<SafeString>, ...parameters: any[]) => any;
}

export class Translator<SafeString extends { toString(): string }> {
	private readonly context: Context<SafeString>;
	private readonly functions: FunctionMap<SafeString>;
	private readonly translations: any;

	public constructor(context: Context<SafeString>, functions: FunctionMap<SafeString>, translations: any) {
		if (translations == null) {
			throw new Error('Invalid translations passed');
		}
		this.context = context;
		this.functions = functions;
		this.translations = translations;
	}

	public hasKey(key: string): boolean {
		return this.translations[key] != null;
	}

	public translate(key: string, variables?: { [key: string]: any }): string {
		if (this.translations[key] == null) {
			throw new Error('No translation for key: ' + key);
		}

		const translation = this.translations[key];

		if (typeof translation === 'string') {
			return this.context.encode(translation);
		}
		return translation(variables, this.functions, this.context);
	}
}
