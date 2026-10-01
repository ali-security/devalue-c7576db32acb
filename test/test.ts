import * as assert from 'assert';
import * as vm from 'vm';
import devalue from '../src/index';

describe('devalue', () => {
	function test(name: string, input: any, expected: string) {
		it(name, () => {
			const actual = devalue(input);
			assert.equal(actual, expected);
		});
	}

	describe('basics', () => {
		test('number', 42, '42');
		test('negative number', -42, '-42');
		test('negative zero', -0, '-0');
		test('positive decimal', 0.1, '.1');
		test('negative decimal', -0.1, '-.1');
		test('string', 'woo!!!', '"woo!!!"');
		test('boolean', true, 'true');
		test('Number', new Number(42), 'Object(42)');
		test('String', new String('yar'), 'Object("yar")');
		test('Boolean', new Boolean(false), 'Object(false)');
		test('undefined', undefined, 'void 0');
		test('null', null, 'null');
		test('NaN', NaN, 'NaN');
		test('Infinity', Infinity, 'Infinity');
		test('RegExp', /regexp/img, 'new RegExp("regexp", "gim")');
		test('Date', new Date(1e12), 'new Date(1000000000000)');
		test('Array', ['a', 'b', 'c'], '["a","b","c"]');
		test('Array (empty)', [], '[]');
		test('Array (sparse)', [,'b',,], '[,"b",,]');
		test('Array (very sparse)', ((arr: any[]) => {
			arr[1000000] = 'x';
			return arr;
		})([]), 'Object.assign(Array(1000001),{1000000:"x"})');
		test('Array (very sparse, multiple values)', ((arr: any[]) => {
			arr[10] = 'a';
			arr[20] = 'b';
			return arr;
		})([]), '[,,,,,,,,,,"a",,,,,,,,,,"b"]');
		test('Object', {foo: 'bar', 'x-y': 'z'}, '{foo:"bar","x-y":"z"}');
		test('Set', new Set([1, 2, 3]), 'new Set([1,2,3])');
		test('Map', new Map([['a', 'b']]), 'new Map([["a","b"]])');
	});

	describe('strings', () => {
		test('newline', 'a\nb', JSON.stringify('a\nb'));
		test('double quotes', '"yar"', JSON.stringify('"yar"'));
		test('lone low surrogate', "a\uDC00b", '"a\\uDC00b"');
		test('lone high surrogate', "a\uD800b", '"a\\uD800b"');
		test('two low surrogates', "a\uDC00\uDC00b", '"a\\uDC00\\uDC00b"');
		test('two high surrogates', "a\uD800\uD800b", '"a\\uD800\\uD800b"');
		test('surrogate pair', '𝌆', JSON.stringify('𝌆'));
		test('surrogate pair in wrong order', 'a\uDC00\uD800b', '"a\\uDC00\\uD800b"');
		test('nul', '\0', '"\\0"');
		test('backslash', '\\', JSON.stringify('\\'));
	});

	describe('cycles', () => {
		let map = new Map();
		map.set('self', map);
		test('Map (cyclical)', map, `(function(a){a.set("self", a);return a}(new Map))`);

		let set = new Set();
		set.add(set);
		set.add(42);
		test('Set (cyclical)', set, `(function(a){a.add(a).add(42);return a}(new Set))`);

		let arr: any[] = [];
		arr[0] = arr;
		test('Array (cyclical)', arr, `(function(a){a[0]=a;return a}(Array(1)))`);

		let obj: any = {};
		obj.self = obj;
		test('Object (cyclical)', obj, `(function(a){a.self=a;return a}({}))`);

		let objFromNull: any = Object.create(null);
		objFromNull.self = objFromNull;
		test('Object (cyclical)', objFromNull, `(function(a){a.self=a;return a}(Object.create(null)))`);

		let first: any = {};
		let second: any = {};
		first.second = second;
		second.first = first;
		test('Object (cyclical)', [first, second], `(function(a,b){a.second=b;b.first=a;return [a,b]}({},{}))`);
	});

	describe('repetition', () => {
		let str = 'a string';
		test('String (repetition)', [str, str], `(function(a){return [a,a]}("a string"))`);
	});

	describe('sparse arrays', () => {
		// the largest valid array index, i.e. an array of length 2 ** 32 - 1
		const MAX_INDEX = 4294967294;

		function evaluate(js: string): any {
			return vm.runInThisContext(`(${js})`);
		}

		it('round-trips very sparse arrays', () => {
			const arr: any[] = [];
			arr[1000000] = 'x';

			const value = evaluate(devalue(arr));
			assert.equal(value.length, 1000001);
			assert.equal(value[1000000], 'x');
			assert.ok(!(0 in value));
			assert.ok(!(999999 in value));
		});

		it('round-trips very sparse arrays with multiple values', () => {
			const arr: any[] = [];
			arr[10] = 'a';
			arr[20] = 'b';

			const value = evaluate(devalue(arr));
			assert.equal(value.length, 21);
			assert.equal(value[10], 'a');
			assert.equal(value[20], 'b');
			assert.ok(!(0 in value));
			assert.ok(!(9 in value));
			assert.ok(!(11 in value));
		});

		it('handles very sparse arrays efficiently', () => {
			const arr: any[] = [];
			arr[MAX_INDEX] = 'x';

			// This should complete nearly instantly, not iterate 4 billion times
			const start = Date.now();
			const js = devalue(arr);
			const elapsed = Date.now() - start;

			assert.ok(elapsed < 1000, `devalue took ${elapsed}ms, expected < 1000ms`);
			assert.equal(js, `Object.assign(Array(${MAX_INDEX + 1}),{${MAX_INDEX}:"x"})`);

			// Verify round-trip
			const value = evaluate(js);
			assert.equal(value.length, MAX_INDEX + 1);
			assert.equal(value[MAX_INDEX], 'x');
			assert.ok(!(0 in value));
		});

		it('handles repeated very sparse arrays efficiently', () => {
			const arr: any[] = [];
			arr[MAX_INDEX] = 'x';

			const start = Date.now();
			const js = devalue([arr, arr]);
			const elapsed = Date.now() - start;

			assert.ok(elapsed < 1000, `devalue took ${elapsed}ms, expected < 1000ms`);
			assert.equal(js, `(function(a){a[${MAX_INDEX}]="x";return [a,a]}(Array(${MAX_INDEX + 1})))`);

			const value = evaluate(js);
			assert.equal(value[0], value[1]);
			assert.equal(value[0].length, MAX_INDEX + 1);
			assert.equal(value[0][MAX_INDEX], 'x');
			assert.ok(!(0 in value[0]));
		});

		it('handles cyclical very sparse arrays efficiently', () => {
			const arr: any[] = [];
			arr[MAX_INDEX] = arr;

			const start = Date.now();
			const js = devalue(arr);
			const elapsed = Date.now() - start;

			assert.ok(elapsed < 1000, `devalue took ${elapsed}ms, expected < 1000ms`);
			assert.equal(js, `(function(a){a[${MAX_INDEX}]=a;return a}(Array(${MAX_INDEX + 1})))`);

			const value = evaluate(js);
			assert.equal(value.length, MAX_INDEX + 1);
			assert.equal(value[MAX_INDEX], value);
			assert.ok(!(0 in value));
		});

		it('handles very sparse arrays nested in objects efficiently', () => {
			const arr: any[] = [];
			arr[MAX_INDEX] = { foo: 'bar' };

			const start = Date.now();
			const js = devalue({ arr });
			const elapsed = Date.now() - start;

			assert.ok(elapsed < 1000, `devalue took ${elapsed}ms, expected < 1000ms`);
			assert.equal(js, `{arr:Object.assign(Array(${MAX_INDEX + 1}),{${MAX_INDEX}:{foo:"bar"}})}`);
		});

		it('ignores non-numeric array properties in dense encoding', () => {
			// Dense path (few holes — array literal wins)
			const arr: any = [, 'a', , 'b'];
			arr.foo = 'should be ignored';
			arr.bar = 42;

			// should produce the holey literal, no mention of "foo" or "bar"
			const js = devalue(arr);
			assert.ok(js.indexOf('foo') === -1, `devalue output should not contain "foo": ${js}`);
			assert.ok(js.indexOf('bar') === -1, `devalue output should not contain "bar": ${js}`);
			assert.ok(js.indexOf('should be ignored') === -1, `devalue output should not contain non-numeric value: ${js}`);
			const value = evaluate(js);
			assert.equal(value.length, 4);
			assert.equal(value[1], 'a');
			assert.equal(value[3], 'b');
			assert.ok(!(0 in value));
		});

		it('ignores non-numeric array properties in sparse encoding', () => {
			// Sparse path (very sparse — Object.assign wins)
			const arr: any = [];
			arr[1000000] = 'x';
			arr.foo = 'should be ignored';
			arr.bar = 42;

			// should produce Object.assign form, no mention of "foo" or "bar"
			const js = devalue(arr);
			assert.ok(js.indexOf('foo') === -1, `devalue output should not contain "foo": ${js}`);
			assert.ok(js.indexOf('bar') === -1, `devalue output should not contain "bar": ${js}`);
			assert.ok(js.indexOf('should be ignored') === -1, `devalue output should not contain non-numeric value: ${js}`);
			assert.ok(js.indexOf('Object.assign') !== -1, `devalue should use Object.assign for very sparse arrays`);
			const value = evaluate(js);
			assert.equal(value.length, 1000001);
			assert.equal(value[1000000], 'x');
			assert.ok(!(0 in value));
			assert.ok(!('foo' in value));
		});

		it('ignores array properties pretending to be indices', () => {
			const arr: any = [];
			arr[1000000] = 'x';
			arr[-1] = 'negative index';
			arr[MAX_INDEX + 1] = 'too large index';
			arr['01'] = 'leading zero';

			assert.equal(devalue(arr), 'Object.assign(Array(1000001),{1000000:"x"})');
		});

		it('round-trips sparse arrays whose first hole is not at index 0', () => {
			for (const arr of [[1, , 3], [1, ,], [1, , , 4], [1, 2, , 4]]) {
				const value = evaluate(devalue(arr));
				assert.equal(value.length, arr.length, `length for keys ${Object.keys(arr).join(',')}`);
				assert.deepEqual(Object.keys(value), Object.keys(arr));
				for (const k of Object.keys(arr)) {
					assert.equal(value[k], (arr as any)[k]);
				}
			}
		});
	});

	describe('XSS', () => {
		test(
			'Dangerous string',
			`</script><script src='https://evil.com/script.js'>alert('pwned')</script><script>`,
			`"\\u003C\\u002Fscript\\u003E\\u003Cscript src='https:\\u002F\\u002Fevil.com\\u002Fscript.js'\\u003Ealert('pwned')\\u003C\\u002Fscript\\u003E\\u003Cscript\\u003E"`
		);
		test(
			'Dangerous key',
			{ '<svg onload=alert("xss_works")>': 'bar' },
			'{"\\u003Csvg onload=alert(\\"xss_works\\")\\u003E":"bar"}'
		);
		test(
			'Dangerous regex',
			/[</script><script>alert('xss')//]/,
			`new RegExp("[\\u003C\\\\\\u002Fscript\\u003E\\u003Cscript\\u003Ealert('xss')\\\\\\u002F\\\\\\u002F]", "")`
		);
	});

	describe('misc', () => {
		test('Object without prototype', Object.create(null), 'Object.create(null)');

		// let arr = [];
		// arr.x = 42;
		// test('Array with named properties', arr, `TODO`);

		test('cross-realm POJO', vm.runInNewContext('({})'), '{}');

		it('throws for non-POJOs', () => {
			class Foo {}
			const foo = new Foo();
			assert.throws(() => devalue(foo));
		});

		it('throws for symbolic keys', () => {
			assert.throws(() => devalue({ [Symbol()]: null }));
		});

		it('throws for __proto__ keys', () => {
			const inner = JSON.parse('{"__proto__":1}');
			const root = { foo: inner };
			assert.throws(
				() => devalue(root),
				(err: Error) => {
					assert.equal(err.message, 'Cannot stringify objects with __proto__ keys');
					return true;
				}
			);
		});
	});
});
