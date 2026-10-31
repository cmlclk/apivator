// Yerel ESLint kurallarının birim testi (apps/web vitest'i ile koşar).
import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import noLiteralJsxText from './no-literal-jsx-text.js';
import noPhysicalDirection from './no-physical-direction.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

tester.run('no-literal-jsx-text', noLiteralJsxText, {
  valid: [
    '<div>{t("a.b")}</div>',
    '<div>  {count}  </div>',
    '<div>12 / 34 · —</div>',
    '<div>Apivator</div>',
    '<div>JSON</div>',
    '<div>GET POST</div>',
    '<code>Content-Type</code>',
    '<code>{{token}}</code>',
    '<code>pm.test("x", fn)</code>',
    '<kbd>Ctrl</kbd>',
    '<input aria-label={t("a")} />',
    '<input placeholder="https://api.example.com/v1" />',
    '<input placeholder={\'{ "id": 1 }\'} />',
    '<input title="12:30" />',
    '<div data-testid="Merhaba dünya" />',
    '<div className="Merhaba dünya" />',
    '<Field label={`${a}${b}`} />',
    '<div>{"· "}</div>',
  ],
  invalid: [
    { code: '<div>Merhaba</div>', errors: [{ messageId: 'text' }] },
    { code: '<button>Kaydet</button>', errors: [{ messageId: 'text' }] },
    { code: '<div>{count} dosya</div>', errors: [{ messageId: 'text' }] },
    { code: '<div>Hello Apivator</div>', errors: [{ messageId: 'text' }] },
    { code: '<div>{"Merhaba"}</div>', errors: [{ messageId: 'text' }] },
    { code: '<div>{`Merhaba ${x}`}</div>', errors: [{ messageId: 'text' }] },
    { code: '<input placeholder="Ara" />', errors: [{ messageId: 'attribute' }] },
    { code: '<input title="Kapat" />', errors: [{ messageId: 'attribute' }] },
    { code: '<button aria-label="Kapat" />', errors: [{ messageId: 'attribute' }] },
    { code: '<img alt="Logo" />', errors: [{ messageId: 'attribute' }] },
    { code: '<Field label="Ad" />', errors: [{ messageId: 'attribute' }] },
    { code: '<Field label={"Ad"} />', errors: [{ messageId: 'attribute' }] },
    { code: '<Field label={`Ad ${x}`} />', errors: [{ messageId: 'attribute' }] },
    { code: '<input aria-description="Açıklama" />', errors: [{ messageId: 'attribute' }] },
    { code: '<input aria-placeholder="Ara" />', errors: [{ messageId: 'attribute' }] },
    { code: '<input placeholder="Ara (isteğe bağlı)" />', errors: [{ messageId: 'attribute' }] },
  ],
});

tester.run('no-physical-direction', noPhysicalDirection, {
  valid: [
    '<div className="ms-2 pe-3 start-0 text-start border-s rounded-ss" />',
    '<div className="sm:ps-4 group-hover:end-0 -ms-1" />',
    '<div className="mx-2 px-2 inset-x-0 left-1/2 -translate-x-1/2 rtl:translate-x-1/2" />'.replace(
      'left-1/2 ',
      'start-1/2 ',
    ),
    'const a = "right-click"',
    'const a = "Sol tarafa tıkla"',
    'cn("flex", cond && "ms-1")',
    '<div className="rounded-lg border-lime-500 prose pr" />',
  ],
  invalid: [
    {
      code: '<div className="ml-2" />',
      output: '<div className="ms-2" />',
      errors: [{ messageId: 'physical' }],
    },
    { code: '<div className="mr-auto" />', output: '<div className="me-auto" />', errors: 1 },
    { code: '<div className="-ml-1 pl-4 pr-2" />', output: '<div className="-ms-1 ps-4 pe-2" />', errors: 3 },
    { code: '<div className="sm:pl-4" />', output: '<div className="sm:ps-4" />', errors: 1 },
    {
      code: '<div className="group-hover:right-0" />',
      output: '<div className="group-hover:end-0" />',
      errors: 1,
    },
    {
      code: '<div className="text-left text-right" />',
      output: '<div className="text-start text-end" />',
      errors: 2,
    },
    {
      code: '<div className="border-l border-r-2" />',
      output: '<div className="border-s border-e-2" />',
      errors: 2,
    },
    {
      code: '<div className="rounded-l rounded-r-md rounded-tl rounded-tr rounded-bl rounded-br" />',
      output: '<div className="rounded-s rounded-e-md rounded-ss rounded-se rounded-es rounded-ee" />',
      errors: 6,
    },
    {
      code: '<div className="scroll-ml-2 scroll-pr-4" />',
      output: '<div className="scroll-ms-2 scroll-pe-4" />',
      errors: 2,
    },
    { code: '<div className="float-left" />', output: '<div className="float-start" />', errors: 1 },
    { code: '<div className="ml-[22px]" />', output: '<div className="ms-[22px]" />', errors: 1 },
    {
      code: 'const c = cn("flex", on && "ml-1", { "pr-2": x })',
      output: 'const c = cn("flex", on && "ms-1", { "pe-2": x })',
      errors: 2,
    },
    {
      code: 'const c = `flex ${a} pl-2 ${b} text-left`',
      output: 'const c = `flex ${a} ps-2 ${b} text-start`',
      errors: 2,
    },
    // translate ile ortalama otomatik çevrilmez
    {
      code: '<div className="absolute left-1/2 -translate-x-1/2" />',
      output: null,
      errors: [{ messageId: 'translated' }],
    },
  ],
});
