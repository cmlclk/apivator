// Apivator'a özgü ESLint kuralları (dış paket yok). Config'te `apivator/...` adıyla kullanılır.
import noLiteralJsxText from './no-literal-jsx-text.js';
import noPhysicalDirection from './no-physical-direction.js';

export default {
  meta: { name: 'eslint-plugin-apivator' },
  rules: {
    'no-literal-jsx-text': noLiteralJsxText,
    'no-physical-direction': noPhysicalDirection,
  },
};
