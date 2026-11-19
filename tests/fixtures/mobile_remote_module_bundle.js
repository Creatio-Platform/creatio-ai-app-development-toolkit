// A hand-written stand-in for a built remote module: one self-running script that takes the SDK from
// the global `crtSdk` and registers one save handler. It implements the rule that the sample table in
// context/mobile-module-behaviour-check.md describes, so the sample
// harness can be run against it.
(() => {
	const sdk = crtSdk;

	const ATTRIBUTE = 'PDS_Vin';
	const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
	const LETTER_VALUES = {
		A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
		J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
		S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
	};

	function normalize(value) {
		return String(value ?? '').replace(/\s+/g, '').toUpperCase();
	}

	function isValidVin(vin) {
		if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
			return false;
		}
		let sum = 0;
		for (let index = 0; index < vin.length; index++) {
			const char = vin[index];
			const value = char >= '0' && char <= '9' ? Number(char) : LETTER_VALUES[char];
			sum += value * WEIGHTS[index];
		}
		const remainder = sum % 11;
		return vin[8] === (remainder === 10 ? 'X' : String(remainder));
	}

	class CarVinSaveGuard extends sdk.BaseRequestHandler {
		async handle(request) {
			const context = request.$context;
			const entered = await context.getAttribute(ATTRIBUTE);
			const vin = normalize(entered);
			if (vin === '') {
				return this.next?.handle(request);
			}
			if (!isValidVin(vin)) {
				await new sdk.DialogService(context).open({
					message: 'Check the VIN: it has 17 characters and a check digit.',
					actions: [{ key: 'ok', config: { caption: 'OK' } }],
				});
				return undefined;
			}
			if (vin !== entered) {
				await context.setAttribute(ATTRIBUTE, vin);
			}
			return this.next?.handle(request);
		}
	}
	sdk.CrtRequestHandler({
		requestType: 'crt.SaveRecordRequest',
		type: 'usr.CarVinSaveGuard',
		scopes: ['Car_MobileFormPage'],
	})(CarVinSaveGuard);

	class CarVinCheck {
		bootstrap() {
			sdk.bootstrapCrtModule('CarVinCheck', CarVinCheck);
		}
	}
	sdk.CrtModule({ requestHandlers: [CarVinSaveGuard] })(CarVinCheck);
})();
